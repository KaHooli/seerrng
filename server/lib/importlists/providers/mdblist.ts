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
  assertUnderstoodResponse,
  isImdbId,
  requireNonEmptyIdentifier,
  titleizeSlug,
} from '@server/lib/importlists/types';
import { getSettings } from '@server/lib/settings';

/**
 * MDBList exposes public lists as JSON, so unlike list-sync — which scrapes the
 * page with a headless browser — this reads the API directly.
 *
 * Without a key, `https://mdblist.com/lists/<user>/<list>/json` serves public
 * lists. With one, the api.mdblist.com host paginates properly, which matters
 * for lists past a few hundred items.
 *
 * Identifiers: `https://mdblist.com/lists/<user>/<list>` or `<user>/<list>`,
 * stored canonically as `<user>/<list>`.
 */

const MDBLIST_PUBLIC_BASE = 'https://mdblist.com';
const MDBLIST_API_BASE = 'https://api.mdblist.com';
const MDBLIST_PAGE_SIZE = 100;

interface MdbListItem {
  id?: number;
  imdb_id?: string;
  tvdbid?: number;
  title?: string;
  release_year?: number;
  year?: number;
  mediatype?: string;
  type?: string;
}

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

class MdbListAPI extends ExternalAPI {
  private apiKey: string;

  constructor(apiKey?: string) {
    const resolvedKey = apiKey ?? getSettings().importLists.mdblistApiKey ?? '';
    super(
      resolvedKey ? MDBLIST_API_BASE : MDBLIST_PUBLIC_BASE,
      resolvedKey ? { apikey: resolvedKey } : {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        headers: { Accept: 'application/json' },
      }
    );
    this.apiKey = resolvedKey;
  }

  public async getItems({
    username,
    listSlug,
    offset,
    limit,
  }: {
    username: string;
    listSlug: string;
    offset: number;
    limit: number;
  }): Promise<MdbListItem[]> {
    const path = `/lists/${encodeURIComponent(username)}/${encodeURIComponent(
      listSlug
    )}`;

    if (!this.apiKey) {
      // The keyless endpoint returns the whole list in one document; paging
      // parameters are ignored, so ask for it once and let the caller slice.
      return this.get<MdbListItem[]>(`${path}/json`);
    }

    return this.get<MdbListItem[]>(`${path}/items`, {
      params: { offset, limit },
    });
  }

  public get paginates(): boolean {
    return this.apiKey.length > 0;
  }
}

export const mdbListItemToEntry = (
  item: MdbListItem
): ImportListEntry | undefined => {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const tmdbId =
    typeof item.id === 'number' && item.id > 0 ? item.id : undefined;
  const imdbId = isImdbId(item.imdb_id) ? item.imdb_id : undefined;

  if (!title && !tmdbId && !imdbId) {
    return undefined;
  }

  const rawType = (item.mediatype ?? item.type ?? '').toLowerCase();
  const mediaType =
    rawType === 'show' || rawType === 'tv' || rawType === 'series'
      ? MediaType.TV
      : rawType === 'movie'
        ? MediaType.MOVIE
        : undefined;

  const year = item.release_year ?? item.year;

  return {
    title: title || undefined,
    year: typeof year === 'number' && year > 0 ? year : undefined,
    mediaType,
    // MDBList's `id` is a TMDB id, but only trust it when the row also names
    // its media type — a TMDB id is meaningless without knowing the namespace.
    tmdbId: mediaType ? tmdbId : undefined,
    imdbId,
    tvdbId:
      typeof item.tvdbid === 'number' && item.tvdbid > 0
        ? item.tvdbid
        : undefined,
  };
};

class MdbListImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.MDBLIST;
  public readonly label = 'MDBList';
  public readonly mediaKinds = [MediaType.MOVIE, MediaType.TV] as const;
  public readonly example = 'https://mdblist.com/lists/username/listname';

  public isConfigured(): boolean {
    // Public lists are readable without a key.
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    let username: string | undefined;
    let listSlug: string | undefined;

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'mdblist.com' && host !== 'api.mdblist.com') {
        throw new ImportListIdentifierError('That is not an MDBList URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] !== 'lists' || segments.length < 3) {
        throw new ImportListIdentifierError(
          'Use an MDBList list URL such as https://mdblist.com/lists/username/listname.'
        );
      }
      [, username, listSlug] = segments;
    } else {
      const segments = identifier.split('/').filter(Boolean);
      if (segments.length !== 2) {
        throw new ImportListIdentifierError(
          'Use an MDBList URL, or the short form "username/listname".'
        );
      }
      [username, listSlug] = segments;
    }

    if (
      !username ||
      !listSlug ||
      !SLUG_PATTERN.test(username) ||
      !SLUG_PATTERN.test(listSlug)
    ) {
      throw new ImportListIdentifierError(
        'That MDBList username or list name is not valid.'
      );
    }

    return {
      provider: ImportListProviderId.MDBLIST,
      listId: `${username}/${listSlug}`,
      name: titleizeSlug(listSlug),
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const [username, listSlug] = list.listId.split('/');
    if (!username || !listSlug) {
      throw new ImportListIdentifierError(
        'Unrecognized MDBList list identifier.'
      );
    }

    const api = new MdbListAPI();
    const entries: ImportListEntry[] = [];
    let offset = 0;

    try {
      do {
        const limit = Math.min(
          MDBLIST_PAGE_SIZE,
          options.maxItems - entries.length
        );
        const items = await api.getItems({
          username,
          listSlug,
          offset,
          limit,
        });

        if (!Array.isArray(items) || items.length === 0) {
          break;
        }

        const before = entries.length;
        for (const item of items) {
          const entry = mdbListItemToEntry(item);
          if (entry) {
            entries.push(entry);
          }
        }

        if (offset === 0) {
          assertUnderstoodResponse({
            received: items.length,
            parsed: entries.length - before,
            source: 'MDBList',
          });
        }

        if (!api.paginates || items.length < limit) {
          break;
        }

        offset += items.length;
      } while (entries.length < options.maxItems);
    } catch (e) {
      if (e instanceof ImportListUnavailableError) {
        throw e;
      }
      throw new ImportListUnavailableError(
        `MDBList did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    return {
      entries: entries.slice(0, options.maxItems),
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new MdbListImportListProvider();
