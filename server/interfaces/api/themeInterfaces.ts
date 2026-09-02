export const THEME_SHADE_COUNT = 11;

export type ThemeModePreference = 'light' | 'dark' | 'auto';

export type ThemeAssetName =
  | 'logoDark'
  | 'logoLight'
  | 'iconDark'
  | 'iconLight'
  | 'faviconDark'
  | 'faviconLight'
  | 'backgroundDark'
  | 'backgroundLight';

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
}

export interface ThemeListResponse {
  themes: InstalledTheme[];
  errors: { package: string; message: string }[];
}

export interface ThemeInstallResponse {
  theme: InstalledTheme;
  sourceUrl: string;
}
