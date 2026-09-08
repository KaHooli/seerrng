import { ImportListProviderId } from '@server/constants/importList';
import type {
  ImportListProvider,
  ParsedImportList,
} from '@server/lib/importlists/types';
import { ImportListIdentifierError } from '@server/lib/importlists/types';
import anilistProvider from './anilist';
import goodreadsProvider from './goodreads';
import imdbProvider from './imdb';
import letterboxdProvider from './letterboxd';
import mdblistProvider from './mdblist';
import openLibraryProvider from './openlibrary';
import stevenLuProvider from './stevenlu';
import { tmdbCollectionProvider, tmdbListProvider } from './tmdb';
import traktProvider from './trakt';
import tvdbProvider from './tvdb';

/**
 * The single source of truth for which providers exist. The route layer, the
 * provider picker in the UI, and the sync engine all read this map, so adding a
 * provider is one entry here plus its module.
 */
const providers: Record<ImportListProviderId, ImportListProvider> = {
  [ImportListProviderId.IMDB]: imdbProvider,
  [ImportListProviderId.TRAKT]: traktProvider,
  [ImportListProviderId.TMDB]: tmdbListProvider,
  [ImportListProviderId.TMDB_COLLECTION]: tmdbCollectionProvider,
  [ImportListProviderId.TVDB]: tvdbProvider,
  [ImportListProviderId.LETTERBOXD]: letterboxdProvider,
  [ImportListProviderId.ANILIST]: anilistProvider,
  [ImportListProviderId.MDBLIST]: mdblistProvider,
  [ImportListProviderId.STEVENLU]: stevenLuProvider,
  [ImportListProviderId.GOODREADS]: goodreadsProvider,
  [ImportListProviderId.OPENLIBRARY]: openLibraryProvider,
};

export const getImportListProvider = (
  id: ImportListProviderId
): ImportListProvider => {
  const provider = providers[id];
  if (!provider) {
    throw new ImportListIdentifierError(`Unknown list provider "${id}".`);
  }
  return provider;
};

export const getAllImportListProviders = (): ImportListProvider[] =>
  Object.values(providers);

/** Normalizes user input for a given provider, or throws a 400-shaped error. */
export const parseImportListIdentifier = (
  provider: ImportListProviderId,
  input: string
): ParsedImportList => getImportListProvider(provider).parse(input);

export default providers;
