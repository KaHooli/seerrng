import type {
  ImportListBookFormat,
  ImportListItemStatus,
  ImportListMode,
  ImportListProviderId,
  ImportListSyncStatus,
} from '@server/constants/importList';
import type { MediaType } from '@server/constants/media';

/** One configured list, as the user settings tab renders it. */
export interface ImportListResponse {
  id: number;
  provider: ImportListProviderId;
  providerLabel: string;
  listId: string;
  name: string;
  enabled: boolean;
  mode: ImportListMode;
  is4k: boolean;
  bookFormat?: ImportListBookFormat | null;
  lastSyncedAt?: string | null;
  lastSyncStatus: ImportListSyncStatus;
  lastSyncError?: string | null;
  itemCount: number;
  lastRequestedCount: number;
  lastSkippedCount: number;
  lastErrorCount: number;
  createdAt: string;
}

/** What the provider picker needs to render itself. */
export interface ImportListProviderInfo {
  id: ImportListProviderId;
  label: string;
  mediaKinds: MediaType[];
  example: string;
  /** False when an admin credential this provider needs is missing. */
  configured: boolean;
  /** True for providers that need a Bookshelf service to be usable. */
  requiresBookshelf: boolean;
}

export interface ImportListsResponse {
  results: ImportListResponse[];
  providers: ImportListProviderInfo[];
  /** Whether book providers are usable on this install right now. */
  bookshelfConfigured: boolean;
}

/** The summary card on a user's profile. */
export interface ImportListSummaryResponse {
  total: number;
  enabled: number;
  errored: number;
  lastSyncedAt?: string | null;
  /** Titles requested by the most recent sync of each list, summed. */
  lastRequestedCount: number;
  itemCount: number;
  lists: {
    id: number;
    name: string;
    provider: ImportListProviderId;
    providerLabel: string;
    enabled: boolean;
    lastSyncStatus: ImportListSyncStatus;
    lastSyncedAt?: string | null;
    lastSyncError?: string | null;
    itemCount: number;
    lastRequestedCount: number;
  }[];
}

export interface CreateImportListBody {
  provider: ImportListProviderId;
  /** Whatever the user pasted; normalized server-side. */
  listId: string;
  name?: string;
  mode?: ImportListMode;
  is4k?: boolean;
  bookFormat?: ImportListBookFormat;
  enabled?: boolean;
}

export type UpdateImportListBody = Partial<
  Pick<
    CreateImportListBody,
    'name' | 'mode' | 'is4k' | 'bookFormat' | 'enabled'
  >
>;

export interface ImportListSyncResultResponse {
  listId: number;
  status: ImportListSyncStatus;
  itemCount: number;
  requested: number;
  skipped: number;
  errored: number;
  error?: string;
}

export interface ImportListItemResponse {
  id: number;
  mediaType: MediaType;
  tmdbId?: number | null;
  externalId?: string | null;
  title: string;
  year?: number | null;
  status: ImportListItemStatus;
  message?: string | null;
  processedAt: string;
}
