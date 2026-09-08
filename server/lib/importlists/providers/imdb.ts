import ExternalAPI from '@server/api/externalapi';
import { ImportListProviderId } from '@server/constants/importList';
import { MediaType } from '@server/constants/media';
import cacheManager from '@server/lib/cache';
import type {
  ImportListEntry,
  ImportListFetchOptions,
  ImportListFetchResult,
  ImportListProvider,
  ParsedImportList,
} from '@server/lib/importlists/types';
import {
  ImportListIdentifierError,
  ImportListUnavailableError,
  asHttpUrl,
  requireNonEmptyIdentifier,
} from '@server/lib/importlists/types';
import logger from '@server/logger';

/**
 * IMDb lists, charts and watchlists.
 *
 * IMDb has no list API. list-sync reads these with a headless browser and falls
 * back to a browser-free HTTP path; only the latter is viable inside this
 * server, so this is that path with no fallback behind it. IMDb answers plain
 * HTTP clients with a bot-check interstitial some of the time — when that
 * happens the sync fails loudly (ImportListUnavailableError) rather than
 * reporting an empty list, because "your list is empty" and "IMDb blocked us"
 * must not look the same to the person who configured it.
 *
 * Identifiers:
 *   custom list   https://www.imdb.com/list/ls012345678/  ->  ls012345678
 *   chart         https://www.imdb.com/chart/top/         ->  chart:top
 *   watchlist     https://www.imdb.com/user/ur12345678/watchlist -> ur12345678
 */

const IMDB_BASE_URL = 'https://www.imdb.com';
const IMDB_CHARTS = ['top', 'boxoffice', 'moviemeter', 'tvmeter'] as const;
type ImdbChart = (typeof IMDB_CHARTS)[number];

const CHART_PREFIX = 'chart:';
const LIST_ID_PATTERN = /^ls\d{6,12}$/;
const USER_ID_PATTERN = /^ur\d{5,12}$/;
const IMDB_ID_PATTERN = /^tt\d{7,9}$/;
const IMDB_ID_ANYWHERE = /tt\d{7,9}/;

const CHART_NAMES: Record<ImdbChart, string> = {
  top: 'IMDb Top 250',
  boxoffice: 'IMDb Box Office',
  moviemeter: 'IMDb MovieMeter',
  tvmeter: 'IMDb TVMeter',
};

/** Keys IMDb has used to carry a title id, across page rewrites. */
const ID_KEYS = ['id', 'const', 'titleId', 'tconst'];
const TITLE_KEYS = [
  'titleText',
  'originalTitleText',
  'primaryTitle',
  'title',
  'text',
  'name',
];
const YEAR_KEYS = ['releaseYear', 'year', 'startYear'];
const TV_TITLE_TYPES = new Set([
  'tvseries',
  'tvminiseries',
  'tvepisode',
  'tvspecial',
  'tvshort',
]);

/** Guards the recursive walk over an untrusted, arbitrarily nested document. */
const MAX_WALK_DEPTH = 30;
/** A bot-check interstitial is small; a real list page is not. */
const INTERSTITIAL_MAX_BYTES = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const firstString = (
  node: Record<string, unknown>,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    // IMDb wraps display text one level down, e.g. {"titleText": {"text": …}}.
    if (isRecord(value)) {
      for (const inner of ['text', 'value', 'title']) {
        const nested = value[inner];
        if (typeof nested === 'string' && nested.trim()) {
          return nested.trim();
        }
      }
    }
  }
  return undefined;
};

const asYear = (value: unknown): number | undefined => {
  if (typeof value === 'number' && value > 1800 && value < 2200) {
    return value;
  }
  if (typeof value === 'string' && /^\d{4}/.test(value)) {
    const year = Number(value.slice(0, 4));
    return year > 1800 && year < 2200 ? year : undefined;
  }
  return undefined;
};

const firstYear = (node: Record<string, unknown>): number | undefined => {
  for (const key of YEAR_KEYS) {
    const value = node[key];
    const direct = asYear(value);
    if (direct) {
      return direct;
    }
    if (isRecord(value)) {
      for (const inner of ['year', 'text', 'value']) {
        const nested = asYear(value[inner]);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return undefined;
};

const mediaTypeFromNode = (node: Record<string, unknown>): MediaType => {
  const titleType = node.titleType;
  let raw: string | undefined;

  if (typeof titleType === 'string') {
    raw = titleType;
  } else if (isRecord(titleType)) {
    if (titleType.isSeries === true) {
      return MediaType.TV;
    }
    const candidate = titleType.id ?? titleType.text;
    raw = typeof candidate === 'string' ? candidate : undefined;
  }

  if (raw && TV_TITLE_TYPES.has(raw.replace(/[\s_]/g, '').toLowerCase())) {
    return MediaType.TV;
  }

  return MediaType.MOVIE;
};

/**
 * Collect every title carrying an IMDb id, wherever it sits in the document.
 *
 * Deliberately schema-agnostic: IMDb moves the list around between page
 * rewrites, and pinning the path is exactly what makes a scraper brittle.
 */
export const walkForImdbTitles = (
  node: unknown,
  found: Map<string, ImportListEntry> = new Map(),
  depth = 0
): Map<string, ImportListEntry> => {
  if (depth > MAX_WALK_DEPTH) {
    return found;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkForImdbTitles(child, found, depth + 1);
    }
    return found;
  }

  if (!isRecord(node)) {
    return found;
  }

  let imdbId: string | undefined;
  for (const key of ID_KEYS) {
    const value = node[key];
    if (typeof value === 'string' && IMDB_ID_PATTERN.test(value)) {
      imdbId = value;
      break;
    }
  }

  if (imdbId) {
    const title = firstString(node, TITLE_KEYS);
    const year = firstYear(node);
    const existing = found.get(imdbId);

    // The same title can appear both as a bare reference and as a full node;
    // keep the richest record seen.
    if (!existing || (title && !existing.title)) {
      found.set(imdbId, {
        imdbId,
        title,
        year,
        mediaType: mediaTypeFromNode(node),
      });
    } else if (existing && year && !existing.year) {
      existing.year = year;
    }
  }

  for (const child of Object.values(node)) {
    walkForImdbTitles(child, found, depth + 1);
  }

  return found;
};

/** Pulls every JSON island out of an IMDb page and walks each one. */
export const extractImdbEntriesFromHtml = (html: string): ImportListEntry[] => {
  if (!html) {
    return [];
  }

  const blocks: string[] = [];

  const nextData = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(
    html
  );
  if (nextData?.[1]) {
    blocks.push(nextData[1]);
  }

  const jsonBlocks = html.matchAll(
    /<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of jsonBlocks) {
    if (match[1]) {
      blocks.push(match[1]);
    }
  }

  const reactState =
    /IMDbReactInitialState[^=]*=\s*(\{[\s\S]*?\});\s*<\/script>/i.exec(html);
  if (reactState?.[1]) {
    blocks.push(reactState[1]);
  }

  const found = new Map<string, ImportListEntry>();
  for (const block of blocks) {
    try {
      walkForImdbTitles(JSON.parse(block), found);
    } catch {
      // A block that is not JSON is not an error; IMDb ships several.
    }
  }

  return [...found.values()];
};

class ImdbPageAPI extends ExternalAPI {
  constructor() {
    super(
      IMDB_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('importlist').data,
        headers: {
          // IMDb serves the interstitial to obviously-automated clients.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 30_000,
      }
    );
  }

  public async getPage(path: string): Promise<string> {
    return this.get<string>(
      path,
      { responseType: 'text', transformResponse: [(data) => data] },
      3600
    );
  }
}

type ImdbTarget =
  | { kind: 'list'; listId: string }
  | { kind: 'chart'; chart: ImdbChart }
  | { kind: 'watchlist'; userId: string };

export const resolveImdbTarget = (listId: string): ImdbTarget => {
  if (listId.startsWith(CHART_PREFIX)) {
    const chart = listId.slice(CHART_PREFIX.length);
    if ((IMDB_CHARTS as readonly string[]).includes(chart)) {
      return { kind: 'chart', chart: chart as ImdbChart };
    }
  }
  if (LIST_ID_PATTERN.test(listId)) {
    return { kind: 'list', listId };
  }
  if (USER_ID_PATTERN.test(listId)) {
    return { kind: 'watchlist', userId: listId };
  }
  throw new ImportListIdentifierError('Unrecognized IMDb list identifier.');
};

const targetToPath = (target: ImdbTarget): string =>
  target.kind === 'chart'
    ? `/chart/${target.chart}/`
    : target.kind === 'list'
      ? `/list/${target.listId}/`
      : `/user/${target.userId}/watchlist`;

class ImdbImportListProvider implements ImportListProvider {
  public readonly id = ImportListProviderId.IMDB;
  public readonly label = 'IMDb';
  public readonly mediaKinds = [MediaType.MOVIE, MediaType.TV] as const;
  public readonly example = 'https://www.imdb.com/list/ls012345678/';

  public isConfigured(): boolean {
    return true;
  }

  public parse(input: string): ParsedImportList {
    const identifier = requireNonEmptyIdentifier(input);

    const url = asHttpUrl(identifier);
    if (url) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'imdb.com' && !host.endsWith('.imdb.com')) {
        throw new ImportListIdentifierError('That is not an IMDb URL.');
      }
      const segments = url.pathname.split('/').filter(Boolean);

      if (segments[0] === 'chart' && segments[1]) {
        return this.parse(segments[1]);
      }
      if (segments[0] === 'list' && segments[1]) {
        return this.parse(segments[1]);
      }
      if (segments[0] === 'user' && segments[1]) {
        return this.parse(segments[1]);
      }

      throw new ImportListIdentifierError(
        'Use an IMDb list, chart, or watchlist URL.'
      );
    }

    const lowered = identifier.toLowerCase();

    if ((IMDB_CHARTS as readonly string[]).includes(lowered)) {
      const chart = lowered as ImdbChart;
      return {
        provider: ImportListProviderId.IMDB,
        listId: `${CHART_PREFIX}${chart}`,
        name: CHART_NAMES[chart],
      };
    }

    if (LIST_ID_PATTERN.test(lowered)) {
      return {
        provider: ImportListProviderId.IMDB,
        listId: lowered,
        name: `IMDb List ${lowered}`,
      };
    }

    if (USER_ID_PATTERN.test(lowered)) {
      return {
        provider: ImportListProviderId.IMDB,
        listId: lowered,
        name: `IMDb Watchlist ${lowered}`,
      };
    }

    throw new ImportListIdentifierError(
      'Use an IMDb list ID (ls…), user ID (ur…), chart name (top, boxoffice, moviemeter, tvmeter), or a full IMDb URL.'
    );
  }

  public async fetch(
    list: ParsedImportList,
    options: ImportListFetchOptions
  ): Promise<ImportListFetchResult> {
    const target = resolveImdbTarget(list.listId);
    const path = targetToPath(target);

    let html: string;
    try {
      html = await new ImdbPageAPI().getPage(path);
    } catch (e) {
      throw new ImportListUnavailableError(
        `IMDb did not return the list: ${
          e instanceof Error ? e.message : 'unknown error'
        }`
      );
    }

    const entries = extractImdbEntriesFromHtml(html);

    if (!entries.length) {
      // Tell the two failure modes apart so the status message is actionable.
      const looksLikeInterstitial =
        html.length < INTERSTITIAL_MAX_BYTES && !IMDB_ID_ANYWHERE.test(html);

      if (looksLikeInterstitial) {
        throw new ImportListUnavailableError(
          'IMDb served its bot check instead of the list. This usually clears on its own; the next scheduled sync will try again.'
        );
      }

      if (IMDB_ID_ANYWHERE.test(html)) {
        logger.warn(
          'IMDb page carried title IDs in an unrecognized shape; its embedded format may have changed',
          { label: 'Import List Sync', listId: list.listId }
        );
        throw new ImportListUnavailableError(
          'IMDb returned the page in a format this version cannot read.'
        );
      }

      // A genuinely empty list is a legitimate result.
      return { entries: [], truncated: false };
    }

    return {
      entries: entries.slice(0, options.maxItems),
      truncated: entries.length > options.maxItems,
    };
  }
}

export default new ImdbImportListProvider();
