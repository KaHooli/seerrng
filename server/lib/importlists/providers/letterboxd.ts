import ExternalAPI from '@server/api/externalapi';
import { ImportListProviderId } from '@server/constants/importList';
import { MediaType } from '@server/constants/media';
import cacheManager from '@server/lib/cache';
import type {
  ImportListEntry,
  ImportListFetchOptions,
  ImportListFetchResult,
  ImportListProvider,
  ParsedImportList,
} from '@server/lib/importlists/types';
import {
  ImportListIdentifierError,
  ImportListUnavailableError,
  asHttpUrl,
  requireNonEmptyIdentifier,
  titleizeSlug,
} from '@server/lib/importlists/types';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { JSDOM } from 'jsdom';

/**
 * Letterboxd lists and watchlists.
 *
 * Letterboxd has no public API. List pages are server-rendered, so the posters
 * — and with them each film's slug — parse out of plain HTML without a browser.
 * The slug is not a TMDB id though, and only the film's own page carries one,
 * so resolving a list costs one extra request per film.
 *
 * That is the expensive part, and it is why slug -> TMDB id is cached for a
 * month: the mapping never changes, so only a list's *new* films cost anything
 * on a repeat sync.
 *
 * Identifiers:
 *   list       https://letterboxd.com/<user>/list/<slug>/ -> <user>/list/<slug>
 *   watchlist  https://letterboxd.com/<user>/watchlist/   -> <user>/watchlist
 */

const LETTERBOXD_BASE_URL = 'https://letterboxd.com';
const LETTERBOXD_PAGE_SIZE = 100;
const MAX_PAGES = 25;
/** Film slug -> TMDB id never changes; keep it for a month. */
const FILM_CACHE_TTL = 60 * 60 * 24 * 30;
const FILM_LOOKUP_CONCURRENCY = 4;

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,50}$/;
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

class LetterboxdAPI extends ExternalAPI {
  constructor() {
    super(
      LETTERBOXD_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 30_000,
      }
    );
  }

  public async getPage(path: string, ttl = 3600): Promise<string> {
    return this.get<string>(
      path,
      { responseType: 'text', transformResponse: [(data) => data] },
      ttl
    );
  }

  /** Film pages carry `data-tmdb-id` / `data-tmdb-type` on the body. */
  public async getFilmTmdbId(
    slug: string
  ): Promise<{ tmdbId?: number; mediaType?: MediaType }> {
    const html = await this.getPage(`/film/${slug}/`, FILM_CACHE_TTL);
    return parseLetterboxdFilmPage(html);
  }
}

export const parseLetterboxdFilmPage = (
  html: string
): { tmdbId?: number; mediaType?: MediaType } => {
  const document = new JSDOM(html).window.document;
  const holder =
    document.querySelector('[data-tmdb-id]') ??
    document.querySelector('body[data-tmdb-id]');

  const rawId = holder?.getAttribute('data-tmdb-id');
  const rawType = holder?.getAttribute('data-tmdb-type');

  const tmdbId = rawId ? Number(rawId) : NaN;

  return {
    tmdbId: Number.isSafeInteger(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
    mediaType:
      rawType === 'tv'
        ? MediaType.TV
        : rawType === 'movie'
          ? MediaType.MOVIE
          : undefined,
  };
};

export interface LetterboxdPosterRef {
  slug: string;
  title?: string;
}

/**
 * Poster elements carry the slug on `data-film-slug` (older markup) or
 * `data-item-slug`/`data-film-link` (newer). Accept all of them: Letterboxd
 * has changed this markup more than once.
 */
export const parseLetterboxdListPage = (
  html: string
): LetterboxdPosterRef[] => {
  const document = new JSDOM(html).window.document;
  const refs: LetterboxdPosterRef[] = [];
  const seen = new Set<string>();

  const nodes = document.querySelectorAll(
    '[data-film-slug], [data-item-slug], [data-film-link]'
  );

  for (const node of nodes) {
    const link = node.getAttribute('data-film-link');
    const slug =
      node.getAttribute('data-film-slug') ??
      node.getAttribute('data-item-slug') ??
      (link ? link.split('/').filter(Boolean).pop() : undefined);

    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    const image = node.querySelector('img');
    const title =
      node.getAttribute('data-item-name') ??
      image?.getAttribute('alt') ??
      undefined;

    refs.push({ slug, title: title?.trim() || undefined });
  }

  return refs;
};

class LetterboxdImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.LETTERBOXD;
  public readonly label = 'Letterboxd';
  public readonly mediaKinds = [MediaType.MOVIE] as const;
  public readonly example = 'https://letterboxd.com/username/list/my-list/';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    const url = asHttpUrl(identifier);
    if (!url) {
      throw new ImportListIdentifierError(
        'Use a Letterboxd list or watchlist URL.'
      );
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'letterboxd.com') {
      throw new ImportListIdentifierError('That is not a Letterboxd URL.');
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const username = segments[0];

    if (!username || !USERNAME_PATTERN.test(username)) {
      throw new ImportListIdentifierError(
        'That Letterboxd username is not valid.'
      );
    }

    if (segments[1] === 'watchlist') {
      return {
        provider: ImportListProviderId.LETTERBOXD,
        listId: `${username}/watchlist`,
        name: `${username}'s Letterboxd Watchlist`,
      };
    }

    if (segments[1] === 'list' && segments[2]) {
      const slug = segments[2];
      if (!SLUG_PATTERN.test(slug)) {
        throw new ImportListIdentifierError(
          'That Letterboxd list name is not valid.'
        );
      }
      return {
        provider: ImportListProviderId.LETTERBOXD,
        listId: `${username}/list/${slug}`,
        name: titleizeSlug(slug),
      };
    }

    throw new ImportListIdentifierError(
      'Use a Letterboxd list URL (…/list/name/) or watchlist URL (…/watchlist/).'
    );
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const api = new LetterboxdAPI();
    const refs: LetterboxdPosterRef[] = [];
    const seen = new Set<string>();

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const html = await api.getPage(`/${list.listId}/page/${page}/`);
        const pageRefs = parseLetterboxdListPage(html);

        if (!pageRefs.length) {
          break;
        }

        for (const ref of pageRefs) {
          if (!seen.has(ref.slug)) {
            seen.add(ref.slug);
            refs.push(ref);
          }
        }

        if (pageRefs.length < LETTERBOXD_PAGE_SIZE) {
          break;
        }
        if (refs.length >= options.maxItems) {
          break;
        }
      }
    } catch (e) {
      throw new ImportListUnavailableError(
        `Letterboxd did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    const truncated = refs.length > options.maxItems;
    const wanted = refs.slice(0, options.maxItems);

    const entries = await mapWithConcurrency(
      wanted,
      FILM_LOOKUP_CONCURRENCY,
      async (ref): Promise<ImportListEntry> => {
        try {
          const { tmdbId, mediaType } = await api.getFilmTmdbId(ref.slug);
          return {
            title: ref.title,
            tmdbId,
            mediaType: mediaType ?? MediaType.MOVIE,
          };
        } catch {
          // One unreadable film page should not fail the whole list; fall back
          // to the title so the resolver can still try a TMDB search.
          return { title: ref.title, mediaType: MediaType.MOVIE };
        }
      }
    );

    return {
      entries: entries.filter((entry) => entry.tmdbId || entry.title),
      truncated,
    };
  }
}

export default new LetterboxdImportListProvider();
