export const THEME_SHADE_COUNT = 11;

// Palette identifiers that ship with the application. An installed package may
// not claim one of these: the built-in palette always wins the lookup, so a
// colliding package would be permanently unselectable.
export const BUILT_IN_THEME_IDS = [
  'aurora',
  'ember',
  'lagoon',
  'orchid',
  'forest',
  'sapphire',
  'rosewood',
  'citrus',
  'arctic',
  'grape',
  'coral',
  'mint',
  'steel',
  'gold',
  'plum',
  'skyline',
  'moss',
  'flame',
  'violet',
  'ocean',
  'sietch-neon',
] as const;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];

export const isBuiltInThemeId = (id: string): id is BuiltInThemeId =>
  (BUILT_IN_THEME_IDS as readonly string[]).includes(id);

export type ThemeModePreference = 'light' | 'dark' | 'auto';

export type ThemeAssetName =
  | 'logoDark'
  | 'logoLight'
  | 'logoStackedDark'
  | 'logoStackedLight'
  | 'iconDark'
  | 'iconLight'
  | 'faviconDark'
  | 'faviconLight'
  | 'backgroundDark'
  | 'backgroundLight';

export const THEME_ASSET_NAMES: readonly ThemeAssetName[] = [
  'logoDark',
  'logoLight',
  'logoStackedDark',
  'logoStackedLight',
  'iconDark',
  'iconLight',
  'faviconDark',
  'faviconLight',
  'backgroundDark',
  'backgroundLight',
];

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  minimumSeerrVersion?: string;
  author?: string;
  swatches: string[];
  colors: {
    surface: string[];
    primary: string[];
    secondary: string[];
  };
  assets?: Partial<Record<ThemeAssetName, string>>;
}

export interface InstalledTheme extends ThemeManifest {
  assetUrls: Partial<Record<ThemeAssetName, string>>;
  // Media types let the browser pick between a theme's vector assets and the
  // built-in raster fallbacks instead of guessing from an extensionless URL.
  assetTypes: Partial<Record<ThemeAssetName, string>>;
  // Present only for packages installed from a release, which are the only
  // ones that can be updated in place.
  sourceUrl?: string;
}

export interface ThemeListResponse {
  themes: InstalledTheme[];
  errors: { package: string; message: string }[];
}

export interface ThemeInstallResponse {
  theme: InstalledTheme;
  sourceUrl: string;
}
