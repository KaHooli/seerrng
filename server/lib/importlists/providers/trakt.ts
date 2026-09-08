import TraktAPI, {
  isSupportedTraktChart,
  TRAKT_CHART_TYPES,
  TRAKT_MAX_PAGE_SIZE,
  TRAKT_MEDIA_TYPES,
  type TraktChartType,
  type TraktListItem,
  type TraktMediaSummary,
  type TraktMediaType,
} from '@server/api/trakt';
import { ImportListProviderId } from '@server/constants/importList';
import { MediaType } from '@server/constants/media';
import type {
  ImportListEntry,
  ImportListFetchOptions,
  ImportListFetchResult,
  ImportListProvider,
  ParsedImportList,
} from '@server/lib/importlists/types';
import {
  asHttpUrl,
  ImportListIdentifierError,
  ImportListNotConfiguredError,
  ImportListUnavailableError,
  requireNonEmptyIdentifier,
  titleizeSlug,
} from '@server/lib/importlists/types';
import { getSettings } from '@server/lib/settings';

/**
 * Trakt identifiers, matching what list-sync accepts:
 *
 *   user watchlist  https://trakt.tv/users/<user>/watchlist   ->  user:<user>:watchlist
 *   custom list     https://trakt.tv/users/<user>/lists/<slug> -> user:<user>:list:<slug>
 *   chart shortcut  trending:movies                            ->  chart:trending:movies
 *
 * The stored form is unambiguous so `fetch` never has to re-guess.
 */

const USER_WATCHLIST_PREFIX = 'user:';
const CHART_PREFIX = 'chart:';

const isChartType = (value: string): value is TraktChartType =>
  (TRAKT_CHART_TYPES as readonly string[]).includes(value);

const isMediaType = (value: string): value is TraktMediaType =>
  (TRAKT_MEDIA_TYPES as readonly string[]).includes(value);

const parseChartShortcut = (input: string): ParsedImportList | undefined => {
  const [chart, media] = input.toLowerCase().split(':');
  if (!chart || !media || !isChartType(chart) || !isMediaType(media)) {
    return undefined;
  }

  if (!isSupportedTraktChart(chart, media)) {
    throw new ImportListIdentifierError(
      'Trakt only publishes a box office chart for movies.'
    );
  }

  return {
    provider: ImportListProviderId.TRAKT,
    listId: `${CHART_PREFIX}${chart}:${media}`,
    name: `Trakt ${titleizeSlug(chart)} ${titleizeSlug(media)}`,
  };
};

/** Accepts trakt.tv and app.trakt.tv, with or without a trailing slash. */
const parseTraktUrl = (url: URL): ParsedImportList => {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'trakt.tv' && host !== 'app.trakt.tv') {
    throw new ImportListIdentifierError('That is not a Trakt URL.');
  }

  const segments = url.pathname.split('/').filter(Boolean);

  // /users/<user>/watchlist
  if (
    segments.length >= 3 &&
    segments[0] === 'users' &&
    segments[2] === 'watchlist'
  ) {
    const username = segments[1];
    return {
      provider: ImportListProviderId.TRAKT,
      listId: `${USER_WATCHLIST_PREFIX}${username}:watchlist`,
      name: `${username}'s Trakt Watchlist`,
    };
  }

  // /users/<user>/lists/<slug>
  if (
    segments.length >= 4 &&
    segments[0] === 'users' &&
    segments[2] === 'lists'
  ) {
    const username = segments[1];
    const listSlug = segments[3];
    return {
      provider: ImportListProviderId.TRAKT,
      listId: `${USER_WATCHLIST_PREFIX}${username}:list:${listSlug}`,
      name: titleizeSlug(listSlug),
    };
  }

  throw new ImportListIdentifierError(
    'Use a Trakt watchlist or custom list URL, or a chart shortcut such as "trending:movies".'
  );
};

type TraktTarget =
  | { kind: 'watchlist'; username: string }
  | { kind: 'list'; username: string; listSlug: string }
  | { kind: 'chart'; chart: TraktChartType; media: TraktMediaType };

/** Reads the canonical stored id back into something `fetch` can act on. */
export const resolveTraktTarget = (listId: string): TraktTarget => {
  if (listId.startsWith(CHART_PREFIX)) {
    const [, chart, media] = listId.split(':');
    if (!chart || !media || !isChartType(chart) || !isMediaType(media)) {
      throw new ImportListIdentifierError('Unrecognized Trakt chart.');
    }
    return { kind: 'chart', chart, media };
  }

  if (listId.startsWith(USER_WATCHLIST_PREFIX)) {
    const rest = listId.slice(USER_WATCHLIST_PREFIX.length);
    const [username, kind, listSlug] = rest.split(':');
    if (username && kind === 'watchlist') {
      return { kind: 'watchlist', username };
    }
    if (username && kind === 'list' && listSlug) {
      return { kind: 'list', username, listSlug };
    }
  }

  throw new ImportListIdentifierError('Unrecognized Trakt list identifier.');
};

const summaryToEntry = (
  summary: TraktMediaSummary,
  mediaType: MediaType
): ImportListEntry | undefined => {
  const ids = summary.ids;
  const title = typeof summary.title === 'string' ? summary.title : undefined;

  if (!title && !ids?.tmdb && !ids?.imdb) {
    return undefined;
  }

  return {
    title,
    year: typeof summary.year === 'number' ? summary.year : undefined,
    mediaType,
    tmdbId: typeof ids?.tmdb === 'number' ? ids.tmdb : undefined,
    imdbId: typeof ids?.imdb === 'string' ? ids.imdb : undefined,
    tvdbId: typeof ids?.tvdb === 'number' ? ids.tvdb : undefined,
  };
};

/**
 * A row may name its own type (watchlists, custom lists) or be a bare summary
 * under `movie`/`show` (charts). `fallback` covers the chart case, where the
 * media type comes from the endpoint rather than the row.
 */
export const traktItemToEntry = (
  item: TraktListItem,
  fallback?: MediaType
): ImportListEntry | undefined => {
  if (item.movie) {
    return summaryToEntry(item.movie, MediaType.MOVIE);
  }
  if (item.show) {
    return summaryToEntry(item.show, MediaType.TV);
  }

  // Chart endpoints return the summary itself for some chart types.
  if (fallback) {
    return summaryToEntry(item as TraktMediaSummary, fallback);
  }

  return undefined;
};

class TraktImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.TRAKT;
  public readonly label = 'Trakt';
  public readonly mediaKinds = [MediaType.MOVIE, MediaType.TV] as const;
  public readonly example = 'https://trakt.tv/users/username/lists/my-list';

  public isConfigured(): boolean {
    return (getSettings().importLists.traktClientId ?? '').length > 0;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    const url = asHttpUrl(identifier);
    if (url) {
      return parseTraktUrl(url);
    }

    const chart = parseChartShortcut(identifier);
    if (chart) {
      return chart;
    }

    throw new ImportListIdentifierError(
      'Use a Trakt watchlist or custom list URL, or a chart shortcut such as "trending:movies".'
    );
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    if (!this.isConfigured()) {
      throw new ImportListNotConfiguredError(
        'A Trakt client ID must be configured under Settings → Import Lists.'
      );
    }

    const target = resolveTraktTarget(list.listId);
    const trakt = new TraktAPI();
    const entries: ImportListEntry[] = [];
    let name: string | undefined;
    let truncated = false;

    if (target.kind === 'list') {
      try {
        const summary = await trakt.getListSummary(
          target.username,
          target.listSlug
        );
        if (typeof summary.name === 'string' && summary.name.trim()) {
          name = summary.name.trim();
        }
      } catch {
        // A missing summary is not fatal; the items call below decides whether
        // the list is actually readable.
      }
    }

    let page = 1;
    while (entries.length < options.maxItems) {
      const limit = Math.min(
        TRAKT_MAX_PAGE_SIZE,
        options.maxItems - entries.length
      );

      let items: TraktListItem[];
      try {
        items =
          target.kind === 'watchlist'
            ? await trakt.getWatchlistItems({
                username: target.username,
                page,
                limit,
              })
            : target.kind === 'list'
              ? await trakt.getListItems({
                  username: target.username,
                  listSlug: target.listSlug,
                  page,
                  limit,
                })
              : await trakt.getChartItems({
                  chart: target.chart,
                  media: target.media,
                  page,
                  limit,
                });
      } catch (e) {
        throw new ImportListUnavailableError(
          `Trakt did not return the list: ${
            e instanceof Error ? e.message : 'unknown error'
          }`
        );
      }

      if (!Array.isArray(items) || items.length === 0) {
        break;
      }

      const fallback =
        target.kind === 'chart'
          ? target.media === 'movies'
            ? MediaType.MOVIE
            : MediaType.TV
          : undefined;

      for (const item of items) {
        const entry = traktItemToEntry(item, fallback);
        if (entry) {
          entries.push(entry);
        }
      }

      if (items.length < limit) {
        break;
      }

      page += 1;
      // A short page is the only end-of-list signal Trakt gives us, so a list
      // that is an exact multiple of the page size ends by hitting maxItems.
      if (entries.length >= options.maxItems) {
        truncated = true;
        break;
      }
    }

    return { entries: entries.slice(0, options.maxItems), name, truncated };
  }
}

export default new TraktImportListProvider();
