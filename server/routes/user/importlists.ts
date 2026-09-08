import {
  ImportListBookFormat,
  ImportListMode,
  ImportListSyncStatus,
  isBookImportListProvider,
  isImportListBookFormat,
  isImportListMode,
  isImportListProviderId,
} from '@server/constants/importList';
import { getRepository } from '@server/datasource';
import { ImportList } from '@server/entity/ImportList';
import { ImportListItem } from '@server/entity/ImportListItem';
import { User } from '@server/entity/User';
import type {
  CreateImportListBody,
  ImportListItemResponse,
  ImportListProviderInfo,
  ImportListResponse,
  ImportListSummaryResponse,
  ImportListSyncResultResponse,
  ImportListsResponse,
  UpdateImportListBody,
} from '@server/interfaces/api/importListInterfaces';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  getAllImportListProviders,
  getImportListProvider,
} from '@server/lib/importlists/providers';
import {
  ImportListIdentifierError,
  ImportListNotConfiguredError,
  ImportListUnavailableError,
} from '@server/lib/importlists/types';
import importListSync from '@server/lib/importlistsync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';

const importListRoutes = Router({ mergeParams: true });

const MAX_ID_VALUE = 1_000_000_000;
const MAX_NAME_LENGTH = 255;
const MAX_IDENTIFIER_LENGTH = 512;
/** Enough to see what a list has been doing without paging the UI. */
const MAX_ITEMS_RETURNED = 200;

const parseRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, MAX_ID_VALUE);

const bookshelfIsConfigured = (): boolean =>
  getExternalRuntimeConfig().readarr.some((service) => service.isDefault);

/**
 * Import lists are edited by their owner, or by an admin acting on the owner's
 * behalf. `isOwnProfileOrAdmin` already settles *whose* profile this is; this
 * adds the feature permission, which the owner must hold in their own right —
 * an admin editing someone else's lists does not lend them the permission.
 */
const requireImportListAccess = (): Middleware => (req, res, next) => {
  if (!req.user?.hasPermission(Permission.MANAGE_IMPORT_LISTS)) {
    return next({
      status: 403,
      message: 'You do not have permission to manage import lists.',
    });
  }
  next();
};

const toResponse = (list: ImportList): ImportListResponse => ({
  id: list.id,
  provider: list.provider,
  providerLabel: getImportListProvider(list.provider).label,
  listId: list.listId,
  name: list.name,
  enabled: list.enabled,
  mode: list.mode,
  is4k: list.is4k,
  bookFormat: list.bookFormat ?? null,
  lastSyncedAt: list.lastSyncedAt?.toISOString() ?? null,
  lastSyncStatus: list.lastSyncStatus,
  lastSyncError: list.lastSyncError ?? null,
  itemCount: list.itemCount,
  lastRequestedCount: list.lastRequestedCount,
  lastSkippedCount: list.lastSkippedCount,
  lastErrorCount: list.lastErrorCount,
  createdAt: list.createdAt.toISOString(),
});

const providerInfo = (): ImportListProviderInfo[] =>
  getAllImportListProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    mediaKinds: [...provider.mediaKinds],
    example: provider.example,
    configured: provider.isConfigured(),
    requiresBookshelf: isBookImportListProvider(provider.id),
  }));

/** Maps the provider layer's typed errors onto HTTP status codes. */
const statusForError = (e: unknown): { status: number; message: string } => {
  if (e instanceof ImportListIdentifierError) {
    return { status: 400, message: e.message };
  }
  if (e instanceof ImportListNotConfiguredError) {
    return { status: 400, message: e.message };
  }
  if (e instanceof ImportListUnavailableError) {
    // The identifier is fine; the source is not answering right now.
    return { status: 502, message: e.message };
  }
  return {
    status: 500,
    message: e instanceof Error ? e.message : 'Unknown error.',
  };
};

importListRoutes.use(isOwnProfileOrAdmin(), requireImportListAccess());

importListRoutes.get<{ id: string }, ImportListsResponse>(
  '/',
  async (req, res, next) => {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    try {
      const lists = await getRepository(ImportList).find({
        where: { user: { id: userId } },
        order: { id: 'ASC' },
      });

      return res.status(200).json({
        results: lists.map(toResponse),
        providers: providerInfo(),
        bookshelfConfigured: bookshelfIsConfigured(),
      });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

importListRoutes.get<{ id: string }, ImportListSummaryResponse>(
  '/summary',
  async (req, res, next) => {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    try {
      const lists = await getRepository(ImportList).find({
        where: { user: { id: userId } },
        order: { id: 'ASC' },
      });

      const syncedAt = lists
        .map((list) => list.lastSyncedAt?.getTime())
        .filter((time): time is number => typeof time === 'number');

      return res.status(200).json({
        total: lists.length,
        enabled: lists.filter((list) => list.enabled).length,
        errored: lists.filter(
          (list) => list.lastSyncStatus === ImportListSyncStatus.ERROR
        ).length,
        lastSyncedAt: syncedAt.length
          ? new Date(Math.max(...syncedAt)).toISOString()
          : null,
        lastRequestedCount: lists.reduce(
          (total, list) => total + list.lastRequestedCount,
          0
        ),
        itemCount: lists.reduce((total, list) => total + list.itemCount, 0),
        lists: lists.map((list) => ({
          id: list.id,
          name: list.name,
          provider: list.provider,
          providerLabel: getImportListProvider(list.provider).label,
          enabled: list.enabled,
          lastSyncStatus: list.lastSyncStatus,
          lastSyncedAt: list.lastSyncedAt?.toISOString() ?? null,
          lastSyncError: list.lastSyncError ?? null,
          itemCount: list.itemCount,
          lastRequestedCount: list.lastRequestedCount,
        })),
      });
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

importListRoutes.post<{ id: string }, ImportListResponse, CreateImportListBody>(
  '/',
  async (req, res, next) => {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return next({ status: 400, message: 'A request body is required.' });
    }

    if (!isImportListProviderId(body.provider)) {
      return next({ status: 400, message: 'Unknown list provider.' });
    }

    if (
      typeof body.listId !== 'string' ||
      !body.listId.trim() ||
      body.listId.length > MAX_IDENTIFIER_LENGTH
    ) {
      return next({ status: 400, message: 'A list identifier is required.' });
    }

    if (body.mode !== undefined && !isImportListMode(body.mode)) {
      return next({ status: 400, message: 'Unknown import list mode.' });
    }

    if (
      body.bookFormat !== undefined &&
      !isImportListBookFormat(body.bookFormat)
    ) {
      return next({ status: 400, message: 'Unknown book format.' });
    }

    const isBookProvider = isBookImportListProvider(body.provider);

    if (isBookProvider && !bookshelfIsConfigured()) {
      return next({
        status: 400,
        message:
          'Book lists need a default Bookshelf service under Settings → Services.',
      });
    }

    try {
      const provider = getImportListProvider(body.provider);
      const parsed = provider.parse(body.listId);

      const userRepository = getRepository(User);
      const owner = await userRepository.findOne({ where: { id: userId } });
      if (!owner) {
        return next({ status: 404, message: 'User not found.' });
      }

      const listRepository = getRepository(ImportList);

      const existing = await listRepository.findOne({
        where: {
          user: { id: userId },
          provider: parsed.provider,
          listId: parsed.listId,
        },
      });

      if (existing) {
        return next({
          status: 409,
          message: 'That list is already configured for this user.',
        });
      }

      const settings = getSettings().importLists;

      const list = new ImportList({
        user: owner,
        provider: parsed.provider,
        listId: parsed.listId,
        name: (body.name?.trim() || parsed.name).slice(0, MAX_NAME_LENGTH),
        enabled: body.enabled ?? true,
        mode:
          body.mode ??
          (settings.defaultMode === 'watchlist'
            ? ImportListMode.WATCHLIST
            : ImportListMode.REQUEST),
        is4k: body.is4k ?? false,
        bookFormat: isBookProvider
          ? (body.bookFormat ?? ImportListBookFormat.EBOOK)
          : null,
        lastSyncStatus: ImportListSyncStatus.NEVER,
        itemCount: 0,
        lastRequestedCount: 0,
        lastSkippedCount: 0,
        lastErrorCount: 0,
      });

      const saved = await listRepository.save(list);

      logger.info('Import list created', {
        label: 'Import Lists',
        userId,
        provider: saved.provider,
        listId: saved.listId,
      });

      return res.status(201).json(toResponse(saved));
    } catch (e) {
      const { status, message } = statusForError(e);
      return next({ status, message });
    }
  }
);

importListRoutes.put<
  { id: string; listId: string },
  ImportListResponse,
  UpdateImportListBody
>('/:listId', async (req, res, next) => {
  const userId = parseRouteId(req.params.id);
  const listId = parseRouteId(req.params.listId);

  if (!userId || !listId) {
    return next({ status: 404, message: 'Import list not found.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return next({ status: 400, message: 'A request body is required.' });
  }

  if (body.mode !== undefined && !isImportListMode(body.mode)) {
    return next({ status: 400, message: 'Unknown import list mode.' });
  }

  if (
    body.bookFormat !== undefined &&
    !isImportListBookFormat(body.bookFormat)
  ) {
    return next({ status: 400, message: 'Unknown book format.' });
  }

  try {
    const listRepository = getRepository(ImportList);
    const list = await listRepository.findOne({
      where: { id: listId, user: { id: userId } },
    });

    if (!list) {
      return next({ status: 404, message: 'Import list not found.' });
    }

    if (typeof body.name === 'string' && body.name.trim()) {
      list.name = body.name.trim().slice(0, MAX_NAME_LENGTH);
    }
    if (body.mode !== undefined) {
      list.mode = body.mode;
    }
    if (typeof body.is4k === 'boolean') {
      list.is4k = body.is4k;
    }
    if (typeof body.enabled === 'boolean') {
      list.enabled = body.enabled;
    }
    if (
      body.bookFormat !== undefined &&
      isBookImportListProvider(list.provider)
    ) {
      list.bookFormat = body.bookFormat;
    }

    return res.status(200).json(toResponse(await listRepository.save(list)));
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

importListRoutes.delete<{ id: string; listId: string }>(
  '/:listId',
  async (req, res, next) => {
    const userId = parseRouteId(req.params.id);
    const listId = parseRouteId(req.params.listId);

    if (!userId || !listId) {
      return next({ status: 404, message: 'Import list not found.' });
    }

    try {
      const listRepository = getRepository(ImportList);
      const list = await listRepository.findOne({
        where: { id: listId, user: { id: userId } },
      });

      if (!list) {
        return next({ status: 404, message: 'Import list not found.' });
      }

      await listRepository.remove(list);

      logger.info('Import list deleted', {
        label: 'Import Lists',
        userId,
        listId,
      });

      return res.status(204).send();
    } catch (e) {
      return next({ status: 500, message: e.message });
    }
  }
);

importListRoutes.get<
  { id: string; listId: string },
  { results: ImportListItemResponse[] }
>('/:listId/items', async (req, res, next) => {
  const userId = parseRouteId(req.params.id);
  const listId = parseRouteId(req.params.listId);

  if (!userId || !listId) {
    return next({ status: 404, message: 'Import list not found.' });
  }

  try {
    const list = await getRepository(ImportList).findOne({
      where: { id: listId, user: { id: userId } },
    });

    if (!list) {
      return next({ status: 404, message: 'Import list not found.' });
    }

    const items = await getRepository(ImportListItem).find({
      where: { importList: { id: listId } },
      order: { processedAt: 'DESC' },
      take: MAX_ITEMS_RETURNED,
    });

    return res.status(200).json({
      results: items.map((item) => ({
        id: item.id,
        mediaType: item.mediaType,
        tmdbId: item.tmdbId ?? null,
        externalId: item.externalId ?? null,
        title: item.title,
        year: item.year ?? null,
        status: item.status,
        message: item.message ?? null,
        processedAt: item.processedAt.toISOString(),
      })),
    });
  } catch (e) {
    return next({ status: 500, message: e.message });
  }
});

importListRoutes.post<
  { id: string; listId: string },
  ImportListSyncResultResponse
>('/:listId/sync', async (req, res, next) => {
  const userId = parseRouteId(req.params.id);
  const listId = parseRouteId(req.params.listId);

  if (!userId || !listId) {
    return next({ status: 404, message: 'Import list not found.' });
  }

  try {
    const list = await getRepository(ImportList).findOne({
      where: { id: listId, user: { id: userId } },
    });

    if (!list) {
      return next({ status: 404, message: 'Import list not found.' });
    }

    const outcome = await importListSync.syncSingleList(listId);

    return res.status(200).json(outcome);
  } catch (e) {
    const { status, message } = statusForError(e);
    return next({ status, message });
  }
});

export default importListRoutes;
