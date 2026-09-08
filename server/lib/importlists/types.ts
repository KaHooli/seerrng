import type { ImportListProviderId } from '@server/constants/importList';
import type { MediaType } from '@server/constants/media';

/**
 * One item as the source list describes it. Providers fill in whatever ids they
 * have; the resolver (`./resolver`) turns that into something Seerr can
 * request. Providers must not guess ids they were not given — a title and year
 * with no id is a perfectly normal entry.
 */
export interface ImportListEntry {
  title?: string;
  year?: number;
  /** Hint from the source. Undefined means "the resolver should decide". */
  mediaType?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  /** MyAnimeList id, used by AniList to reach TMDB through the anime mapping. */
  malId?: number;
  openLibraryId?: string;
  isbn?: string;
  author?: string;
}

/** A list identifier after the provider has normalized whatever a user pasted. */
export interface ParsedImportList {
  provider: ImportListProviderId;
  /** Canonical id, stored on the ImportList row. */
  listId: string;
  /** Best-effort display name derived from the identifier alone. */
  name: string;
}

export interface ImportListFetchOptions {
  /** Hard cap on items returned. Providers stop paging once they reach it. */
  maxItems: number;
}

export interface ImportListFetchResult {
  entries: ImportListEntry[];
  /** A name discovered from the source itself, better than `parse` guessed. */
  name?: string;
  /** True when `maxItems` cut the list short. */
  truncated: boolean;
}

export interface ImportListProvider {
  readonly id: ImportListProviderId;
  /** Shown in the provider picker. */
  readonly label: string;
  /** Media kinds this provider can yield. */
  readonly mediaKinds: readonly MediaType[];
  /** Example identifier shown as the input placeholder. */
  readonly example: string;
  /**
   * False when the provider needs an admin-supplied credential that is not
   * configured. Such providers are hidden from the picker and skipped by syncs.
   */
  isConfigured(): boolean;
  /**
   * Normalize a full URL or the provider's own short form into a canonical id.
   * Throws {@link ImportListIdentifierError} when the input is not recognized.
   */
  parse(input: string): ParsedImportList;
  fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult>;
}

/** The user pasted something this provider cannot read. Surfaces as a 400. */
export class ImportListIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportListIdentifierError';
  }
}

/**
 * The source could not be read this time — network failure, rate limit, or a
 * bot block. The list keeps its configuration and is marked as errored so the
 * user can see why nothing synced, rather than silently syncing zero items.
 */
export class ImportListUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportListUnavailableError';
  }
}

/** The provider needs an admin credential that has not been configured. */
export class ImportListNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportListNotConfiguredError';
  }
}

/** Trims and collapses whitespace, then rejects empty input. */
export const requireNonEmptyIdentifier = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ImportListIdentifierError('A list identifier is required.');
  }
  return trimmed;
};

/**
 * Parse a user-supplied string as an http(s) URL, or return undefined when it
 * is one of a provider's short forms rather than a URL.
 */
export const asHttpUrl = (input: string): URL | undefined => {
  if (!/^https?:\/\//i.test(input)) {
    return undefined;
  }

  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

/** Turns "my-favourite-films" into "My Favourite Films" for a fallback name. */
export const titleizeSlug = (slug: string): string =>
  slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const IMDB_ID_PATTERN = /^tt\d{7,}$/;

export const isImdbId = (value: unknown): value is string =>
  typeof value === 'string' && IMDB_ID_PATTERN.test(value);

/** Extracts a four-digit year from a date string, or undefined. */
export const yearFromDate = (value: unknown): number | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(\d{4})/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  return Number.isInteger(year) && year > 1800 && year < 2200
    ? year
    : undefined;
};
