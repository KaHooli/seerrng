/**
 * Import list providers, mirroring the provider set of
 * https://github.com/KaHooli/list-sync so a user migrating from that tool can
 * paste the same list identifiers here.
 *
 * SIMKL is deliberately absent: its API has no public custom-list endpoint, and
 * list-sync disables the provider upstream for the same reason.
 */
export enum ImportListProviderId {
  IMDB = 'imdb',
  TRAKT = 'trakt',
  TMDB = 'tmdb',
  TMDB_COLLECTION = 'tmdb-collection',
  TVDB = 'tvdb',
  LETTERBOXD = 'letterboxd',
  ANILIST = 'anilist',
  MDBLIST = 'mdblist',
  STEVENLU = 'stevenlu',
  GOODREADS = 'goodreads',
  OPENLIBRARY = 'openlibrary',
}

export const ALL_IMPORT_LIST_PROVIDER_IDS = Object.values(ImportListProviderId);

export const isImportListProviderId = (
  value: unknown
): value is ImportListProviderId =>
  typeof value === 'string' &&
  ALL_IMPORT_LIST_PROVIDER_IDS.includes(value as ImportListProviderId);

/** What a sync does with the items a list yields. */
export enum ImportListMode {
  /** Auto-request as the list owner, subject to their permissions and quota. */
  REQUEST = 'request',
  /** Add to the list owner's watchlist and leave requesting to them. */
  WATCHLIST = 'watchlist',
}

export const isImportListMode = (value: unknown): value is ImportListMode =>
  value === ImportListMode.REQUEST || value === ImportListMode.WATCHLIST;

/** Seerr tracks the ebook and audiobook copy of a book separately. */
export enum ImportListBookFormat {
  EBOOK = 'ebook',
  AUDIOBOOK = 'audiobook',
  BOTH = 'both',
}

export const isImportListBookFormat = (
  value: unknown
): value is ImportListBookFormat =>
  value === ImportListBookFormat.EBOOK ||
  value === ImportListBookFormat.AUDIOBOOK ||
  value === ImportListBookFormat.BOTH;

/** Outcome of the most recent sync of a whole list. */
export enum ImportListSyncStatus {
  NEVER = 'never',
  SUCCESS = 'success',
  /** The list was read, but some of its items could not be processed. */
  PARTIAL = 'partial',
  /** The list itself could not be read. */
  ERROR = 'error',
}

/**
 * Per-item outcome. These values match list-sync's own status vocabulary so the
 * two tools describe the same result the same way.
 */
export enum ImportListItemStatus {
  REQUESTED = 'requested',
  ALREADY_AVAILABLE = 'already_available',
  ALREADY_REQUESTED = 'already_requested',
  WATCHLISTED = 'watchlisted',
  NOT_FOUND = 'not_found',
  SKIPPED = 'skipped',
  REQUEST_FAILED = 'request_failed',
}

/** Book providers are only usable when a Bookshelf service is configured. */
export const BOOK_IMPORT_LIST_PROVIDERS: readonly ImportListProviderId[] = [
  ImportListProviderId.GOODREADS,
  ImportListProviderId.OPENLIBRARY,
];

export const isBookImportListProvider = (
  provider: ImportListProviderId
): boolean => BOOK_IMPORT_LIST_PROVIDERS.includes(provider);
