import type {
  InstalledTheme,
  ThemeAssetName,
  ThemeListResponse,
  ThemeManifest,
} from '@server/interfaces/api/themeInterfaces';
import { getAppVersion } from '@server/utils/appVersion';
import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { THEMES_DIRECTORY } from './paths';
import { readRegistry } from './registry';
import { parseThemeManifest } from './schema';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

const ASSET_MEDIA_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export { THEMES_DIRECTORY };

type LoadedTheme = {
  directory: string;
  manifest: ThemeManifest;
  publicTheme: InstalledTheme;
  // Absolute, fully symlink-resolved paths validated at load time. Serving from
  // these avoids re-deriving a path per request from manifest-supplied strings.
  assetPaths: Partial<Record<ThemeAssetName, string>>;
};

const assertPlainDirectory = async (directory: string) => {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Theme package must be a regular directory.');
  }
};

const assertCompatibleVersion = (manifest: ThemeManifest) => {
  if (!manifest.minimumSeerrVersion) {
    return;
  }
  const current = semver.coerce(getAppVersion());
  const minimum = semver.coerce(manifest.minimumSeerrVersion);
  if (current && minimum && semver.lt(current, minimum)) {
    throw new Error(`Requires Seerr ${manifest.minimumSeerrVersion} or newer.`);
  }
};

// A string prefix check only proves the *spelling* of the path stays inside the
// package. A symlinked directory component still resolves outside it, and a
// package extracted by hand with `tar` keeps the symlinks the installer would
// have rejected. Compare fully resolved paths so both sides survive a symlinked
// config mount while an escape is still caught.
const validateAsset = async (
  directory: string,
  filename: string
): Promise<string> => {
  const assetPath = path.resolve(directory, filename);
  if (!assetPath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error(`Asset ${filename} escapes the theme directory.`);
  }

  let resolvedRoot: string;
  let resolvedAsset: string;
  try {
    resolvedRoot = await fs.realpath(directory);
    resolvedAsset = await fs.realpath(assetPath);
  } catch {
    throw new Error(`Asset ${filename} is not a valid theme image.`);
  }
  if (!resolvedAsset.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Asset ${filename} escapes the theme directory.`);
  }

  const stat = await fs.lstat(resolvedAsset);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ASSET_BYTES) {
    throw new Error(`Asset ${filename} is not a valid theme image.`);
  }
  return resolvedAsset;
};

export const loadThemeDirectory = async (
  directory: string,
  requireMatchingDirectory = true
): Promise<LoadedTheme> => {
  await assertPlainDirectory(directory);
  const manifestPath = path.join(directory, 'theme.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    manifestStat.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error('theme.json is missing or too large.');
  }

  const manifest = parseThemeManifest(
    JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  );
  if (requireMatchingDirectory && path.basename(directory) !== manifest.id) {
    throw new Error(`Directory must be named ${manifest.id}.`);
  }
  assertCompatibleVersion(manifest);

  const assetUrls: InstalledTheme['assetUrls'] = {};
  const assetTypes: InstalledTheme['assetTypes'] = {};
  const assetPaths: LoadedTheme['assetPaths'] = {};
  for (const [assetName, filename] of Object.entries(manifest.assets ?? {})) {
    assetPaths[assetName as ThemeAssetName] = await validateAsset(
      directory,
      filename
    );
    assetUrls[assetName as ThemeAssetName] =
      `/api/v1/themes/${encodeURIComponent(
        manifest.id
      )}/assets/${encodeURIComponent(assetName)}?v=${encodeURIComponent(
        manifest.version
      )}`;
    const mediaType = ASSET_MEDIA_TYPES[path.extname(filename).toLowerCase()];
    if (mediaType) {
      assetTypes[assetName as ThemeAssetName] = mediaType;
    }
  }

  return {
    directory,
    manifest,
    publicTheme: { ...manifest, assetUrls, assetTypes },
    assetPaths,
  };
};

class ThemeManager {
  private themes = new Map<string, LoadedTheme>();
  private errors: ThemeListResponse['errors'] = [];
  private loaded = false;

  async reload(): Promise<ThemeListResponse> {
    await fs.mkdir(THEMES_DIRECTORY, { recursive: true });
    const nextThemes = new Map<string, LoadedTheme>();
    const errors: ThemeListResponse['errors'] = [];
    const entries = await fs.readdir(THEMES_DIRECTORY, { withFileTypes: true });
    const registry = await readRegistry();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      try {
        const loaded = await loadThemeDirectory(
          path.join(THEMES_DIRECTORY, entry.name)
        );
        if (nextThemes.has(loaded.manifest.id)) {
          throw new Error(`Duplicate theme ID ${loaded.manifest.id}.`);
        }
        const sourceUrl = registry[loaded.manifest.id]?.sourceUrl;
        nextThemes.set(loaded.manifest.id, {
          ...loaded,
          publicTheme: sourceUrl
            ? { ...loaded.publicTheme, sourceUrl }
            : loaded.publicTheme,
        });
      } catch (error) {
        errors.push({
          package: entry.name,
          message: error instanceof Error ? error.message : 'Invalid theme.',
        });
      }
    }

    this.themes = nextThemes;
    this.errors = errors;
    this.loaded = true;
    return this.list();
  }

  list(): ThemeListResponse {
    return {
      themes: [...this.themes.values()]
        .map((theme) => theme.publicTheme)
        .sort((left, right) => left.name.localeCompare(right.name)),
      errors: [...this.errors],
    };
  }

  async ensureLoaded(): Promise<ThemeListResponse> {
    if (!this.loaded) {
      return this.reload();
    }
    return this.list();
  }

  get(id: string): LoadedTheme | undefined {
    return this.themes.get(id);
  }

  resolveAsset(id: string, assetName: ThemeAssetName): string | undefined {
    return this.themes.get(id)?.assetPaths[assetName];
  }
}

export const themeManager = new ThemeManager();
