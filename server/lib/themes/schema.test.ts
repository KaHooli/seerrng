import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseThemeManifest } from './schema';

const scale = Array.from(
  { length: 11 },
  (_, index) => `#${index.toString(16).repeat(6)}`
);

const validManifest = {
  schemaVersion: 1 as const,
  id: 'example-theme',
  name: 'Example Theme',
  version: '1.0.0',
  swatches: ['#112233', '#445566'],
  colors: {
    surface: scale,
    primary: scale,
    secondary: scale,
  },
  assets: { logoDark: 'assets/logo-dark.svg' },
};

describe('theme manifest schema', () => {
  it('accepts a complete, valid manifest', () => {
    assert.deepEqual(parseThemeManifest(validManifest), validManifest);
  });

  it('rejects paths that escape the package', () => {
    assert.throws(
      () =>
        parseThemeManifest({
          ...validManifest,
          assets: { logoDark: '../logo.svg' },
        }),
      /safe relative path/i
    );
  });

  it('requires exactly eleven shades per colour scale', () => {
    assert.throws(
      () =>
        parseThemeManifest({
          ...validManifest,
          colors: { ...validManifest.colors, primary: scale.slice(1) },
        }),
      /too small|11/i
    );
  });

  it('rejects an ID that collides with a built-in palette', () => {
    assert.throws(
      () => parseThemeManifest({ ...validManifest, id: 'aurora' }),
      /built-in theme ID/i
    );
  });

  it('accepts the stacked sign-in logo slots', () => {
    const manifest = parseThemeManifest({
      ...validManifest,
      assets: {
        logoDark: 'assets/logo-dark.svg',
        logoStackedDark: 'assets/logo-stacked-dark.svg',
        logoStackedLight: 'assets/logo-stacked-light.png',
      },
    });
    assert.equal(
      manifest.assets?.logoStackedDark,
      'assets/logo-stacked-dark.svg'
    );
  });

  it('rejects unrecognized manifest properties', () => {
    assert.throws(() =>
      parseThemeManifest({ ...validManifest, executable: 'install.sh' })
    );
  });
});
