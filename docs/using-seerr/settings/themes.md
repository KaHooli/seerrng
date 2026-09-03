---
title: Themes
description: Install external themes and configure the default appearance.
sidebar_position: 2
---

# Themes

Administrators can manage external themes under **Settings → General → Appearance**. A theme can provide its own colour scales, logos, icons, favicons, and login background for both light and dark modes.

## Default appearance

Choose a default theme and a default mode of **Light**, **Dark**, or **Automatic**. Automatic follows the user's operating-system preference. Users can normally override both choices from the theme picker. Enable **Enforce Theme for All Users** to disable those individual overrides.

If an external default theme is removed or becomes invalid, Seerr falls back to the built-in Aurora theme.

## Install from GitHub

Paste an HTTPS GitHub repository URL into **Install from GitHub**. Seerr downloads the first `.tar.gz` asset from the repository's latest release, validates it, and installs it in the persistent configuration directory.

The installer only accepts GitHub release assets. Packages have strict download, extraction, entry-count, file-count, and asset-size limits. Absolute paths, parent-directory traversal, and links are rejected. Pax headers are skipped rather than honoured, so archives produced by `git archive` or by the default `tar` on macOS install normally.

Theme assets are served with a restrictive content security policy, so an SVG in a package cannot run script even if it is opened directly.

For private repositories, set a `GITHUB_TOKEN` environment variable with read access to the repository.

## Install from the configuration directory

You can also copy an extracted package to:

```text
/app/config/themes/<theme-id>/
```

For Docker installations, `/app/config` must be mapped to persistent storage and the container's `node` user must be able to read the package. Select **Reload Themes** after copying or changing files.

Each package requires a `theme.json` manifest. Its directory name must exactly match the manifest's `id`, and the `id` may not reuse one of the built-in palette names such as `aurora`:

```json
{
  "schemaVersion": 1,
  "id": "example-theme",
  "name": "Example Theme",
  "version": "1.0.0",
  "minimumSeerrVersion": "3.13.0",
  "author": "Example Author",
  "swatches": ["#8f171b", "#c69a45"],
  "colors": {
    "surface": ["#ffffff", "#f7f7f7", "#eeeeee", "#dddddd", "#bbbbbb", "#999999", "#777777", "#555555", "#333333", "#1d1d1d", "#0b0b0b"],
    "primary": ["#fff5f5", "#ffe5e6", "#ffcacc", "#f5a4a8", "#dc747a", "#bd454c", "#8f171b", "#741217", "#5b0e12", "#42090d", "#290507"],
    "secondary": ["#fffaf0", "#fdf0d2", "#f8dfaa", "#edc878", "#dbb052", "#c69a45", "#a77932", "#865d26", "#65451d", "#473015", "#2b1c0b"]
  },
  "assets": {
    "logoDark": "assets/logo-dark.svg",
    "logoLight": "assets/logo-light.svg",
    "logoStackedDark": "assets/logo-stacked-dark.png",
    "logoStackedLight": "assets/logo-stacked-light.png",
    "iconDark": "assets/icon-dark.svg",
    "iconLight": "assets/icon-light.svg",
    "faviconDark": "assets/favicon-dark.svg",
    "faviconLight": "assets/favicon-light.svg",
    "backgroundDark": "assets/background-dark.webp",
    "backgroundLight": "assets/background-light.webp"
  }
}
```

Each `surface`, `primary`, and `secondary` array must contain exactly eleven six-digit hexadecimal colours, ordered from shade 50 through 950. Assets are optional and must be safe relative paths within the package. A path that leaves the package through a symlink is rejected, including when the package was extracted by hand.

`logoDark` and `logoLight` replace the wide sidebar logo. `logoStackedDark` and `logoStackedLight` replace the taller sign-in, setup, and password-reset logo; when they are absent the wide logo is used there instead, which suits a stacked lockup better than a long wordmark.

Supply `iconDark`, `iconLight`, `faviconDark`, and `faviconLight` as PNG or ICO where you need them on Apple devices: iOS ignores SVG home-screen icons, and older Safari ignores SVG favicons. The bundled icons stay declared as fallbacks either way.

## Packaging a release

Publish the theme directory as the single top-level directory in a `.tar.gz` release asset. Ustar, GNU, and pax archives are all accepted.

## Updating a theme

**Update** is offered only for packages installed from a release, because those are the only ones with a recorded source. Update a hand-copied package by replacing its directory and selecting **Reload Themes**. If a package changes its `id` between releases, the update installs the new ID and removes the old directory.
