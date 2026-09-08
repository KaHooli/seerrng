import {
  ImportListBookFormat,
  ImportListItemStatus,
  ImportListMode,
  ImportListSyncStatus,
  isBookImportListProvider,
} from '@server/constants/importList';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { ImportList } from '@server/entity/ImportList';
import { ImportListItem } from '@server/entity/ImportListItem';
import Media from '@server/entity/Media';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { getImportListProvider } from '@server/lib/importlists/providers';
import type { ResolvedImportListEntry } from '@server/lib/importlists/resolver';
import { resolveImportListEntry } from '@server/lib/importlists/resolver';
import type { ImportListEntry } from '@server/lib/importlists/types';
import {
  ImportListIdentifierError,
  ImportListNotConfiguredError,
  ImportListUnavailableError,
} from '@server/lib/importlists/types';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { mapWithConcurrency } from '@server/utils/concurrency';

type MediaRequestFormat = 'ebook' | 'audiobook' | 'both';

const LABEL = 'Import List Sync';
/** Keeps one runaway error message out of a 512-char column. */
const MAX_ERROR_LENGTH = 500;

export interface ImportListSyncOutcome {
  listId: number;
  status: ImportListSyncStatus;
  itemCount: number;
  requested: number;
  skipped: number;
  errored: number;
  error?: string;
}

/** Raised when a list is cancelled mid-run; not an error worth recording. */
class SyncCancelledError extends Error {}

const truncate = (message: string): string =>
  message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : message;

/**
 * Auto-request permission for the media type an entry resolved to. Mirrors the
 * gate Plex watchlist sync applies, so a user cannot get more through an import
 * list than they can through their watchlist.
 */
const autoRequestPermissionsFor = (mediaType: MediaType): Permission[] => {
  switch (mediaType) {
    case MediaType.MOVIE:
      return [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MOVIE];
    case MediaType.TV:
      return [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_TV];
    case MediaType.BOOK:
      return [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_BOOK];
    default:
      return [Permission.AUTO_REQUEST];
  }
};

/** A list can only be synced by someone who is still allowed to own one. */
const canSyncLists = (user: User): boolean =>
  user.hasPermission(Permission.MANAGE_IMPORT_LISTS);

const bookshelfIsConfigured = (): boolean =>
  getExternalRuntimeConfig().readarr.some((service) => service.isDefault);

const identityKey = (resolved: ResolvedImportListEntry): string =>
  resolved.mediaType === MediaType.BOOK
    ? `${MediaType.BOOK}:${resolved.openLibraryId}`
    : `${resolved.mediaType}:${resolved.tmdbId}`;

/** Statuses that mean "this item has been dealt with; don't retry it". */
const SETTLED_STATUSES = new Set<ImportListItemStatus>([
  ImportListItemStatus.REQUESTED,
  ImportListItemStatus.ALREADY_AVAILABLE,
  ImportListItemStatus.ALREADY_REQUESTED,
  ImportListItemStatus.WATCHLISTED,
]);

class ImportListSync {
  private running = false;
  private cancelRequested = false;

  public status(): { running: boolean } {
    return { running: this.running };
  }

  public cancel(): void {
    if (this.running) {
      this.cancelRequested = true;
      logger.info('Import list sync cancellation requested', { label: LABEL });
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelRequested) {
      throw new SyncCancelledError('Import list sync cancelled.');
    }
  }

  /** Entry point for the scheduled job. */
  public async syncImportLists(): Promise<void> {
    if (this.running) {
      logger.warn('Import list sync is already running; skipping this run', {
        label: LABEL,
      });
      return;
    }

    const settings = getSettings().importLists;
    if (!settings.enabled) {
      logger.debug('Import list syncing is disabled in settings', {
        label: LABEL,
      });
      return;
    }

    this.running = true;
    this.cancelRequested = false;

    try {
      const lists = await getRepository(ImportList).find({
        where: { enabled: true },
        relations: { user: true },
        order: { id: 'ASC' },
      });

      if (!lists.length) {
        return;
      }

      logger.info(`Syncing ${lists.length} import list(s)`, { label: LABEL });

      // Lists run concurrently up to the configured limit. Requesting is safe
      // to overlap: MediaRequest.request takes its own per-user lock, so two of
      // one user's lists cannot race each other's quota.
      await mapWithConcurrency(
        lists,
        Math.max(1, settings.syncConcurrency),
        async (list) => {
          if (this.cancelRequested) {
            return;
          }

          try {
            await this.runList(list);
          } catch (e) {
            if (e instanceof SyncCancelledError) {
              return;
            }
            logger.error('Unhandled failure while syncing an import list', {
              label: LABEL,
              listId: list.id,
              errorMessage: e instanceof Error ? e.message : 'unknown error',
            });
          }
        }
      );

      if (this.cancelRequested) {
        logger.info('Import list sync cancelled before completing all lists', {
          label: LABEL,
        });
      }
    } finally {
      this.running = false;
      this.cancelRequested = false;
    }
  }

  /**
   * Sync one list on demand. Used by the "Sync now" button, and unlike the
   * scheduled run it reports what happened rather than only logging it.
   */
  public async syncSingleList(listId: number): Promise<ImportListSyncOutcome> {
    const list = await getRepository(ImportList).findOne({
      where: { id: listId },
      relations: { user: true },
    });

    if (!list) {
      throw new Error(`Import list ${listId} does not exist.`);
    }

    return this.runList(list);
  }

  private async runList(list: ImportList): Promise<ImportListSyncOutcome> {
    const settings = getSettings().importLists;

    // Reload the owner under the security lock: permissions may have changed
    // since the list rows were read, and a revoked user must not sync.
    const owner = await runUserSecurityMutation(list.user.id, async () => {
      const user = await getRepository(User)
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.settings', 'settings')
        .where('user.id = :userId', { userId: list.user.id })
        .getOne();

      return user && canSyncLists(user) ? user : undefined;
    });

    if (!owner) {
      return this.finish(list, {
        status: ImportListSyncStatus.ERROR,
        error: 'The list owner no longer has permission to sync import lists.',
        itemCount: 0,
        requested: 0,
        skipped: 0,
        errored: 0,
      });
    }

    if (isBookImportListProvider(list.provider) && !bookshelfIsConfigured()) {
      return this.finish(list, {
        status: ImportListSyncStatus.ERROR,
        error:
          'Book lists need a default Bookshelf service under Settings → Services.',
        itemCount: 0,
        requested: 0,
        skipped: 0,
        errored: 0,
      });
    }

    let entries: ImportListEntry[];
    try {
      const provider = getImportListProvider(list.provider);

      if (!provider.isConfigured()) {
        return this.finish(list, {
          status: ImportListSyncStatus.ERROR,
          error: `${provider.label} is missing credentials in Settings → Import Lists.`,
          itemCount: 0,
          requested: 0,
          skipped: 0,
          errored: 0,
        });
      }

      const result = await provider.fetch(
        { provider: list.provider, listId: list.listId, name: list.name },
        { maxItems: settings.maxItemsPerList }
      );
      entries = result.entries;

      if (result.truncated) {
        logger.warn('Import list reached the configured per-list item limit', {
          label: LABEL,
          listId: list.id,
          limit: settings.maxItemsPerList,
        });
      }
    } catch (e) {
      if (
        e instanceof ImportListUnavailableError ||
        e instanceof ImportListNotConfiguredError ||
        e instanceof ImportListIdentifierError
      ) {
        return this.finish(list, {
          status: ImportListSyncStatus.ERROR,
          error: e.message,
          itemCount: 0,
          requested: 0,
          skipped: 0,
          errored: 0,
        });
      }
      throw e;
    }

    return this.processEntries(list, owner, entries);
  }

  private async processEntries(
    list: ImportList,
    owner: User,
    entries: ImportListEntry[]
  ): Promise<ImportListSyncOutcome> {
    const itemRepository = getRepository(ImportListItem);

    const existingItems = await itemRepository.find({
      where: { importList: { id: list.id } },
    });
    const settledKeys = new Set(
      existingItems
        .filter((item) => SETTLED_STATUSES.has(item.status))
        .map((item) =>
          item.tmdbId
            ? `${item.mediaType}:${item.tmdbId}`
            : `${item.mediaType}:${item.externalId}`
        )
    );

    let requested = 0;
    let skipped = 0;
    let errored = 0;
    const seen = new Set<string>();
    const rows: ImportListItem[] = [];

    for (const entry of entries) {
      this.throwIfCancelled();

      const resolved = await resolveImportListEntry(entry);

      if (!resolved) {
        errored += 1;
        rows.push(
          new ImportListItem({
            importList: list,
            mediaType: entry.mediaType ?? MediaType.MOVIE,
            title: (entry.title ?? 'Unknown title').slice(0, 255),
            year: entry.year ?? null,
            status: ImportListItemStatus.NOT_FOUND,
            message: 'No matching title was found.',
          })
        );
        continue;
      }

      const key = identityKey(resolved);

      // The same title can appear twice in one list, and settled items from a
      // previous run never need touching again.
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (settledKeys.has(key)) {
        skipped += 1;
        continue;
      }

      const outcome = await this.applyEntry(list, owner, resolved);
      if (outcome.status === ImportListItemStatus.REQUESTED) {
        requested += 1;
      } else if (
        outcome.status === ImportListItemStatus.REQUEST_FAILED ||
        outcome.status === ImportListItemStatus.NOT_FOUND
      ) {
        errored += 1;
      } else {
        skipped += 1;
      }

      rows.push(
        new ImportListItem({
          importList: list,
          mediaType: resolved.mediaType,
          tmdbId:
            resolved.mediaType === MediaType.BOOK ? null : resolved.tmdbId,
          externalId:
            resolved.mediaType === MediaType.BOOK
              ? resolved.openLibraryId
              : null,
          title: resolved.title,
          year: resolved.year ?? null,
          status: outcome.status,
          message: outcome.message ? truncate(outcome.message) : null,
        })
      );
    }

    await this.persistItems(list, rows);

    return this.finish(list, {
      status: errored
        ? requested || skipped
          ? ImportListSyncStatus.PARTIAL
          : ImportListSyncStatus.ERROR
        : ImportListSyncStatus.SUCCESS,
      itemCount: entries.length,
      requested,
      skipped,
      errored,
    });
  }

  /** Requests or watchlists one resolved entry, classifying the outcome. */
  private async applyEntry(
    list: ImportList,
    owner: User,
    resolved: ResolvedImportListEntry
  ): Promise<{ status: ImportListItemStatus; message?: string }> {
    if (resolved.mediaType !== MediaType.BOOK) {
      const media = await Media.getRelatedMedia(owner, [
        { tmdbId: resolved.tmdbId, mediaType: resolved.mediaType },
      ]);

      const existing = media.find(
        (candidate) =>
          candidate.tmdbId === resolved.tmdbId &&
          candidate.mediaType === resolved.mediaType
      );

      if (existing?.status === MediaStatus.BLOCKLISTED) {
        return {
          status: ImportListItemStatus.SKIPPED,
          message: 'Blocklisted.',
        };
      }

      // A movie is "done" as soon as it is anything but unknown or deleted; a
      // series only once it is fully available. Same rule Plex watchlist sync
      // uses, so the two features agree on what still needs requesting.
      const alreadyHandled =
        existing &&
        (resolved.mediaType === MediaType.MOVIE
          ? existing.status !== MediaStatus.UNKNOWN &&
            existing.status !== MediaStatus.DELETED
          : existing.status === MediaStatus.AVAILABLE);

      if (alreadyHandled) {
        return { status: ImportListItemStatus.ALREADY_AVAILABLE };
      }
    }

    if (list.mode === ImportListMode.WATCHLIST) {
      return this.addToWatchlist(owner, resolved);
    }

    if (
      !owner.hasPermission(autoRequestPermissionsFor(resolved.mediaType), {
        type: 'or',
      })
    ) {
      return {
        status: ImportListItemStatus.SKIPPED,
        message: 'The list owner cannot auto-request this media type.',
      };
    }

    try {
      await MediaRequest.request(
        resolved.mediaType === MediaType.BOOK
          ? {
              mediaId: resolved.openLibraryId,
              mediaType: MediaType.BOOK,
              format: (list.bookFormat ??
                ImportListBookFormat.EBOOK) as MediaRequestFormat,
            }
          : {
              mediaId: resolved.tmdbId,
              mediaType: resolved.mediaType,
              seasons: resolved.mediaType === MediaType.TV ? 'all' : undefined,
              tvdbId: resolved.tvdbId,
              is4k: list.is4k,
            },
        owner,
        { isAutoRequest: true }
      );

      logger.info('Created a media request from an import list', {
        label: LABEL,
        listId: list.id,
        userId: owner.id,
        mediaTitle: resolved.title,
      });

      return { status: ImportListItemStatus.REQUESTED };
    } catch (e) {
      return this.classifyRequestError(e, list, owner, resolved);
    }
  }

  private async addToWatchlist(
    owner: User,
    resolved: ResolvedImportListEntry
  ): Promise<{ status: ImportListItemStatus; message?: string }> {
    try {
      await Watchlist.createWatchlist({
        watchlistRequest:
          resolved.mediaType === MediaType.BOOK
            ? {
                mediaType: MediaType.BOOK,
                externalId: resolved.openLibraryId,
                title: resolved.title,
              }
            : {
                mediaType: resolved.mediaType,
                tmdbId: resolved.tmdbId,
                title: resolved.title,
              },
        user: owner,
      });

      return { status: ImportListItemStatus.WATCHLISTED };
    } catch (e) {
      // A title already on the watchlist is the expected steady state, not a
      // failure worth reporting.
      if (e instanceof Error && e.name === 'DuplicateWatchlistRequestError') {
        return { status: ImportListItemStatus.ALREADY_REQUESTED };
      }

      logger.debug('Failed to add an import list item to the watchlist', {
        label: LABEL,
        userId: owner.id,
        mediaTitle: resolved.title,
        errorMessage: e instanceof Error ? e.message : 'unknown error',
      });

      return {
        status: ImportListItemStatus.REQUEST_FAILED,
        message: e instanceof Error ? e.message : 'unknown error',
      };
    }
  }

  /**
   * These errors are the normal weather of an auto-syncing feature — a user at
   * their quota, a title already requested — so they are logged at debug and
   * recorded per item rather than failing the list.
   */
  private classifyRequestError(
    e: unknown,
    list: ImportList,
    owner: User,
    resolved: ResolvedImportListEntry
  ): { status: ImportListItemStatus; message?: string } {
    if (!(e instanceof Error)) {
      return { status: ImportListItemStatus.REQUEST_FAILED };
    }

    switch (e.constructor) {
      case DuplicateMediaRequestError:
        return { status: ImportListItemStatus.ALREADY_REQUESTED };
      case BlocklistedMediaError:
        return {
          status: ImportListItemStatus.SKIPPED,
          message: 'Blocklisted.',
        };
      case RequestPermissionError:
      case QuotaRestrictedError:
      case NoSeasonsAvailableError:
        logger.debug('Skipped an import list item', {
          label: LABEL,
          listId: list.id,
          userId: owner.id,
          mediaTitle: resolved.title,
          errorMessage: e.message,
        });
        return {
          status: ImportListItemStatus.SKIPPED,
          message: e.message,
        };
      default:
        logger.error('Failed to create a media request from an import list', {
          label: LABEL,
          listId: list.id,
          userId: owner.id,
          mediaTitle: resolved.title,
          errorMessage: e.message,
        });
        return {
          status: ImportListItemStatus.REQUEST_FAILED,
          message: e.message,
        };
    }
  }

  /**
   * Item rows are upserted one at a time: a single unique-constraint clash
   * (the same title reached by two different ids) must not lose the rest of
   * the run's results.
   */
  private async persistItems(
    list: ImportList,
    rows: ImportListItem[]
  ): Promise<void> {
    const itemRepository = getRepository(ImportListItem);

    for (const row of rows) {
      try {
        const existing = await itemRepository.findOne({
          where: {
            importList: { id: list.id },
            mediaType: row.mediaType,
            ...(row.tmdbId
              ? { tmdbId: row.tmdbId }
              : { externalId: row.externalId ?? undefined }),
          },
        });

        if (existing) {
          existing.status = row.status;
          existing.message = row.message;
          existing.title = row.title;
          existing.year = row.year;
          existing.processedAt = new Date();
          await itemRepository.save(existing);
        } else {
          await itemRepository.save(row);
        }
      } catch (e) {
        logger.debug('Could not record an import list item', {
          label: LABEL,
          listId: list.id,
          title: row.title,
          errorMessage: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }
  }

  private async finish(
    list: ImportList,
    outcome: Omit<ImportListSyncOutcome, 'listId'>
  ): Promise<ImportListSyncOutcome> {
    const listRepository = getRepository(ImportList);

    list.lastSyncedAt = new Date();
    list.lastSyncStatus = outcome.status;
    list.lastSyncError = outcome.error ? truncate(outcome.error) : null;
    list.itemCount = outcome.itemCount;
    list.lastRequestedCount = outcome.requested;
    list.lastSkippedCount = outcome.skipped;
    list.lastErrorCount = outcome.errored;

    await listRepository.save(list);

    if (outcome.status === ImportListSyncStatus.ERROR) {
      logger.warn('Import list sync finished with an error', {
        label: LABEL,
        listId: list.id,
        provider: list.provider,
        errorMessage: outcome.error,
      });
    } else {
      logger.info('Import list sync finished', {
        label: LABEL,
        listId: list.id,
        provider: list.provider,
        items: outcome.itemCount,
        requested: outcome.requested,
        skipped: outcome.skipped,
        errored: outcome.errored,
      });
    }

    return { listId: list.id, ...outcome };
  }
}

const importListSync = new ImportListSync();

export default importListSync;
