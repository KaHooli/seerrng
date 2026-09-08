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
  isImdbId,
  requireNonEmptyIdentifier,
} from '@server/lib/importlists/types';

/**
 * Steven Lu's curated popular-movies feed: a single well-known JSON document,
 * so the only valid identifier is the literal "stevenlu".
 */

const STEVENLU_URL = 'https://s3.amazonaws.com/popular-movies';
const STEVENLU_LIST_ID = 'stevenlu';
const STEVENLU_LIST_NAME = 'Steven Lu Popular Movies';

interface StevenLuMovie {
  title?: string;
  imdb_id?: string;
  /** Present on every row of the live feed, so no lookup is needed. */
  tmdb_id?: number;
  poster_url?: string;
  genres?: string[];
}

class StevenLuAPI extends ExternalAPI {
  constructor() {
    super(
      STEVENLU_URL,
      {},
      { nodeCache: cacheManager.getCache('importlist').data }
    );
  }

  public async getMovies(): Promise<StevenLuMovie[]> {
    return this.get<StevenLuMovie[]>('/movies.json');
  }
}

export const stevenLuMovieToEntry = (
  movie: StevenLuMovie
): ImportListEntry | undefined => {
  const title = typeof movie.title === 'string' ? movie.title.trim() : '';
  const imdbId = isImdbId(movie.imdb_id) ? movie.imdb_id : undefined;
  const tmdbId =
    typeof movie.tmdb_id === 'number' &&
    Number.isSafeInteger(movie.tmdb_id) &&
    movie.tmdb_id > 0
      ? movie.tmdb_id
      : undefined;

  if (!title && !imdbId && !tmdbId) {
    return undefined;
  }

  return {
    title: title || undefined,
    imdbId,
    // The feed names the TMDB id outright, so carrying it here spares the
    // resolver a /find lookup for every item in the list.
    tmdbId,
    mediaType: MediaType.MOVIE,
  };
};

class StevenLuImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.STEVENLU;
  public readonly label = 'Steven Lu';
  public readonly mediaKinds = [MediaType.MOVIE] as const;
  public readonly example = 'stevenlu';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input).toLowerCase();

    if (identifier !== STEVENLU_LIST_ID) {
      throw new ImportListIdentifierError(
        'The Steven Lu list has a single identifier: "stevenlu".'
      );
    }

    return {
      provider: ImportListProviderId.STEVENLU,
      listId: STEVENLU_LIST_ID,
      name: STEVENLU_LIST_NAME,
    };
  }

  public async fetch(
    _list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    let movies: StevenLuMovie[];
    try {
      movies = await new StevenLuAPI().getMovies();
    } catch (e) {
      throw new ImportListUnavailableError(
        `Could not read the Steven Lu list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    if (!Array.isArray(movies)) {
      throw new ImportListUnavailableError(
        'The Steven Lu list did not return the expected format.'
      );
    }

    const entries = movies
      .map(stevenLuMovieToEntry)
      .filter((entry): entry is ImportListEntry => entry !== undefined);

    return {
      entries: entries.slice(0, options.maxItems),
      name: STEVENLU_LIST_NAME,
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new StevenLuImportListProvider();
