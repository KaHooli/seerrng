import logger from '@server/logger';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { REGISTRY_PATH } from './paths';

const MAX_REGISTRY_BYTES = 64 * 1024;
const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type RegistryEntry = {
  sourceUrl: string;
  installedVersion: string;
  installedAt: string;
};
export type ThemeRegistry = Record<string, RegistryEntry>;

const isRegistryEntry = (value: unknown): value is RegistryEntry =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as RegistryEntry).sourceUrl === 'string' &&
  typeof (value as RegistryEntry).installedVersion === 'string' &&
  typeof (value as RegistryEntry).installedAt === 'string';

// A damaged registry must never wedge theme management: the packages on disk
// are the source of truth, and the registry only records where each one came
// from. Unreadable content is reported and dropped so the next write heals it.
export const readRegistry = async (): Promise<ThemeRegistry> => {
  let raw: string;
  try {
    const stat = await fs.lstat(REGISTRY_PATH);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_REGISTRY_BYTES
    ) {
      logger.warn('Theme registry is not a valid regular file; ignoring it.', {
        label: 'Themes',
      });
      return {};
    }
    raw = await fs.readFile(REGISTRY_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    logger.warn('Theme registry is not valid JSON; ignoring it.', {
      label: 'Themes',
    });
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    logger.warn('Theme registry has an unexpected shape; ignoring it.', {
      label: 'Themes',
    });
    return {};
  }

  const registry: ThemeRegistry = {};
  for (const [themeId, entry] of Object.entries(value)) {
    if (THEME_ID_PATTERN.test(themeId) && isRegistryEntry(entry)) {
      registry[themeId] = entry;
    } else {
      logger.warn(`Dropping invalid theme registry entry for ${themeId}.`, {
        label: 'Themes',
      });
    }
  }
  return registry;
};

export const writeRegistry = async (registry: ThemeRegistry) => {
  const temporary = `${REGISTRY_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporary, REGISTRY_PATH);
};
