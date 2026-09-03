import type { ThemeAssetName } from '@server/interfaces/api/themeInterfaces';
import { THEME_ASSET_NAMES } from '@server/interfaces/api/themeInterfaces';
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
const assetNames = new Set<ThemeAssetName>(THEME_ASSET_NAMES);

// Theme packages are third-party content served from the application's own
// origin. An SVG is a document, not just an image: opened directly it would run
// its own inline script under the app-wide policy, which allows 'unsafe-inline'.
// This policy replaces that one for asset responses only. It does not affect the
// <img> tags that actually render these files - a response CSP applies to a
// document created from the response, never to a subresource load.
const ASSET_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'sandbox',
].join('; ');

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
    res.setHeader('Content-Security-Policy', ASSET_CONTENT_SECURITY_POLICY);
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
