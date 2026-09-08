import {
  ImportListItemStatus,
  ImportListMode,
  ImportListProviderId,
  ImportListSyncStatus,
} from '@server/constants/importList';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { ImportList } from '@server/entity/ImportList';
import { ImportListItem } from '@server/entity/ImportListItem';
import Media from '@server/entity/Media';
import {
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  DuplicateWatchlistRequestError,
  Watchlist,
} from '@server/entity/Watchlist';
import * as providerRegistry from '@server/lib/importlists/providers';
import * as resolver from '@server/lib/importlists/resolver';
import { ImportListUnavailableError } from '@server/lib/importlists/types';
import importListSync from '@server/lib/importlistsync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

setupTestDb();

afterEach(() => {
  mock.restoreAll();
});

const OWNER_PERMISSIONS =
  Permission.MANAGE_IMPORT_LISTS + Permission.AUTO_REQUEST + Permission.REQUEST;

/** Gives the seeded "friend" user the permissions an import list owner needs. */
const makeOwner = async (
  permissions: number = OWNER_PERMISSIONS
): Promise<User> => {
  const userRepository = getRepository(User);
  const user = await userRepository.findOneByOrFail({ id: 2 });
  user.permissions = permissions;
  return userRepository.save(user);
};

const makeList = async (
  owner: User,
  overrides: Partial<ImportList> = {}
): Promise<ImportList> =>
  getRepository(ImportList).save(
    new ImportList({
      user: owner,
      provider: ImportListProviderId.STEVENLU,
      listId: 'stevenlu',
      name: 'Steven Lu Popular Movies',
      enabled: true,
      mode: ImportListMode.REQUEST,
      is4k: false,
      lastSyncStatus: ImportListSyncStatus.NEVER,
      itemCount: 0,
      lastRequestedCount: 0,
      lastSkippedCount: 0,
      lastErrorCount: 0,
      ...overrides,
    })
  );

/** Replaces the provider registry so no test ever touches the network. */
const stubProvider = (
  entries: unknown[],
  { throws }: { throws?: Error } = {}
) => {
  mock.method(providerRegistry, 'getImportListProvider', () => ({
    id: ImportListProviderId.STEVENLU,
    label: 'Steven Lu',
    mediaKinds: [MediaType.MOVIE],
    example: 'stevenlu',
    isConfigured: () => true,
    parse: () => {
      throw new Error('not used');
    },
    fetch: async () => {
      if (throws) {
        throw throws;
      }
      return { entries, truncated: false };
    },
  }));
};

const stubResolver = (
  resolved: resolver.ResolvedImportListEntry | undefined
) => {
  mock.method(resolver, 'resolveImportListEntry', async () => resolved);
};

const A_MOVIE: resolver.ResolvedMovieOrTv = {
  mediaType: MediaType.MOVIE,
  tmdbId: 329865,
  title: 'Arrival',
  year: 2016,
};

beforeEach(() => {
  const settings = getSettings();
  settings.importLists.enabled = true;
  settings.importLists.maxItemsPerList = 500;
});

describe('import list sync', () => {
  it('requests an unseen title as the list owner', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(outcome.status, ImportListSyncStatus.SUCCESS);
    assert.equal(outcome.requested, 1);
    assert.equal(request.mock.callCount(), 1);

    const [body, user, options] = request.mock.calls[0].arguments;
    assert.equal(body?.mediaId, 329865);
    assert.equal(body?.mediaType, MediaType.MOVIE);
    assert.equal(user?.id, owner.id);
    assert.equal(options?.isAutoRequest, true);
  });

  it('skips a title that is already available', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => [
      {
        tmdbId: 329865,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
      },
    ]);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.requested, 0);
    assert.equal(outcome.status, ImportListSyncStatus.SUCCESS);
  });

  it('skips blocklisted media without requesting it', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => [
      {
        tmdbId: 329865,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.BLOCKLISTED,
      },
    ]);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    const items = await getRepository(ImportListItem).find();
    assert.equal(items[0].status, ImportListItemStatus.SKIPPED);
  });

  it('records a quota rejection as skipped, not as a failure', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    mock.method(MediaRequest, 'request', async () => {
      throw new QuotaRestrictedError('Quota exceeded.');
    });

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.errored, 0);
    assert.equal(outcome.status, ImportListSyncStatus.SUCCESS);
  });

  it('records a duplicate request as already requested', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    mock.method(MediaRequest, 'request', async () => {
      throw new DuplicateMediaRequestError('Already requested.');
    });

    await importListSync.syncSingleList(list.id);

    const items = await getRepository(ImportListItem).find();
    assert.equal(items[0].status, ImportListItemStatus.ALREADY_REQUESTED);
  });

  it('watchlists instead of requesting when the list says so', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner, { mode: ImportListMode.WATCHLIST });

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );
    const createWatchlist = mock.method(
      Watchlist,
      'createWatchlist',
      async () => ({}) as never
    );

    await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(createWatchlist.mock.callCount(), 1);

    const items = await getRepository(ImportListItem).find();
    assert.equal(items[0].status, ImportListItemStatus.WATCHLISTED);
  });

  it('records an unresolvable entry as not found', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Something Obscure', year: 1974 }]);
    stubResolver(undefined);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(outcome.errored, 1);
    assert.equal(outcome.status, ImportListSyncStatus.ERROR);

    const items = await getRepository(ImportListItem).find();
    assert.equal(items[0].status, ImportListItemStatus.NOT_FOUND);
    assert.equal(items[0].title, 'Something Obscure');
  });

  it('marks the list errored when the source cannot be read', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([], {
      throws: new ImportListUnavailableError('IMDb served its bot check.'),
    });

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(outcome.status, ImportListSyncStatus.ERROR);
    assert.match(outcome.error ?? '', /bot check/);

    const stored = await getRepository(ImportList).findOneByOrFail({
      id: list.id,
    });
    assert.equal(stored.lastSyncStatus, ImportListSyncStatus.ERROR);
    assert.match(stored.lastSyncError ?? '', /bot check/);
  });

  it('refuses to sync for an owner without the import list permission', async () => {
    const owner = await makeOwner(Permission.REQUEST);
    const list = await makeList(owner);

    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(outcome.status, ImportListSyncStatus.ERROR);
    assert.match(outcome.error ?? '', /permission/i);
  });

  it('skips requesting when the owner cannot auto-request that media type', async () => {
    // Holds MANAGE_IMPORT_LISTS, so the list syncs, but no AUTO_REQUEST.
    const owner = await makeOwner(Permission.MANAGE_IMPORT_LISTS);
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(outcome.skipped, 1);
  });

  it('does not re-request an item settled by an earlier run', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    await getRepository(ImportListItem).save(
      new ImportListItem({
        importList: list,
        mediaType: MediaType.MOVIE,
        tmdbId: 329865,
        title: 'Arrival',
        status: ImportListItemStatus.REQUESTED,
      })
    );

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    const getRelatedMedia = mock.method(
      Media,
      'getRelatedMedia',
      async () => []
    );
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 0);
    assert.equal(getRelatedMedia.mock.callCount(), 0);
    assert.equal(outcome.skipped, 1);
  });

  it('treats a title already on the watchlist as settled, not failed', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner, { mode: ImportListMode.WATCHLIST });

    stubProvider([{ title: 'Arrival' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    mock.method(Watchlist, 'createWatchlist', async () => {
      throw new DuplicateWatchlistRequestError();
    });

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(outcome.errored, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.status, ImportListSyncStatus.SUCCESS);

    const items = await getRepository(ImportListItem).find();
    assert.equal(items[0].status, ImportListItemStatus.ALREADY_REQUESTED);
  });

  it('skips a settled entry without resolving it again', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    await getRepository(ImportListItem).save(
      new ImportListItem({
        importList: list,
        mediaType: MediaType.MOVIE,
        tmdbId: 329865,
        title: 'Arrival',
        status: ImportListItemStatus.REQUESTED,
      })
    );

    // The entry already carries its id, so resolution is avoidable entirely.
    stubProvider([
      { tmdbId: 329865, mediaType: MediaType.MOVIE, title: 'Arrival' },
    ]);
    const resolve = mock.method(
      resolver,
      'resolveImportListEntry',
      async () => A_MOVIE
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(resolve.mock.callCount(), 0);
    assert.equal(outcome.skipped, 1);
  });

  it('keeps one row per unmatchable title across repeated syncs', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Something Obscure', year: 1974 }]);
    stubResolver(undefined);

    await importListSync.syncSingleList(list.id);
    await importListSync.syncSingleList(list.id);
    await importListSync.syncSingleList(list.id);

    // An unresolved row has no id for the unique constraints to key on, so
    // without title matching this would be three rows.
    const items = await getRepository(ImportListItem).find();
    assert.equal(items.length, 1);
    assert.equal(items[0].status, ImportListItemStatus.NOT_FOUND);
  });

  it('deduplicates a title that appears twice in one list', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }, { title: 'Arrival (2016)' }]);
    stubResolver(A_MOVIE);
    mock.method(Media, 'getRelatedMedia', async () => []);
    const request = mock.method(
      MediaRequest,
      'request',
      async () => ({}) as never
    );

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(request.mock.callCount(), 1);
    assert.equal(outcome.requested, 1);
  });

  it('reports partial when some items succeed and others do not', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);

    stubProvider([{ title: 'Arrival' }, { title: 'Nonexistent' }]);
    let call = 0;
    mock.method(resolver, 'resolveImportListEntry', async () => {
      call += 1;
      return call === 1 ? A_MOVIE : undefined;
    });
    mock.method(Media, 'getRelatedMedia', async () => []);
    mock.method(MediaRequest, 'request', async () => ({}) as never);

    const outcome = await importListSync.syncSingleList(list.id);

    assert.equal(outcome.requested, 1);
    assert.equal(outcome.errored, 1);
    assert.equal(outcome.status, ImportListSyncStatus.PARTIAL);
  });

  it('honours the per-list item cap from settings', async () => {
    const owner = await makeOwner();
    const list = await makeList(owner);
    getSettings().importLists.maxItemsPerList = 7;

    let seenMaxItems: number | undefined;
    mock.method(providerRegistry, 'getImportListProvider', () => ({
      id: ImportListProviderId.STEVENLU,
      label: 'Steven Lu',
      mediaKinds: [MediaType.MOVIE],
      example: 'stevenlu',
      isConfigured: () => true,
      parse: () => {
        throw new Error('not used');
      },
      fetch: async (_list: unknown, options: { maxItems: number }) => {
        seenMaxItems = options.maxItems;
        return { entries: [], truncated: false };
      },
    }));

    await importListSync.syncSingleList(list.id);

    assert.equal(seenMaxItems, 7);
  });

  it('does nothing at all when import lists are disabled globally', async () => {
    const owner = await makeOwner();
    await makeList(owner);
    getSettings().importLists.enabled = false;

    const getImportListProvider = mock.method(
      providerRegistry,
      'getImportListProvider',
      () => {
        throw new Error('should not be called');
      }
    );

    await importListSync.syncImportLists();

    assert.equal(getImportListProvider.mock.callCount(), 0);
  });

  it('leaves disabled lists alone during a scheduled run', async () => {
    const owner = await makeOwner();
    await makeList(owner, { enabled: false });

    const getImportListProvider = mock.method(
      providerRegistry,
      'getImportListProvider',
      () => {
        throw new Error('should not be called');
      }
    );

    await importListSync.syncImportLists();

    assert.equal(getImportListProvider.mock.callCount(), 0);
  });
});
