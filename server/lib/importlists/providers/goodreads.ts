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
  requireNonEmptyIdentifier,
} from '@server/lib/importlists/types';
import { normalizeValidIsbn } from '@server/lib/isbn';
import xml2js from 'xml2js';

/**
 * Goodreads shelves, read through the shelf's public RSS feed — the only
 * machine-readable surface Goodreads still offers.
 *
 * The shelf must be public: Goodreads serves the feed for public profiles only.
 * Entries carry an ISBN where the shelf has one and fall back to title+author,
 * which the resolver matches against Open Library.
 *
 * Identifiers:
 *   https://www.goodreads.com/review/list/19281606?shelf=to-read
 *   19281606          (the `to-read` shelf by default)
 *   19281606:read
 * Stored as `<userId>:<shelf>`.
 */

const GOODREADS_BASE_URL = 'https://www.goodreads.com';
const GOODREADS_PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DEFAULT_SHELF = 'to-read';

const USER_ID_PATTERN = /^\d{1,12}$/;
const SHELF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;

interface GoodreadsRssItem {
  title?: string[];
  author_name?: string[];
  isbn?: string[];
  book_published?: string[];
  book_id?: string[];
}

class GoodreadsAPI extends ExternalAPI {
  constructor() {
    super(
      GOODREADS_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        timeout: 30_000,
      }
    );
  }

  public async getShelfFeed(
    userId: string,
    shelf: string,
    page: number
  ): Promise<string> {
    return this.get<string>(
      `/review/list_rss/${encodeURIComponent(userId)}`,
      {
        params: { shelf, page, per_page: GOODREADS_PAGE_SIZE },
        responseType: 'text',
        transformResponse: [(data) => data],
      },
      3600
    );
  }
}

export const goodreadsItemToEntry = (
  item: GoodreadsRssItem
): ImportListEntry | undefined => {
  const title = item.title?.[0]?.trim();
  if (!title) {
    return undefined;
  }

  const rawIsbn = item.isbn?.[0]?.trim();
  const published = item.book_published?.[0]?.trim();
  const year =
    published && /^\d{4}$/.test(published) ? Number(published) : undefined;

  return {
    title,
    author: item.author_name?.[0]?.trim() || undefined,
    isbn: normalizeValidIsbn(rawIsbn),
    year,
    mediaType: MediaType.BOOK,
  };
};

/** Parses a Goodreads shelf RSS document into entries. */
export const parseGoodreadsFeed = async (
  xml: string
): Promise<{ entries: ImportListEntry[]; received: number }> => {
  const parsed = await xml2js.parseStringPromise(xml, {
    explicitArray: true,
    trim: true,
  });

  const items: GoodreadsRssItem[] = parsed?.rss?.channel?.[0]?.item ?? [];

  return {
    entries: items
      .map(goodreadsItemToEntry)
      .filter((entry): entry is ImportListEntry => entry !== undefined),
    received: items.length,
  };
};

class GoodreadsImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.GOODREADS;
  public readonly label = 'Goodreads';
  public readonly mediaKinds = [MediaType.BOOK] as const;
  public readonly example = '19281606:to-read';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    let userId: string | undefined;
    let shelf = DEFAULT_SHELF;

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'goodreads.com') {
        throw new ImportListIdentifierError('That is not a Goodreads URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);
      // /review/list/<id>, /review/list_rss/<id> or /user/show/<id>-name
      const raw = segments[segments.length - 1] ?? '';
      const match = /^(\d+)/.exec(raw);
      userId = match?.[1];
      const shelfParam = url.searchParams.get('shelf');
      if (shelfParam) {
        shelf = shelfParam;
      }
    } else {
      const [rawUserId, rawShelf] = identifier.split(':');
      userId = rawUserId;
      if (rawShelf) {
        shelf = rawShelf;
      }
    }

    if (!userId || !USER_ID_PATTERN.test(userId)) {
      throw new ImportListIdentifierError(
        'Use a Goodreads numeric user ID, optionally with a shelf: "19281606:to-read".'
      );
    }

    if (!SHELF_PATTERN.test(shelf)) {
      throw new ImportListIdentifierError(
        'That Goodreads shelf name is not valid.'
      );
    }

    return {
      provider: ImportListProviderId.GOODREADS,
      listId: `${userId}:${shelf}`,
      name: `Goodreads ${shelf.replace(/-/g, ' ')} shelf`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const [userId, shelf] = list.listId.split(':');
    if (!userId || !shelf) {
      throw new ImportListIdentifierError(
        'Unrecognized Goodreads list identifier.'
      );
    }

    const api = new GoodreadsAPI();
    const entries: ImportListEntry[] = [];

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const xml = await api.getShelfFeed(userId, shelf, page);
        const { entries: pageEntries, received } =
          await parseGoodreadsFeed(xml);

        if (page === 1) {
          assertUnderstoodResponse({
            received,
            parsed: pageEntries.length,
            source: 'Goodreads',
          });
        }

        if (!pageEntries.length) {
          break;
        }

        entries.push(...pageEntries);

        if (
          received < GOODREADS_PAGE_SIZE ||
          entries.length >= options.maxItems
        ) {
          break;
        }
      }
    } catch (e) {
      if (e instanceof ImportListUnavailableError) {
        throw e;
      }
      throw new ImportListUnavailableError(
        `Goodreads did not return the shelf: ${
          e instanceof Error ? e.message : 'unknown error'
        }. The shelf must belong to a public profile.`
      );
    }

    return {
      entries: entries.slice(0, options.maxItems),
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new GoodreadsImportListProvider();
