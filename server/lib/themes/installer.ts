import type { ThemeInstallResponse } from '@server/interfaces/api/themeInterfaces';
import AsyncLock from '@server/utils/asyncLock';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadThemeDirectory, themeManager } from './index';
import { THEMES_DIRECTORY } from './paths';
import { readRegistry, writeRegistry } from './registry';

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_REDIRECTS = 5;
const ALLOWED_ASSET_HOSTS = [
  'github.com',
  'api.github.com',
  'githubusercontent.com',
];
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_ENTRIES = 512;
const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const themeMutationLock = new AsyncLock();

type GithubRelease = {
  assets: {
    name: string;
    url?: string;
    browser_download_url: string;
    size: number;
  }[];
};

const githubHeaders = (accept = 'application/vnd.github+json') => ({
  Accept: accept,
  'User-Agent': 'SeerrNG-theme-installer',
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
});

export const parseGithubRepositoryUrl = (
  sourceUrl: string
): { owner: string; repository: string; normalizedUrl: string } => {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('Theme source must be a valid GitHub repository URL.');
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    parts.length !== 2 ||
    !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
  ) {
    throw new Error('Only HTTPS GitHub repository URLs are supported.');
  }
  const repository = parts[1].replace(/\.git$/i, '');
  return {
    owner: parts[0],
    repository,
    normalizedUrl: `https://github.com/${parts[0]}/${repository}`,
  };
};

const fetchLatestRelease = async (
  owner: string,
  repository: string
): Promise<GithubRelease> => {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repository
    )}/releases/latest`,
    { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}).`);
  }
  return (await response.json()) as GithubRelease;
};

// A Content-Length header is advisory: it can be absent on a chunked response
// and it can lie. Cap the transfer as it arrives so a hostile or broken host
// cannot make the process buffer an unbounded body before the size is checked.
const readCappedBody = async (
  response: Response,
  limit: number
): Promise<Buffer> => {
  if (!response.body) {
    throw new Error('Theme download returned an empty response.');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        throw new Error('Theme package exceeds the download limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
};

const assertAllowedAssetHost = (url: URL) => {
  if (
    url.protocol !== 'https:' ||
    !ALLOWED_ASSET_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
  ) {
    throw new Error('GitHub returned an unexpected release asset URL.');
  }
};

// Release downloads redirect to a signed CDN URL. Following them with fetch's
// own handling would leave every host after the first unchecked, so walk the
// chain and re-check each hop. The credential is deliberately dropped after the
// first request: the signed URL does not need it, and a redirect is the one
// place it could otherwise reach a host that is not GitHub's API.
const fetchReleaseAsset = async (
  url: URL,
  accept: string
): Promise<Response> => {
  let current = url;
  for (let hop = 0; hop <= MAX_ASSET_REDIRECTS; hop += 1) {
    assertAllowedAssetHost(current);
    const response: Response = await fetch(current, {
      headers:
        hop === 0
          ? githubHeaders(accept)
          : { Accept: accept, 'User-Agent': 'SeerrNG-theme-installer' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new Error('Theme download returned an incomplete redirect.');
    }
    current = new URL(location, current);
  }
  throw new Error('Theme download followed too many redirects.');
};

const downloadReleaseAsset = async (
  release: GithubRelease
): Promise<Buffer> => {
  const asset = release.assets.find(
    (candidate) =>
      /\.tar\.gz$/i.test(candidate.name) &&
      candidate.size > 0 &&
      candidate.size <= MAX_DOWNLOAD_BYTES
  );
  if (!asset) {
    throw new Error('Latest release has no supported .tar.gz theme package.');
  }
  const useApiDownload = Boolean(process.env.GITHUB_TOKEN && asset.url);
  const assetUrl = new URL(
    useApiDownload ? (asset.url as string) : asset.browser_download_url
  );
  const response = await fetchReleaseAsset(
    assetUrl,
    useApiDownload ? 'application/octet-stream' : 'application/vnd.github+json'
  );
  if (!response.ok) {
    throw new Error(`Theme download failed (${response.status}).`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) {
    throw new Error('Theme package exceeds the download limit.');
  }
  return readCappedBody(response, MAX_DOWNLOAD_BYTES);
};

const readTarString = (buffer: Buffer, start: number, length: number) =>
  buffer
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/, '')
    .trim();

const readTarOctal = (header: Buffer, start: number, length: number) => {
  const value = readTarString(header, start, length);
  if (!/^[0-7]+$/.test(value)) {
    throw new Error('Theme package contains invalid tar metadata.');
  }
  return Number.parseInt(value, 8);
};

const assertTarChecksum = (header: Buffer) => {
  const expected = readTarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) {
    throw new Error('Theme package failed its tar checksum validation.');
  }
};

export const extractThemeArchive = async (
  archive: Buffer,
  destination: string
) => {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED_BYTES });
  } catch {
    throw new Error('Theme package is not a valid gzip archive.');
  }
  const destinationRoot = path.resolve(destination);
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  let offset = 0;
  let entryCount = 0;
  let fileCount = 0;
  let extractedBytes = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    assertTarChecksum(header);
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const size = readTarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Theme package contains an invalid file size.');
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error('Theme package is truncated.');
    }
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;

    // Pax global ('g') and extended ('x') headers carry archive metadata, not
    // package content. `git archive` always emits one, and bsdtar - the default
    // `tar` on macOS - emits them for extended attributes, so rejecting them
    // turned two ordinary ways of building a package into an opaque failure.
    // Their contents stay deliberately unread: a pax `path` record therefore
    // cannot redirect the following entry away from the ustar name validated
    // below, which keeps this stricter than a conforming tar rather than looser.
    if (type === 'g' || type === 'x') {
      offset = nextOffset;
      continue;
    }

    entryCount += 1;
    if (entryCount > MAX_ENTRIES) {
      throw new Error('Theme package exceeds extraction limits.');
    }
    const normalized = path.posix.normalize(relativePath.replace(/^\.\//, ''));
    if (
      !normalized ||
      normalized === '.' ||
      normalized.startsWith('../') ||
      path.posix.isAbsolute(normalized)
    ) {
      throw new Error('Theme package contains an unsafe path.');
    }
    const outputPath = path.resolve(destinationRoot, ...normalized.split('/'));
    if (!outputPath.startsWith(`${destinationRoot}${path.sep}`)) {
      throw new Error('Theme package contains an unsafe path.');
    }
    if (type === '5') {
      await fs.mkdir(outputPath, { recursive: true, mode: 0o700 });
    } else if (type === '0' || type === '\0') {
      fileCount += 1;
      extractedBytes += size;
      if (fileCount > MAX_FILES || extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error('Theme package exceeds extraction limits.');
      }
      await fs.mkdir(path.dirname(outputPath), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(outputPath, tar.subarray(dataStart, dataEnd), {
        mode: 0o600,
        flag: 'wx',
      });
    } else {
      throw new Error('Theme package contains unsupported links or metadata.');
    }
    offset = nextOffset;
  }
  if (fileCount === 0) {
    throw new Error('Theme package is empty.');
  }
};

const installBuffer = async (
  archive: Buffer,
  sourceUrl: string
): Promise<ThemeInstallResponse> => {
  await fs.mkdir(THEMES_DIRECTORY, { recursive: true });
  const staging = path.join(THEMES_DIRECTORY, `.install-${randomUUID()}`);
  const packageDirectory = path.join(staging, 'package');
  try {
    await extractThemeArchive(archive, packageDirectory);
    let loaded;
    try {
      loaded = await loadThemeDirectory(packageDirectory, false);
    } catch (rootError) {
      const entries = await fs.readdir(packageDirectory, {
        withFileTypes: true,
      });
      const directories = entries.filter((entry) => entry.isDirectory());
      if (directories.length !== 1) {
        throw rootError;
      }
      loaded = await loadThemeDirectory(
        path.join(packageDirectory, directories[0].name)
      );
    }
    // Read the registry before anything on disk moves. Doing it afterwards let
    // a registry problem fail the request while the package was already live.
    const registry = await readRegistry();
    const destination = path.join(THEMES_DIRECTORY, loaded.manifest.id);
    const backup = `${destination}.previous-${randomUUID()}`;
    let hasBackup = false;
    try {
      await fs.rename(destination, backup);
      hasBackup = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await fs.rename(loaded.directory, destination);
      if (hasBackup) {
        await fs.rm(backup, { recursive: true, force: true });
      }
    } catch (error) {
      if (hasBackup) {
        await fs.rename(backup, destination);
      }
      throw error;
    }
    registry[loaded.manifest.id] = {
      sourceUrl,
      installedVersion: loaded.manifest.version,
      installedAt: new Date().toISOString(),
    };
    await writeRegistry(registry);
    const themes = await themeManager.reload();
    const theme = themes.themes.find(
      (candidate) => candidate.id === loaded.manifest.id
    );
    if (!theme) {
      throw new Error('Installed theme failed the final validation scan.');
    }
    return { theme, sourceUrl };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
};

const installThemeFromGithubUnlocked = async (
  sourceUrl: string
): Promise<ThemeInstallResponse> => {
  const repository = parseGithubRepositoryUrl(sourceUrl);
  const release = await fetchLatestRelease(
    repository.owner,
    repository.repository
  );
  return installBuffer(
    await downloadReleaseAsset(release),
    repository.normalizedUrl
  );
};

const removeThemeUnlocked = async (themeId: string) => {
  if (!THEME_ID_PATTERN.test(themeId)) {
    throw new Error('Invalid theme ID.');
  }
  await fs.rm(path.join(THEMES_DIRECTORY, themeId), {
    recursive: true,
    force: true,
  });
  const registry = await readRegistry();
  delete registry[themeId];
  await writeRegistry(registry);
};

export const installThemeFromGithub = async (
  sourceUrl: string
): Promise<ThemeInstallResponse> =>
  themeMutationLock.dispatch('themes', () =>
    installThemeFromGithubUnlocked(sourceUrl)
  );

export const updateInstalledTheme = async (
  themeId: string
): Promise<ThemeInstallResponse> =>
  themeMutationLock.dispatch('themes', async () => {
    const registry = await readRegistry();
    const entry = registry[themeId];
    if (!entry) {
      throw new Error('Theme was installed locally and has no update source.');
    }
    const result = await installThemeFromGithubUnlocked(entry.sourceUrl);
    // A package may rename itself between releases. Without this the previous
    // directory and registry entry survive as an orphan the admin never asked
    // to keep, alongside the theme that replaced it.
    if (result.theme.id !== themeId) {
      await removeThemeUnlocked(themeId);
      await themeManager.reload();
    }
    return result;
  });

export const removeInstalledTheme = async (themeId: string) =>
  themeMutationLock.dispatch('themes', async () => {
    await removeThemeUnlocked(themeId);
    return themeManager.reload();
  });
