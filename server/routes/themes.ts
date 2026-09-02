import type { ThemeAssetName } from '@server/interfaces/api/themeInterfaces';
import { Permission } from '@server/lib/permissions';
import { themeManager } from '@server/lib/themes';
import {
  installThemeFromGithub,
  removeInstalledTheme,
  updateInstalledTheme,
} from '@server/lib/themes/installer';
import { isAuthenticated } from '@server/middleware/auth';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { Router } from 'express';
import path from 'node:path';

const themesRoutes = Router();
const assetNames = new Set<ThemeAssetName>([
  'logoDark',
  'logoLight',
  'iconDark',
  'iconLight',
  'faviconDark',
  'faviconLight',
  'backgroundDark',
  'backgroundLight',
]);

themesRoutes.get('/', async (_req, res, next) => {
  try {
    return res.status(200).json(await themeManager.ensureLoaded());
  } catch (error) {
    return next(error);
  }
});

themesRoutes.get('/:themeId/assets/:assetName', async (req, res, next) => {
  try {
    await themeManager.ensureLoaded();
    const assetName = req.params.assetName as ThemeAssetName;
    if (!assetNames.has(assetName)) {
      return res.status(404).json({ message: 'Theme asset not found.' });
    }
    const assetPath = themeManager.resolveAsset(req.params.themeId, assetName);
    if (!assetPath) {
      return res.status(404).json({ message: 'Theme asset not found.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    return res.sendFile(path.basename(assetPath), {
      root: path.dirname(assetPath),
    });
  } catch (error) {
    return next(error);
  }
});

themesRoutes.post(
  '/reload',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(Permission.ADMIN, async (_req, res, next) => {
    try {
      return res.status(200).json(await themeManager.reload());
    } catch (error) {
      return next(error);
    }
  })
);

themesRoutes.post(
  '/install',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation<Record<string, never>, unknown, { sourceUrl?: unknown }>(
    Permission.ADMIN,
    async (req, res, next) => {
      try {
        if (
          typeof req.body.sourceUrl !== 'string' ||
          req.body.sourceUrl.length > 512
        ) {
          return res
            .status(400)
            .json({ message: 'A valid sourceUrl is required.' });
        }
        return res
          .status(201)
          .json(await installThemeFromGithub(req.body.sourceUrl));
      } catch (error) {
        return next({
          status: 400,
          message:
            error instanceof Error ? error.message : 'Theme install failed.',
        });
      }
    }
  )
);

themesRoutes.post(
  '/:themeId/update',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    try {
      return res
        .status(200)
        .json(await updateInstalledTheme(req.params.themeId));
    } catch (error) {
      return next({
        status: 400,
        message:
          error instanceof Error ? error.message : 'Theme update failed.',
      });
    }
  })
);

themesRoutes.delete(
  '/:themeId',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    try {
      return res
        .status(200)
        .json(await removeInstalledTheme(req.params.themeId));
    } catch (error) {
      return next({
        status: 400,
        message:
          error instanceof Error ? error.message : 'Theme removal failed.',
      });
    }
  })
);

export default themesRoutes;
