import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { loadThemeDirectory } from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

const scale = Array.from(
  { length: 11 },
  (_, index) => `#${index.toString(16).repeat(6)}`
);

const manifest = (assets?: Record<string, string>) => ({
  schemaVersion: 1,
  id: 'example-theme',
  name: 'Example Theme',
  version: '1.0.0',
  swatches: ['#112233', '#445566'],
  colors: { surface: scale, primary: scale, secondary: scale },
  ...(assets ? { assets } : {}),
});

const createPackage = async (assets?: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-theme-load-'));
  temporaryDirectories.push(root);
  const directory = path.join(root, 'example-theme');
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'theme.json'),
    JSON.stringify(manifest(assets))
  );
  return { root, directory };
};

describe('theme package loading', () => {
  it('exposes asset URLs and media types for each declared asset', async () => {
    const { directory } = await createPackage({
      logoDark: 'assets/logo-dark.svg',
      backgroundLight: 'assets/background.webp',
    });
    await fs.writeFile(path.join(directory, 'assets/logo-dark.svg'), '<svg/>');
    await fs.writeFile(path.join(directory, 'assets/background.webp'), 'x');

    const loaded = await loadThemeDirectory(directory);
    assert.equal(
      loaded.publicTheme.assetUrls.logoDark,
      '/api/v1/themes/example-theme/assets/logoDark?v=1.0.0'
    );
    assert.equal(loaded.publicTheme.assetTypes.logoDark, 'image/svg+xml');
    assert.equal(loaded.publicTheme.assetTypes.backgroundLight, 'image/webp');
  });

  it('rejects an asset reached through a symlinked directory', async () => {
    // A package extracted by hand with `tar` keeps symlinks the installer would
    // have refused, and a plain string prefix check cannot see through them.
    const { root, directory } = await createPackage({
      logoDark: 'linked/secret.svg',
    });
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.svg'), 'private');
    await fs.symlink(outside, path.join(directory, 'linked'));

    await assert.rejects(
      loadThemeDirectory(directory),
      /escapes the theme directory/i
    );
  });

  it('rejects an asset that is itself a symlink', async () => {
    const { root, directory } = await createPackage({
      logoDark: 'assets/logo-dark.svg',
    });
    await fs.writeFile(path.join(root, 'secret.svg'), 'private');
    await fs.symlink(
      path.join(root, 'secret.svg'),
      path.join(directory, 'assets/logo-dark.svg')
    );

    await assert.rejects(
      loadThemeDirectory(directory),
      /escapes the theme directory|not a valid theme image/i
    );
  });
});
