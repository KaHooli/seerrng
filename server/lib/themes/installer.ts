import type { ThemeInstallResponse } from '@server/interfaces/api/themeInterfaces';
import AsyncLock from '@server/utils/asyncLock';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { THEMES_DIRECTORY, loadThemeDirectory, themeManager } from './index';

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_REGISTRY_BYTES = 64 * 1024;
const REGISTRY_PATH = path.join(THEMES_DIRECTORY, '.registry.json');
const themeMutationLock = new AsyncLock();

type RegistryEntry = {
  sourceUrl: string;
  installedVersion: string;
  installedAt: string;
};
type ThemeRegistry = Record<string, RegistryEntry>;
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
  if (
    assetUrl.protocol !== 'https:' ||
    !['github.com', 'api.github.com', 'objects.githubusercontent.com'].some(
      (host) =>
        assetUrl.hostname === host || assetUrl.hostname.endsWith(`.${host}`)
    )
  ) {
    throw new Error('GitHub returned an unexpected release asset URL.');
  }
  const response = await fetch(assetUrl, {
    headers: githubHeaders(
      useApiDownload
        ? 'application/octet-stream'
        : 'application/vnd.github+json'
    ),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Theme download failed (${response.status}).`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) {
    throw new Error('Theme package exceeds the download limit.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error('Theme package exceeds the download limit.');
  }
  return buffer;
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
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error('Theme package is truncated.');
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
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (fileCount === 0) {
    throw new Error('Theme package is empty.');
  }
};

const readRegistry = async (): Promise<ThemeRegistry> => {
  try {
    const stat = await fs.lstat(REGISTRY_PATH);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_REGISTRY_BYTES
    ) {
      throw new Error('Theme registry is not a valid regular file.');
    }
    const value: unknown = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Theme registry is invalid.');
    }
    for (const [themeId, entry] of Object.entries(value)) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(themeId) ||
        !entry ||
        typeof entry !== 'object' ||
        typeof (entry as RegistryEntry).sourceUrl !== 'string' ||
        typeof (entry as RegistryEntry).installedVersion !== 'string' ||
        typeof (entry as RegistryEntry).installedAt !== 'string'
      ) {
        throw new Error('Theme registry is invalid.');
      }
    }
    return value as ThemeRegistry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const writeRegistry = async (registry: ThemeRegistry) => {
  const temporary = `${REGISTRY_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporary, REGISTRY_PATH);
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
    const registry = await readRegistry();
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
    return installThemeFromGithubUnlocked(entry.sourceUrl);
  });

export const removeInstalledTheme = async (themeId: string) =>
  themeMutationLock.dispatch('themes', async () => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(themeId)) {
      throw new Error('Invalid theme ID.');
    }
    await fs.rm(path.join(THEMES_DIRECTORY, themeId), {
      recursive: true,
      force: true,
    });
    const registry = await readRegistry();
    delete registry[themeId];
    await writeRegistry(registry);
    return themeManager.reload();
  });
