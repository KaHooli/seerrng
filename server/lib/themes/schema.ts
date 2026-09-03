import {
  THEME_SHADE_COUNT,
  isBuiltInThemeId,
  type ThemeManifest,
} from '@server/interfaces/api/themeInterfaces';
import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a hex colour');
const assetFile = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/,
    'must be a safe relative path'
  )
  .refine(
    (value) => /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(value),
    'must be a supported image file'
  );
const colorScale = z.array(hexColor).length(THEME_SHADE_COUNT);

export const themeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .refine(
        (value) => !isBuiltInThemeId(value),
        'must not reuse a built-in theme ID'
      ),
    name: z.string().trim().min(1).max(64),
    version: z
      .string()
      .min(1)
      .max(32)
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    minimumSeerrVersion: z.string().min(1).max(32).optional(),
    author: z.string().trim().min(1).max(80).optional(),
    swatches: z.array(hexColor).min(2).max(6),
    colors: z.object({
      surface: colorScale,
      primary: colorScale,
      secondary: colorScale,
    }),
    assets: z
      .object({
        logoDark: assetFile.optional(),
        logoLight: assetFile.optional(),
        logoStackedDark: assetFile.optional(),
        logoStackedLight: assetFile.optional(),
        iconDark: assetFile.optional(),
        iconLight: assetFile.optional(),
        faviconDark: assetFile.optional(),
        faviconLight: assetFile.optional(),
        backgroundDark: assetFile.optional(),
        backgroundLight: assetFile.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const parseThemeManifest = (value: unknown): ThemeManifest =>
  themeManifestSchema.parse(value) as ThemeManifest;
