import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

/**
 * Trakt API v2 client, scoped to what import lists need: reading the items of a
 * user's watchlist, a user's custom list, or one of Trakt's own curated charts.
 *
 * Authentication is a client id only. Trakt's OAuth flow buys access to private
 * lists, which import lists deliberately do not support — a list has to be
 * public for another person's Seerr to read it.
 */

export const TRAKT_API_BASE = 'https://api.trakt.tv';

/** Charts Trakt exposes without a user, as `<chart>:<media>`. */
export const TRAKT_CHART_TYPES = [
  'trending',
  'popular',
  'anticipated',
  'watched',
  'boxoffice',
  'streaming',
  'favorited',
] as const;

export type TraktChartType = (typeof TRAKT_CHART_TYPES)[number];

export const TRAKT_MEDIA_TYPES = ['movies', 'shows'] as const;

export type TraktMediaType = (typeof TRAKT_MEDIA_TYPES)[number];

/** Trakt only publishes a box-office chart for movies. */
export const isSupportedTraktChart = (
  chart: TraktChartType,
  media: TraktMediaType
): boolean => chart !== 'boxoffice' || media === 'movies';

export interface TraktIds {
  trakt?: number;
  slug?: string;
  imdb?: string | null;
  tmdb?: number | null;
  tvdb?: number | null;
}

export interface TraktMediaSummary {
  title?: string;
  year?: number | null;
  ids?: TraktIds;
}

/**
 * Trakt list responses are heterogeneous: a watchlist row carries `type` plus a
 * `movie`/`show` object, a chart row may be the summary itself or wrap it.
 */
export interface TraktListItem {
  type?: string;
  movie?: TraktMediaSummary;
  show?: TraktMediaSummary;
  /** Chart endpoints put the count alongside the summary. */
  watchers?: number;
  list_count?: number;
  revenue?: number;
}

export interface TraktListSummary {
  name?: string;
  description?: string;
  item_count?: number;
}

export class TraktCredentialsMissingError extends Error {
  constructor() {
    super('A Trakt client ID must be configured before Trakt lists can sync.');
    this.name = 'TraktCredentialsMissingError';
  }
}

/** Trakt caps `limit` at 100 per page. */
export const TRAKT_MAX_PAGE_SIZE = 100;

class TraktAPI extends ExternalAPI {
  constructor(clientId?: string) {
    const resolvedClientId =
      clientId ?? getSettings().importLists.traktClientId ?? '';

    super(
      TRAKT_API_BASE,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': resolvedClientId,
        },
        nodeCache: cacheManager.getCache('importlist').data,
      }
    );

    this.clientId = resolvedClientId;
  }

  private clientId: string;

  public isConfigured(): boolean {
    return this.clientId.length > 0;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new TraktCredentialsMissingError();
    }
  }

  /** Verifies the configured client id by making the cheapest authorized call. */
  public async test(): Promise<void> {
    this.assertConfigured();
    await this.get<TraktListItem[]>(
      '/movies/trending',
      { params: { limit: 1 } },
      0
    );
  }

  public async getListSummary(
    username: string,
    listSlug: string
  ): Promise<TraktListSummary> {
    this.assertConfigured();
    return this.get<TraktListSummary>(
      `/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(
        listSlug
      )}`
    );
  }

  /** Items of a user's custom list, paged. */
  public async getListItems({
    username,
    listSlug,
    page = 1,
    limit = TRAKT_MAX_PAGE_SIZE,
  }: {
    username: string;
    listSlug: string;
    page?: number;
    limit?: number;
  }): Promise<TraktListItem[]> {
    this.assertConfigured();
    return this.get<TraktListItem[]>(
      `/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(
        listSlug
      )}/items`,
      { params: { page, limit, extended: 'full' } }
    );
  }

  /** Items of a user's public watchlist, paged. */
  public async getWatchlistItems({
    username,
    page = 1,
    limit = TRAKT_MAX_PAGE_SIZE,
  }: {
    username: string;
    page?: number;
    limit?: number;
  }): Promise<TraktListItem[]> {
    this.assertConfigured();
    return this.get<TraktListItem[]>(
      `/users/${encodeURIComponent(username)}/watchlist`,
      { params: { page, limit, extended: 'full' } }
    );
  }

  /** One of Trakt's curated charts, e.g. trending movies. */
  public async getChartItems({
    chart,
    media,
    page = 1,
    limit = TRAKT_MAX_PAGE_SIZE,
  }: {
    chart: TraktChartType;
    media: TraktMediaType;
    page?: number;
    limit?: number;
  }): Promise<TraktListItem[]> {
    this.assertConfigured();
    return this.get<TraktListItem[]>(`/${media}/${chart}`, {
      params: { page, limit, extended: 'full' },
    });
  }
}

export default TraktAPI;
