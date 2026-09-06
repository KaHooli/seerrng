import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { THEMES_DIRECTORY, themeManager } from '@server/lib/themes';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import themesRoutes from './themes';

const API_SPEC_PATH = path.join(__dirname, '../../seerr-api.yml');

const themeDirectory = path.join(THEMES_DIRECTORY, 'route-test-theme');
const scale = Array.from(
  { length: 11 },
  (_, index) => `#${index.toString(16).repeat(6)}`
);

const createApp = () => {
  const app = express();
  // Mirrors the app-wide policy the asset route has to override.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "script-src 'self' 'unsafe-inline'"
    );
    next();
  });
  app.use('/themes', themesRoutes);
  return app;
};

// server/index.ts validates every API request against seerr-api.yml before the
// router sees it, and rejects an undeclared query parameter with a 400. Mounting
// the router on its own hides that layer, so the asset URLs the server generates
// have to be exercised through it.
const createValidatedApp = () => {
  const app = express();
  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: API_SPEC_PATH,
      validateRequests: true,
    })
  );
  app.use('/api/v1/themes', themesRoutes);
  app.use(
    (
      error: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // Express identifies an error handler by its arity, so the unused fourth
      // parameter is load-bearing.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => res.status(error.status ?? 500).json({ message: error.message })
  );
  return app;
};

describe('theme asset route', () => {
  before(async () => {
    await fs.mkdir(path.join(themeDirectory, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(themeDirectory, 'theme.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'route-test-theme',
        name: 'Route Test Theme',
        version: '1.0.0',
        swatches: ['#112233', '#445566'],
        colors: { surface: scale, primary: scale, secondary: scale },
        assets: { logoDark: 'assets/logo-dark.svg' },
      })
    );
    await fs.writeFile(
      path.join(themeDirectory, 'assets/logo-dark.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
    );
    await themeManager.reload();
  });

  after(async () => {
    await fs.rm(themeDirectory, { recursive: true, force: true });
    await themeManager.reload();
  });

  it('serves an asset under a policy that cannot execute its script', async () => {
    const response = await request(createApp())
      .get('/themes/route-test-theme/assets/logoDark')
      .expect(200);

    assert.match(response.headers['content-type'], /image\/svg\+xml/);
    // A package is third-party content on the app's own origin: opened directly
    // the SVG is a document, so the app-wide 'unsafe-inline' policy must not
    // reach it.
    const policy = response.headers['content-security-policy'];
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /sandbox/);
    assert.doesNotMatch(policy, /script-src/);
  });

  it('rejects an unknown asset name', async () => {
    await request(createApp())
      .get('/themes/route-test-theme/assets/notAnAsset')
      .expect(404);
  });

  it('serves the asset URL the theme list advertises', async () => {
    // Driven from the generated URL rather than a hand-written one: the version
    // cache-buster is part of the contract between the list response and the
    // asset route, and a test that spells the path out by hand passes while
    // every real request 400s on the undeclared query parameter.
    const { themes } = await themeManager.ensureLoaded();
    const assetUrl = themes.find((theme) => theme.id === 'route-test-theme')
      ?.assetUrls.logoDark;

    assert.ok(assetUrl, 'the theme list must advertise a logoDark URL');
    assert.match(
      assetUrl,
      /\?v=/,
      'the URL must carry a cache-busting version'
    );

    const response = await request(createValidatedApp()).get(assetUrl);

    assert.equal(
      response.status,
      200,
      `expected 200 for ${assetUrl}, got ${response.status} ${JSON.stringify(
        response.body
      )}`
    );
    assert.match(response.headers['content-type'], /image\/svg\+xml/);
  });
});
