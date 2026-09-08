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
} from '@server/lib/importlists/types';

/**
 * AniList anime lists, read through the public GraphQL API.
 *
 * Identifiers: `https://anilist.co/user/<name>/animelist`, optionally with a
 * status segment (`/animelist/Planning`), or just the username. Stored as
 * `<username>` or `<username>:<STATUS>`.
 *
 * AniList knows nothing about TMDB. The anime mapping this server maintains
 * (`server/api/animelist.ts`) is keyed on AniDB ids, not MyAnimeList ones, so
 * there is no id path to follow: entries resolve by title and year against
 * TMDB, preferring the English title and falling back to the Romaji one. The
 * MyAnimeList id is carried anyway, for a future mapping to use.
 */

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_STATUSES = [
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'DROPPED',
  'PAUSED',
  'REPEATING',
] as const;

type AniListStatus = (typeof ANILIST_STATUSES)[number];

/** AniList URLs use friendly names; the API wants the enum. */
const STATUS_ALIASES: Record<string, AniListStatus> = {
  watching: 'CURRENT',
  current: 'CURRENT',
  planning: 'PLANNING',
  plantowatch: 'PLANNING',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  paused: 'PAUSED',
  onhold: 'PAUSED',
  repeating: 'REPEATING',
  rewatching: 'REPEATING',
};

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,50}$/;

const LIST_QUERY = `
query ($userName: String, $status: MediaListStatus) {
  MediaListCollection(userName: $userName, type: ANIME, status: $status) {
    lists {
      name
      entries {
        media {
          id
          idMal
          seasonYear
          format
          title { romaji english }
        }
      }
    }
  }
}`;

interface AniListMedia {
  id?: number;
  idMal?: number | null;
  seasonYear?: number | null;
  format?: string | null;
  title?: { romaji?: string | null; english?: string | null };
}

interface AniListResponse {
  data?: {
    MediaListCollection?: {
      lists?: { name?: string; entries?: { media?: AniListMedia }[] }[];
    };
  };
  errors?: { message?: string }[];
}

class AniListAPI extends ExternalAPI {
  constructor() {
    super(
      ANILIST_GRAPHQL_URL,
      {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );
  }

  public async getAnimeList(
    userName: string,
    status?: AniListStatus
  ): Promise<AniListResponse> {
    return this.post<AniListResponse>(
      '',
      { query: LIST_QUERY, variables: { userName, status: status ?? null } },
      undefined,
      3600
    );
  }
}

/**
 * AniList `format` distinguishes a film from a series. Movies map to TMDB
 * movies; everything else (TV, OVA, ONA, special) is treated as a series.
 */
const formatToMediaType = (format: string | null | undefined): MediaType =>
  format === 'MOVIE' ? MediaType.MOVIE : MediaType.TV;

export const aniListMediaToEntry = (
  media: AniListMedia | undefined
): ImportListEntry | undefined => {
  if (!media) {
    return undefined;
  }

  const title =
    media.title?.english?.trim() || media.title?.romaji?.trim() || undefined;
  const malId =
    typeof media.idMal === 'number' && media.idMal > 0
      ? media.idMal
      : undefined;

  if (!title && !malId) {
    return undefined;
  }

  return {
    title,
    year:
      typeof media.seasonYear === 'number' && media.seasonYear > 0
        ? media.seasonYear
        : undefined,
    mediaType: formatToMediaType(media.format),
    malId,
  };
};

class AniListImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.ANILIST;
  public readonly label = 'AniList';
  public readonly mediaKinds = [MediaType.MOVIE, MediaType.TV] as const;
  public readonly example = 'https://anilist.co/user/username/animelist';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    let username: string | undefined;
    let status: AniListStatus | undefined;

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'anilist.co') {
        throw new ImportListIdentifierError('That is not an AniList URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] !== 'user' || !segments[1]) {
        throw new ImportListIdentifierError(
          'Use an AniList profile URL such as https://anilist.co/user/username/animelist.'
        );
      }
      username = segments[1];
      const statusSegment = segments[3];
      if (statusSegment) {
        const resolved = STATUS_ALIASES[statusSegment.toLowerCase()];
        if (!resolved) {
          throw new ImportListIdentifierError(
            `"${statusSegment}" is not an AniList list status.`
          );
        }
        status = resolved;
      }
    } else {
      const [name, rawStatus] = identifier.split(':');
      username = name;
      if (rawStatus) {
        const resolved =
          STATUS_ALIASES[rawStatus.toLowerCase()] ??
          (ANILIST_STATUSES as readonly string[]).find(
            (value) => value === rawStatus.toUpperCase()
          );
        if (!resolved) {
          throw new ImportListIdentifierError(
            `"${rawStatus}" is not an AniList list status.`
          );
        }
        status = resolved as AniListStatus;
      }
    }

    if (!username || !USERNAME_PATTERN.test(username)) {
      throw new ImportListIdentifierError(
        'That AniList username is not valid.'
      );
    }

    return {
      provider: ImportListProviderId.ANILIST,
      listId: status ? `${username}:${status}` : username,
      name: status
        ? `${username}'s AniList (${status.toLowerCase()})`
        : `${username}'s AniList`,
    };
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const [username, status] = list.listId.split(':');
    if (!username) {
      throw new ImportListIdentifierError(
        'Unrecognized AniList list identifier.'
      );
    }

    let response: AniListResponse;
    try {
      response = await new AniListAPI().getAnimeList(
        username,
        status as AniListStatus | undefined
      );
    } catch (e) {
      throw new ImportListUnavailableError(
        `AniList did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    if (response.errors?.length) {
      throw new ImportListUnavailableError(
        `AniList returned an error: ${
          response.errors[0]?.message ?? 'unknown error'
        }`
      );
    }

    const lists = response.data?.MediaListCollection?.lists ?? [];
    const entries: ImportListEntry[] = [];
    const seen = new Set<number>();

    for (const group of lists) {
      for (const item of group.entries ?? []) {
        const entry = aniListMediaToEntry(item.media);
        if (!entry) {
          continue;
        }
        // AniList returns the same anime in several groups when a user keeps
        // custom lists alongside the status lists.
        const dedupeKey = item.media?.id;
        if (typeof dedupeKey === 'number') {
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);
        }
        entries.push(entry);
      }
    }

    return {
      entries: entries.slice(0, options.maxItems),
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new AniListImportListProvider();
