import ExternalAPI from '@server/api/externalapi';
import { ImportListProviderId } from '@server/constants/importList';
import { MediaType } from '@server/constants/media';
import cacheManager from '@server/lib/cache';
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
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
} from '@server/lib/importlists/types';

/**
 * Open Library lists and reading-log shelves.
 *
 * Seerr already identifies books by their Open Library work id, so these lists
 * need no title matching at all: every entry names exactly the book to request.
 *
 * Identifiers:
 *   list    https://openlibrary.org/people/<user>/lists/OL123L -> <user>/OL123L
 *   shelf   https://openlibrary.org/people/<user>/books/want-to-read
 *                                                       -> <user>:want-to-read
 */

const OPENLIBRARY_BASE_URL = 'https://openlibrary.org';
const OPENLIBRARY_PAGE_SIZE = 100;

export const OPENLIBRARY_SHELVES = [
  'want-to-read',
  'currently-reading',
  'already-read',
] as const;

type OpenLibraryShelf = (typeof OPENLIBRARY_SHELVES)[number];

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}$/;
const LIST_ID_PATTERN = /^OL\d+L$/i;
const WORK_KEY_PATTERN = /^\/works\/(OL\d+W)$/i;

interface OpenLibrarySeed {
  key?: string;
  title?: string;
  url?: string;
  type?: string;
}

interface OpenLibraryReadingLogEntry {
  work?: { key?: string; title?: string; first_publish_year?: number };
  logged_edition?: string;
}

class OpenLibraryListsAPI extends ExternalAPI {
  constructor() {
    super(
      OPENLIBRARY_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        rateLimit: { maxRequests: 10, maxRPS: 5 },
      }
    );
  }

  public async getListSeeds(
    username: string,
    listId: string
  ): Promise<{ entries?: OpenLibrarySeed[]; size?: number }> {
    return this.get(
      `/people/${encodeURIComponent(username)}/lists/${encodeURIComponent(
        listId
      )}/seeds.json`
    );
  }

  public async getReadingLog(
    username: string,
    shelf: OpenLibraryShelf,
    page: number
  ): Promise<{ reading_log_entries?: OpenLibraryReadingLogEntry[] }> {
    return this.get(
      `/people/${encodeURIComponent(username)}/books/${shelf}.json`,
      { params: { page, limit: OPENLIBRARY_PAGE_SIZE } }
    );
  }
}

/** Seeds name works as `/works/OL123W`; anything else (an author, a subject) is not a book. */
export const seedToEntry = (
  seed: OpenLibrarySeed
): ImportListEntry | undefined => {
  const key = typeof seed.key === 'string' ? seed.key : seed.url;
  const match = typeof key === 'string' ? WORK_KEY_PATTERN.exec(key) : null;
  if (!match) {
    return undefined;
  }

  return {
    openLibraryId: normalizeOpenLibraryWorkId(match[1]),
    title: typeof seed.title === 'string' ? seed.title.trim() : undefined,
    mediaType: MediaType.BOOK,
  };
};

export const readingLogEntryToEntry = (
  entry: OpenLibraryReadingLogEntry
): ImportListEntry | undefined => {
  const key = entry.work?.key;
  const match = typeof key === 'string' ? WORK_KEY_PATTERN.exec(key) : null;
  if (!match) {
    return undefined;
  }

  return {
    openLibraryId: normalizeOpenLibraryWorkId(match[1]),
    title: entry.work?.title?.trim() || undefined,
    year:
      typeof entry.work?.first_publish_year === 'number'
        ? entry.work.first_publish_year
        : undefined,
    mediaType: MediaType.BOOK,
  };
};

const isShelf = (value: string): value is OpenLibraryShelf =>
  (OPENLIBRARY_SHELVES as readonly string[]).includes(value);

class OpenLibraryImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.OPENLIBRARY;
  public readonly label = 'Open Library';
  public readonly mediaKinds = [MediaType.BOOK] as const;
  public readonly example = 'https://openlibrary.org/people/jane/lists/OL123L';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'openlibrary.org') {
        throw new ImportListIdentifierError('That is not an Open Library URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] !== 'people' || !segments[1]) {
        throw new ImportListIdentifierError(
          'Use an Open Library list or reading-log URL.'
        );
      }
      const username = segments[1];

      if (segments[2] === 'lists' && segments[3]) {
        return this.buildList(username, segments[3]);
      }
      if (segments[2] === 'books' && segments[3]) {
        const shelf = segments[3].replace(/\.json$/, '');
        return this.buildShelf(username, shelf);
      }

      throw new ImportListIdentifierError(
        'Use an Open Library list URL (…/lists/OL123L) or reading-log URL (…/books/want-to-read).'
      );
    }

    // Short forms: "<user>/OL123L" for a list, "<user>:<shelf>" for a shelf.
    if (identifier.includes('/')) {
      const [username, listId] = identifier.split('/');
      return this.buildList(username, listId);
    }
    if (identifier.includes(':')) {
      const [username, shelf] = identifier.split(':');
      return this.buildShelf(username, shelf);
    }

    throw new ImportListIdentifierError(
      'Use an Open Library URL, "user/OL123L" for a list, or "user:want-to-read" for a shelf.'
    );
  }

  private buildList(username: string, listId: string): ParsedImportList {
    if (
      !username ||
      !USERNAME_PATTERN.test(username) ||
      !listId ||
      !LIST_ID_PATTERN.test(listId)
    ) {
      throw new ImportListIdentifierError(
        'That Open Library username or list ID is not valid.'
      );
    }
    return {
      provider: ImportListProviderId.OPENLIBRARY,
      listId: `${username}/${listId.toUpperCase()}`,
      name: `${username}'s Open Library list`,
    };
  }

  private buildShelf(username: string, shelf: string): ParsedImportList {
    if (!username || !USERNAME_PATTERN.test(username)) {
      throw new ImportListIdentifierError(
        'That Open Library username is not valid.'
      );
    }
    if (!shelf || !isShelf(shelf)) {
      throw new ImportListIdentifierError(
        `Open Library shelves are: ${OPENLIBRARY_SHELVES.join(', ')}.`
      );
    }
    return {
      provider: ImportListProviderId.OPENLIBRARY,
      listId: `${username}:${shelf}`,
      name: `${username}'s ${shelf.replace(/-/g, ' ')} shelf`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const api = new OpenLibraryListsAPI();
    const entries: ImportListEntry[] = [];

    try {
      if (list.listId.includes('/')) {
        const [username, listId] = list.listId.split('/');
        const response = await api.getListSeeds(username, listId);
        for (const seed of response.entries ?? []) {
          const entry = seedToEntry(seed);
          if (entry) {
            entries.push(entry);
          }
        }
      } else {
        const [username, shelf] = list.listId.split(':');
        if (!isShelf(shelf)) {
          throw new ImportListIdentifierError(
            'Unrecognized Open Library shelf.'
          );
        }

        for (let page = 1; entries.length < options.maxItems; page++) {
          const response = await api.getReadingLog(username, shelf, page);
          const rows = response.reading_log_entries ?? [];
          if (!rows.length) {
            break;
          }
          for (const row of rows) {
            const entry = readingLogEntryToEntry(row);
            if (entry) {
              entries.push(entry);
            }
          }
          if (rows.length < OPENLIBRARY_PAGE_SIZE) {
            break;
          }
        }
      }
    } catch (e) {
      if (e instanceof ImportListIdentifierError) {
        throw e;
      }
      throw new ImportListUnavailableError(
        `Open Library did not return the list: ${
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

export default new OpenLibraryImportListProvider();
