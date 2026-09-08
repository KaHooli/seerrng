import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
import logger from '@server/logger';
import type { ImportListEntry } from './types';

/**
 * Turns a provider's raw entry into something Seerr can actually request.
 *
 * Providers hand back whatever the source gave them — a TMDB id, an IMDb id, a
 * bare title. This is the one place that closes that gap, in a fixed order of
 * preference: an exact id beats a lookup, and a lookup beats a title search.
 *
 * Resolutions are persisted on the ImportListItem row by the sync engine, so a
 * repeat sync of a settled list does no work here at all.
 */

export interface ResolvedMovieOrTv {
  mediaType: MediaType.MOVIE | MediaType.TV;
  tmdbId: number;
  tvdbId?: number;
  title: string;
  year?: number;
}

export interface ResolvedBook {
  mediaType: MediaType.BOOK;
  openLibraryId: string;
  title: string;
  year?: number;
}

export type ResolvedImportListEntry = ResolvedMovieOrTv | ResolvedBook;

const WORK_KEY_PATTERN = /^\/works\/(OL\d+W)$/i;

const displayTitle = (entry: ImportListEntry, fallback?: string): string =>
  (entry.title ?? fallback ?? 'Unknown title').slice(0, 255);

const firstResult = (results: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(results) || !results.length) {
    return undefined;
  }
  const first = results[0];
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)
    : undefined;
};

const tmdbIdOf = (result: Record<string, unknown>): number | undefined =>
  typeof result.id === 'number' &&
  Number.isSafeInteger(result.id) &&
  result.id > 0
    ? result.id
    : undefined;

const titleOf = (result: Record<string, unknown>): string | undefined =>
  typeof result.title === 'string'
    ? result.title
    : typeof result.name === 'string'
      ? result.name
      : undefined;

const yearOf = (result: Record<string, unknown>): number | undefined => {
  const date = result.release_date ?? result.first_air_date;
  if (typeof date !== 'string') {
    return undefined;
  }
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : undefined;
};

/** Resolves an IMDb id through TMDB's /find endpoint. */
const resolveByImdbId = async (
  tmdb: TheMovieDb,
  entry: ImportListEntry
): Promise<ResolvedMovieOrTv | undefined> => {
  if (!entry.imdbId) {
    return undefined;
  }

  const response = await tmdb.getByExternalId({
    externalId: entry.imdbId,
    type: 'imdb',
  });

  // Honour the entry's own type hint when the id matches more than one kind.
  const preferTv = entry.mediaType === MediaType.TV;
  const movie = firstResult(response.movie_results);
  const tv = firstResult(response.tv_results);
  const chosen = preferTv ? (tv ?? movie) : (movie ?? tv);
  const chosenIsTv = chosen === tv && tv !== undefined;

  if (!chosen) {
    return undefined;
  }

  const tmdbId = tmdbIdOf(chosen);
  if (!tmdbId) {
    return undefined;
  }

  return {
    mediaType: chosenIsTv ? MediaType.TV : MediaType.MOVIE,
    tmdbId,
    title: displayTitle(entry, titleOf(chosen)),
    year: entry.year ?? yearOf(chosen),
  };
};

/** Resolves a TVDB series id through TMDB's /find endpoint. */
const resolveByTvdbId = async (
  tmdb: TheMovieDb,
  entry: ImportListEntry
): Promise<ResolvedMovieOrTv | undefined> => {
  if (!entry.tvdbId) {
    return undefined;
  }

  const response = await tmdb.getByExternalId({
    externalId: entry.tvdbId,
    type: 'tvdb',
  });

  const tv = firstResult(response.tv_results);
  const tmdbId = tv ? tmdbIdOf(tv) : undefined;
  if (!tv || !tmdbId) {
    return undefined;
  }

  return {
    mediaType: MediaType.TV,
    tmdbId,
    tvdbId: entry.tvdbId,
    title: displayTitle(entry, titleOf(tv)),
    year: entry.year ?? yearOf(tv),
  };
};

/**
 * Last resort: a TMDB title search. Searching with a year first and retrying
 * without it matters — list sources disagree with TMDB about release years more
 * often than they get the title wrong.
 */
const resolveByTitle = async (
  tmdb: TheMovieDb,
  entry: ImportListEntry
): Promise<ResolvedMovieOrTv | undefined> => {
  const query = entry.title?.trim();
  if (!query) {
    return undefined;
  }

  const searchTv = entry.mediaType === MediaType.TV;

  for (const year of entry.year ? [entry.year, undefined] : [undefined]) {
    const response = searchTv
      ? await tmdb.searchTvShows({ query, year })
      : await tmdb.searchMovies({ query, year });

    const result = firstResult(response.results);
    const tmdbId = result ? tmdbIdOf(result) : undefined;
    if (result && tmdbId) {
      return {
        mediaType: searchTv ? MediaType.TV : MediaType.MOVIE,
        tmdbId,
        title: displayTitle(entry, titleOf(result)),
        year: entry.year ?? yearOf(result),
      };
    }
  }

  return undefined;
};

/**
 * Books resolve to an Open Library work id, which is how Seerr identifies a
 * book. An ISBN is exact; a title-and-author search is not, so it takes the
 * top hit and nothing more clever.
 */
const resolveBook = async (
  entry: ImportListEntry
): Promise<ResolvedBook | undefined> => {
  if (entry.openLibraryId) {
    return {
      mediaType: MediaType.BOOK,
      openLibraryId: normalizeOpenLibraryWorkId(entry.openLibraryId),
      title: displayTitle(entry),
      year: entry.year,
    };
  }

  const openLibrary = new OpenLibraryAPI();

  const queries = [
    entry.isbn ? `isbn:${entry.isbn}` : undefined,
    entry.title && entry.author
      ? `${entry.title} ${entry.author}`
      : entry.title,
  ].filter((query): query is string => !!query);

  for (const query of queries) {
    const response = await openLibrary.searchBooks({ query, limit: 1 });
    const doc = response.docs[0];
    const match = doc?.key ? WORK_KEY_PATTERN.exec(doc.key) : null;
    if (doc && match) {
      return {
        mediaType: MediaType.BOOK,
        openLibraryId: normalizeOpenLibraryWorkId(match[1]),
        title: displayTitle(entry, doc.title),
        year: entry.year ?? doc.first_publish_year,
      };
    }
  }

  return undefined;
};

/**
 * Resolve one entry, or return undefined when nothing matched — which the sync
 * engine records as `not_found` rather than treating as an error.
 */
export const resolveImportListEntry = async (
  entry: ImportListEntry
): Promise<ResolvedImportListEntry | undefined> => {
  try {
    if (entry.mediaType === MediaType.BOOK) {
      return await resolveBook(entry);
    }

    // An id we already have beats every lookup below it.
    if (entry.tmdbId && entry.mediaType) {
      return {
        mediaType:
          entry.mediaType === MediaType.TV ? MediaType.TV : MediaType.MOVIE,
        tmdbId: entry.tmdbId,
        tvdbId: entry.tvdbId,
        title: displayTitle(entry),
        year: entry.year,
      };
    }

    const tmdb = new TheMovieDb();

    return (
      (await resolveByImdbId(tmdb, entry)) ??
      (await resolveByTvdbId(tmdb, entry)) ??
      (await resolveByTitle(tmdb, entry))
    );
  } catch (e) {
    logger.debug('Failed to resolve import list entry', {
      label: 'Import List Sync',
      title: entry.title,
      errorMessage: e instanceof Error ? e.message : 'unknown error',
    });
    return undefined;
  }
};
