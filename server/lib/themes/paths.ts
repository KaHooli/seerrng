import path from 'node:path';

const CONFIG_DIRECTORY = process.env.CONFIG_DIRECTORY
  ? path.resolve(process.env.CONFIG_DIRECTORY)
  : path.resolve(__dirname, '../../../config');

export const THEMES_DIRECTORY = path.join(CONFIG_DIRECTORY, 'themes');
export const REGISTRY_PATH = path.join(THEMES_DIRECTORY, '.registry.json');
