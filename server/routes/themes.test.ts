import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { THEMES_DIRECTORY, themeManager } from '@server/lib/themes';
import express from 'express';
import request from 'supertest';
import themesRoutes from './themes';

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
});
