import TheMovieDb from '@server/api/themoviedb';
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
  ImportListIdentifierError,
  ImportListUnavailableError,
  asHttpUrl,
  assertUnderstoodResponse,
  requireNonEmptyIdentifier,
  yearFromDate,
} from '@server/lib/importlists/types';

/**
 * Two TMDB-backed providers, sharing this module because they share a client:
 *
 *  - `tmdb`            a user list,      https://www.themoviedb.org/list/12345
 *  - `tmdb-collection` a franchise,      https://www.themoviedb.org/collection/1241
 *
 * Both yield TMDB ids directly, so nothing here needs the resolver's fallbacks.
 */

const TMDB_LIST_PAGE_SIZE = 20;

const parseNumericId = (value: string): number | undefined => {
  // TMDB URLs are often slugged: /list/12345-my-favourite-movies
  const match = /^(\d+)/.exec(value);
  if (!match) {
    return undefined;
  }
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/** Shared URL/short-form parsing for both TMDB providers. */
const parseTmdbIdentifier = (
  input: string,
  pathSegment: 'list' | 'collection'
): number => {
  const identifier = requireNonEmptyIdentifier(input);

  const url = asHttpUrl(identifier);
  if (url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'themoviedb.org') {
      throw new ImportListIdentifierError('That is not a TMDB URL.');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const index = segments.indexOf(pathSegment);
    const raw = index >= 0 ? segments[index + 1] : undefined;
    const id = raw ? parseNumericId(raw) : undefined;
    if (!id) {
      throw new ImportListIdentifierError(
        `Use a TMDB ${pathSegment} URL such as https://www.themoviedb.org/${pathSegment}/12345.`
      );
    }
    return id;
  }

  const id = parseNumericId(identifier);
  if (!id) {
    throw new ImportListIdentifierError(
      `Use a TMDB ${pathSegment} URL, or just the numeric ${pathSegment} ID.`
    );
  }
  return id;
};

/**
 * TMDB list rows carry their own media_type; collection parts are always
 * movies. Anything that is neither a movie nor a series (a person, say) is
 * dropped rather than guessed at.
 */
export const tmdbResultToEntry = (
  result: Record<string, unknown>,
  fallback?: MediaType
): ImportListEntry | undefined => {
  const rawType =
    typeof result.media_type === 'string' ? result.media_type : undefined;
  const mediaType =
    rawType === 'movie'
      ? MediaType.MOVIE
      : rawType === 'tv'
        ? MediaType.TV
        : rawType === undefined
          ? fallback
          : undefined;

  if (!mediaType) {
    return undefined;
  }

  const tmdbId =
    typeof result.id === 'number' &&
    Number.isSafeInteger(result.id) &&
    result.id > 0
      ? result.id
      : undefined;
  if (!tmdbId) {
    return undefined;
  }

  const title =
    typeof result.title === 'string'
      ? result.title
      : typeof result.name === 'string'
        ? result.name
        : undefined;

  return {
    title,
    year: yearFromDate(result.release_date ?? result.first_air_date),
    mediaType,
    tmdbId,
  };
};

class TmdbListImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.TMDB;
  public readonly label = 'TMDB List';
  public readonly mediaKinds = [MediaType.MOVIE, MediaType.TV] as const;
  public readonly example = 'https://www.themoviedb.org/list/12345';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const listId = parseTmdbIdentifier(input, 'list');
    return {
      provider: ImportListProviderId.TMDB,
      listId: String(listId),
      name: `TMDB List ${listId}`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const listId = Number(list.listId);
    if (!Number.isSafeInteger(listId) || listId <= 0) {
      throw new ImportListIdentifierError('Unrecognized TMDB list identifier.');
    }

    const tmdb = new TheMovieDb();
    const entries: ImportListEntry[] = [];
    let name: string | undefined;
    let page = 1;
    let itemCount: number | undefined;

    try {
      do {
        const response = await tmdb.getList({ listId, page });

        if (page === 1) {
          name = response.name?.trim() || undefined;
          itemCount = response.item_count;
        }

        if (!response.items.length) {
          break;
        }

        const before = entries.length;
        for (const item of response.items) {
          const entry = tmdbResultToEntry(item);
          if (entry) {
            entries.push(entry);
          }
        }

        if (page === 1) {
          assertUnderstoodResponse({
            received: response.items.length,
            parsed: entries.length - before,
            source: 'TMDB',
            detail: 'A list of only people has nothing requestable in it.',
          });
        }

        if (response.items.length < TMDB_LIST_PAGE_SIZE) {
          break;
        }

        page += 1;
      } while (
        entries.length < options.maxItems &&
        (itemCount === undefined || entries.length < itemCount)
      );
    } catch (e) {
      if (e instanceof ImportListUnavailableError) {
        throw e;
      }
      throw new ImportListUnavailableError(
        `TMDB did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    return {
      entries: entries.slice(0, options.maxItems),
      name,
      truncated: entries.length > options.maxItems,
    };
  }
}

class TmdbCollectionImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.TMDB_COLLECTION;
  public readonly label = 'TMDB Collection';
  public readonly mediaKinds = [MediaType.MOVIE] as const;
  public readonly example = 'https://www.themoviedb.org/collection/1241';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const collectionId = parseTmdbIdentifier(input, 'collection');
    return {
      provider: ImportListProviderId.TMDB_COLLECTION,
      listId: String(collectionId),
      name: `TMDB Collection ${collectionId}`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const collectionId = Number(list.listId);
    if (!Number.isSafeInteger(collectionId) || collectionId <= 0) {
      throw new ImportListIdentifierError(
        'Unrecognized TMDB collection identifier.'
      );
    }

    const tmdb = new TheMovieDb();

    try {
      const collection = await tmdb.getCollection({ collectionId });
      const parts = Array.isArray(collection.parts) ? collection.parts : [];
      const entries = parts
        .map((part) =>
          tmdbResultToEntry(
            part as unknown as Record<string, unknown>,
            MediaType.MOVIE
          )
        )
        .filter((entry): entry is ImportListEntry => entry !== undefined);

      assertUnderstoodResponse({
        received: parts.length,
        parsed: entries.length,
        source: 'TMDB',
      });

      return {
        entries: entries.slice(0, options.maxItems),
        name: collection.name?.trim() || undefined,
        truncated: entries.length > options.maxItems,
      };
    } catch (e) {
      if (e instanceof ImportListUnavailableError) {
        throw e;
      }
      throw new ImportListUnavailableError(
        `TMDB did not return the collection: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }
  }
}

export const tmdbListProvider = new TmdbListImportListProvider();
export const tmdbCollectionProvider = new TmdbCollectionImportListProvider();
