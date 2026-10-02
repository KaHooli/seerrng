import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import PWAHeader from '.';

beforeEach(() => vi.stubGlobal('React', React));

const bundledFavicons = /favicon-(?:32x32|16x16)\.png/g;
const bundledTouchIcon = /\/apple-touch-icon\.png/;

it('declares the bundled icons when no theme icon is installed', () => {
  const html = renderToStaticMarkup(<PWAHeader />);
  expect(html.match(bundledFavicons)).toHaveLength(2);
  expect(html).toMatch(bundledTouchIcon);
});

it('keeps the bundled PNGs beside SVG theme icons for clients without SVG support', () => {
  const html = renderToStaticMarkup(
    <PWAHeader
      favicon="/themes/example/favicon.svg"
      faviconType="image/svg+xml"
      touchIcon="/themes/example/icon.svg"
      touchIconType="image/svg+xml"
    />
  );
  expect(html).toContain('href="/themes/example/favicon.svg" sizes="any"');
  expect(html).toContain('href="/themes/example/icon.svg" sizes="any"');
  expect(html.match(bundledFavicons)).toHaveLength(2);
  expect(html).toMatch(bundledTouchIcon);
});

it('lets raster theme icons replace the bundled PNGs so they cannot be outranked', () => {
  const html = renderToStaticMarkup(
    <PWAHeader
      favicon="/themes/example/favicon.png"
      faviconType="image/png"
      touchIcon="/themes/example/icon.png"
      touchIconType="image/png"
    />
  );
  expect(html).toContain('href="/themes/example/favicon.png"');
  expect(html).toContain('href="/themes/example/icon.png"');
  expect(html).not.toMatch(bundledFavicons);
  expect(html).not.toMatch(bundledTouchIcon);
});

it('treats the favicon and touch icon independently', () => {
  const html = renderToStaticMarkup(
    <PWAHeader
      favicon="/themes/example/favicon.ico"
      faviconType="image/x-icon"
      touchIcon="/themes/example/icon.svg"
      touchIconType="image/svg+xml"
    />
  );
  expect(html).not.toMatch(bundledFavicons);
  expect(html).toMatch(bundledTouchIcon);
});
