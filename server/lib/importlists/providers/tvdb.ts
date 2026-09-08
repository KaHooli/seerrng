import Tvdb from '@server/api/tvdb';
import type { TvdbListEntity } from '@server/api/tvdb/interfaces';
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
  requireNonEmptyIdentifier,
} from '@server/lib/importlists/types';

/**
 * TVDB lists, identified by `https://www.thetvdb.com/lists/12345` or the bare
 * numeric id. Rows name a series or movie id, which the resolver turns into a
 * TMDB id; TVDB movie ids have no TMDB equivalent lookup, so movie rows are
 * carried by title where TVDB gives one.
 */

const parseNumericId = (value: string): number | undefined => {
  const match = /^(\d+)/.exec(value);
  if (!match) {
    return undefined;
  }
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

export const tvdbEntityToEntry = (
  entity: TvdbListEntity
): ImportListEntry | undefined => {
  if (typeof entity.seriesId === 'number' && entity.seriesId > 0) {
    return { tvdbId: entity.seriesId, mediaType: MediaType.TV };
  }

  // TVDB movie ids are not TVDB *series* ids and TMDB cannot look them up, so
  // there is nothing usable to carry forward for a movie row.
  return undefined;
};

class TvdbImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.TVDB;
  public readonly label = 'TVDB List';
  public readonly mediaKinds = [MediaType.TV] as const;
  public readonly example = 'https://www.thetvdb.com/lists/12345';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    let listId: number | undefined;

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'thetvdb.com') {
        throw new ImportListIdentifierError('That is not a TVDB URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const index = segments.indexOf('lists');
      const raw = index >= 0 ? segments[index + 1] : undefined;
      listId = raw ? parseNumericId(raw) : undefined;
    } else {
      listId = parseNumericId(identifier);
    }

    if (!listId) {
      throw new ImportListIdentifierError(
        'Use a TVDB list URL such as https://www.thetvdb.com/lists/12345.'
      );
    }

    return {
      provider: ImportListProviderId.TVDB,
      listId: String(listId),
      name: `TVDB List ${listId}`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const listId = Number(list.listId);
    if (!Number.isSafeInteger(listId) || listId <= 0) {
      throw new ImportListIdentifierError('Unrecognized TVDB list identifier.');
    }

    let entities: TvdbListEntity[];
    try {
      const tvdb = await Tvdb.getInstance();
      entities = await tvdb.getList(listId);
    } catch (e) {
      throw new ImportListUnavailableError(
        `TVDB did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    const entries = entities
      .map(tvdbEntityToEntry)
      .filter((entry): entry is ImportListEntry => entry !== undefined);

    return {
      entries: entries.slice(0, options.maxItems),
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new TvdbImportListProvider();
