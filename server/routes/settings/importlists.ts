import TraktAPI from '@server/api/trakt';
import { getAllImportListProviders } from '@server/lib/importlists/providers';
import { Permission } from '@server/lib/permissions';
import type { ImportListSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { Router } from 'express';

const importListSettingsRoutes = Router();

/**
 * Bounds chosen so a mistyped value cannot turn one list into a denial of
 * service against TMDB or the list source.
 */
const MAX_ITEMS_CEILING = 5_000;
const MAX_CONCURRENCY = 10;
const MAX_CREDENTIAL_LENGTH = 256;

const isOptionalCredential = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_CREDENTIAL_LENGTH;

const parseImportListSettings = (
  value: unknown
): { value: ImportListSettings } | { error: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Invalid import list settings.' };
  }

  const body = value as Partial<ImportListSettings>;

  if (typeof body.enabled !== 'boolean') {
    return { error: 'The enabled flag must be a boolean.' };
  }

  if (
    !Number.isSafeInteger(body.maxItemsPerList) ||
    (body.maxItemsPerList as number) < 1 ||
    (body.maxItemsPerList as number) > MAX_ITEMS_CEILING
  ) {
    return {
      error: `Maximum items per list must be between 1 and ${MAX_ITEMS_CEILING}.`,
    };
  }

  if (
    !Number.isSafeInteger(body.syncConcurrency) ||
    (body.syncConcurrency as number) < 1 ||
    (body.syncConcurrency as number) > MAX_CONCURRENCY
  ) {
    return {
      error: `Sync concurrency must be between 1 and ${MAX_CONCURRENCY}.`,
    };
  }

  if (body.defaultMode !== 'request' && body.defaultMode !== 'watchlist') {
    return { error: 'The default mode must be "request" or "watchlist".' };
  }

  if (
    !isOptionalCredential(body.traktClientId) ||
    !isOptionalCredential(body.tvdbApiKey) ||
    !isOptionalCredential(body.mdblistApiKey)
  ) {
    return { error: 'API credentials must be strings.' };
  }

  return {
    value: {
      enabled: body.enabled,
      maxItemsPerList: body.maxItemsPerList as number,
      syncConcurrency: body.syncConcurrency as number,
      defaultMode: body.defaultMode,
      traktClientId: body.traktClientId.trim(),
      tvdbApiKey: body.tvdbApiKey.trim(),
      mdblistApiKey: body.mdblistApiKey.trim(),
    },
  };
};

importListSettingsRoutes.get('/', (_req, res) => {
  const settings = getSettings().importLists;

  res.status(200).json({
    ...settings,
    providers: getAllImportListProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
    })),
  });
});

importListSettingsRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsedBody = parseImportListSettings(req.body);

    if ('error' in parsedBody) {
      return res.status(400).json({ success: false, error: parsedBody.error });
    }

    const settings = getSettings();
    const saved = await settings.persistSection('importLists', () => ({
      ...parsedBody.value,
    }));

    return res.status(200).json(saved);
  })
);

/**
 * Verifies a Trakt client ID before it is saved, so a typo is caught here
 * rather than as eleven failed list syncs twelve hours later.
 */
importListSettingsRoutes.post(
  '/test/trakt',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const body = req.body as { traktClientId?: unknown } | undefined;
    const clientId =
      typeof body?.traktClientId === 'string'
        ? body.traktClientId.trim()
        : getSettings().importLists.traktClientId;

    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, error: 'A Trakt client ID is required.' });
    }

    try {
      await new TraktAPI(clientId).test();
      return res.status(200).json({ success: true });
    } catch (e) {
      logger.warn('Trakt credential test failed', {
        label: 'Import Lists',
        errorMessage: e instanceof Error ? e.message : 'unknown error',
      });
      return res.status(400).json({
        success: false,
        error: 'Trakt rejected that client ID.',
      });
    }
  })
);

export default importListSettingsRoutes;
