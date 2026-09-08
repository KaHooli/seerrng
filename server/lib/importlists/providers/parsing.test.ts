import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ImportListProviderId } from '@server/constants/importList';
import { MediaType } from '@server/constants/media';
import { ImportListIdentifierError } from '@server/lib/importlists/types';
import anilistProvider from './anilist';
import goodreadsProvider from './goodreads';
import imdbProvider, {
  extractImdbEntriesFromHtml,
  walkForImdbTitles,
} from './imdb';
import { getAllImportListProviders, getImportListProvider } from './index';
import letterboxdProvider, {
  parseLetterboxdFilmPage,
  parseLetterboxdListPage,
} from './letterboxd';
import mdblistProvider, { mdbListItemToEntry } from './mdblist';
import openLibraryProvider from './openlibrary';
import stevenLuProvider from './stevenlu';
import { tmdbCollectionProvider, tmdbListProvider } from './tmdb';
import traktProvider, { traktItemToEntry } from './trakt';
import tvdbProvider, { tvdbEntityToEntry } from './tvdb';

/**
 * Identifier parsing is the surface a user touches directly, and every case
 * below is a form documented by list-sync — someone migrating from that tool
 * must be able to paste the same strings here.
 */

describe('import list provider registry', () => {
  it('registers every provider id exactly once', () => {
    const providers = getAllImportListProviders();
    const ids = providers.map((provider) => provider.id);

    assert.equal(new Set(ids).size, ids.length);
    for (const id of Object.values(ImportListProviderId)) {
      assert.equal(getImportListProvider(id).id, id);
    }
  });

  it('gives every provider a label and an example identifier', () => {
    for (const provider of getAllImportListProviders()) {
      assert.ok(provider.label.length > 0, `${provider.id} needs a label`);
      assert.ok(provider.example.length > 0, `${provider.id} needs an example`);
      assert.ok(
        provider.mediaKinds.length > 0,
        `${provider.id} needs media kinds`
      );
    }
  });
});

describe('IMDb identifiers', () => {
  it('accepts list IDs, charts, watchlists and their URLs', () => {
    assert.equal(imdbProvider.parse('ls012345678').listId, 'ls012345678');
    assert.equal(
      imdbProvider.parse('https://www.imdb.com/list/ls012345678/').listId,
      'ls012345678'
    );
    assert.equal(imdbProvider.parse('top').listId, 'chart:top');
    assert.equal(
      imdbProvider.parse('https://www.imdb.com/chart/boxoffice/').listId,
      'chart:boxoffice'
    );
    assert.equal(imdbProvider.parse('ur12345678').listId, 'ur12345678');
    assert.equal(
      imdbProvider.parse('https://www.imdb.com/user/ur12345678/watchlist')
        .listId,
      'ur12345678'
    );
  });

  it('names the well-known charts', () => {
    assert.equal(imdbProvider.parse('top').name, 'IMDb Top 250');
    assert.equal(imdbProvider.parse('tvmeter').name, 'IMDb TVMeter');
  });

  it('rejects anything it cannot read', () => {
    for (const input of [
      '',
      'nonsense',
      'ls',
      'https://example.com/list/ls012345678',
      'https://www.imdb.com/title/tt0111161/',
    ]) {
      assert.throws(
        () => imdbProvider.parse(input),
        ImportListIdentifierError,
        `expected "${input}" to be rejected`
      );
    }
  });
});

describe('IMDb page parsing', () => {
  it('collects titles from anywhere in the embedded JSON', () => {
    const found = walkForImdbTitles({
      props: {
        pageProps: {
          items: [
            {
              titleId: 'tt0111161',
              titleText: { text: 'The Shawshank Redemption' },
              releaseYear: { year: 1994 },
              titleType: { id: 'movie' },
            },
            {
              const: 'tt0903747',
              primaryTitle: 'Breaking Bad',
              startYear: 2008,
              titleType: { id: 'tvSeries', isSeries: true },
            },
          ],
        },
      },
    });

    assert.equal(found.size, 2);
    assert.deepEqual(found.get('tt0111161'), {
      imdbId: 'tt0111161',
      title: 'The Shawshank Redemption',
      year: 1994,
      mediaType: MediaType.MOVIE,
    });
    assert.equal(found.get('tt0903747')?.mediaType, MediaType.TV);
  });

  it('reads titles out of a __NEXT_DATA__ script block', () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      { items: [{ id: 'tt0068646', titleText: { text: 'The Godfather' } }] }
    )}</script></body></html>`;

    const entries = extractImdbEntriesFromHtml(html);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].imdbId, 'tt0068646');
    assert.equal(entries[0].title, 'The Godfather');
  });

  it('returns nothing for a page with no JSON islands', () => {
    assert.deepEqual(extractImdbEntriesFromHtml('<html></html>'), []);
    assert.deepEqual(extractImdbEntriesFromHtml(''), []);
  });

  it('ignores malformed JSON rather than throwing', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{not json</script>';
    assert.deepEqual(extractImdbEntriesFromHtml(html), []);
  });
});

describe('Trakt identifiers', () => {
  it('accepts watchlists, custom lists and chart shortcuts', () => {
    assert.equal(
      traktProvider.parse('https://trakt.tv/users/jane/watchlist').listId,
      'user:jane:watchlist'
    );
    assert.equal(
      traktProvider.parse('https://app.trakt.tv/users/jane/lists/best-of-2024')
        .listId,
      'user:jane:list:best-of-2024'
    );
    assert.equal(
      traktProvider.parse('trending:movies').listId,
      'chart:trending:movies'
    );
    assert.equal(
      traktProvider.parse('popular:shows').listId,
      'chart:popular:shows'
    );
  });

  it('rejects the box office chart for shows, which Trakt does not publish', () => {
    assert.throws(
      () => traktProvider.parse('boxoffice:shows'),
      ImportListIdentifierError
    );
    assert.equal(
      traktProvider.parse('boxoffice:movies').listId,
      'chart:boxoffice:movies'
    );
  });

  it('rejects unrecognized input', () => {
    for (const input of [
      'https://trakt.tv/movies/the-matrix-1999',
      'https://example.com/users/jane/watchlist',
      'trending:albums',
      'garbage',
    ]) {
      assert.throws(
        () => traktProvider.parse(input),
        ImportListIdentifierError,
        `expected "${input}" to be rejected`
      );
    }
  });
});

describe('Trakt item mapping', () => {
  it('reads TMDB ids straight off a list row', () => {
    const entry = traktItemToEntry({
      type: 'movie',
      movie: {
        title: 'Arrival',
        year: 2016,
        ids: { tmdb: 329865, imdb: 'tt2543164' },
      },
    });

    assert.deepEqual(entry, {
      title: 'Arrival',
      year: 2016,
      mediaType: MediaType.MOVIE,
      tmdbId: 329865,
      imdbId: 'tt2543164',
      tvdbId: undefined,
    });
  });

  it('uses the endpoint media type for bare chart rows', () => {
    const entry = traktItemToEntry(
      { title: 'Severance', year: 2022, ids: { tmdb: 95396 } } as never,
      MediaType.TV
    );

    assert.equal(entry?.mediaType, MediaType.TV);
    assert.equal(entry?.tmdbId, 95396);
  });

  it('drops a row with neither a title nor an id', () => {
    assert.equal(traktItemToEntry({ movie: {} }), undefined);
    assert.equal(traktItemToEntry({}), undefined);
  });
});

describe('TMDB identifiers', () => {
  it('accepts slugged list URLs and bare IDs', () => {
    assert.equal(
      tmdbListProvider.parse('https://www.themoviedb.org/list/12345').listId,
      '12345'
    );
    assert.equal(
      tmdbListProvider.parse(
        'https://www.themoviedb.org/list/67890-my-favorite-movies'
      ).listId,
      '67890'
    );
    assert.equal(tmdbListProvider.parse('12345').listId, '12345');
  });

  it('parses collection URLs separately from list URLs', () => {
    assert.equal(
      tmdbCollectionProvider.parse('https://www.themoviedb.org/collection/1241')
        .listId,
      '1241'
    );
    assert.throws(
      () =>
        tmdbCollectionProvider.parse('https://www.themoviedb.org/list/1241'),
      ImportListIdentifierError
    );
  });
});

describe('TVDB identifiers', () => {
  it('accepts list URLs and bare IDs', () => {
    assert.equal(
      tvdbProvider.parse('https://www.thetvdb.com/lists/67890').listId,
      '67890'
    );
    assert.equal(tvdbProvider.parse('67890').listId, '67890');
  });

  it('maps series rows and drops movie rows it cannot resolve', () => {
    assert.deepEqual(tvdbEntityToEntry({ seriesId: 121361 }), {
      tvdbId: 121361,
      mediaType: MediaType.TV,
    });
    assert.equal(tvdbEntityToEntry({ movieId: 42 }), undefined);
    assert.equal(tvdbEntityToEntry({}), undefined);
  });
});

describe('Letterboxd identifiers', () => {
  it('accepts list and watchlist URLs', () => {
    assert.equal(
      letterboxdProvider.parse('https://letterboxd.com/jane/list/my-list/')
        .listId,
      'jane/list/my-list'
    );
    assert.equal(
      letterboxdProvider.parse('https://letterboxd.com/jane/watchlist/').listId,
      'jane/watchlist'
    );
  });

  it('titleizes the list slug as a fallback name', () => {
    assert.equal(
      letterboxdProvider.parse('https://letterboxd.com/jane/list/best-of-2024/')
        .name,
      'Best Of 2024'
    );
  });

  it('rejects bare usernames and other hosts', () => {
    for (const input of [
      'jane',
      'https://letterboxd.com/jane/',
      'https://example.com/jane/list/my-list/',
    ]) {
      assert.throws(
        () => letterboxdProvider.parse(input),
        ImportListIdentifierError,
        `expected "${input}" to be rejected`
      );
    }
  });
});

describe('Letterboxd page parsing', () => {
  it('reads film slugs from both old and new poster markup', () => {
    const html = `
      <ul>
        <li><div class="film-poster" data-film-slug="arrival"><img alt="Arrival" /></div></li>
        <li><div data-item-slug="dune" data-item-name="Dune"></div></li>
        <li><div data-film-link="/film/heat/"></div></li>
        <li><div class="film-poster" data-film-slug="arrival"><img alt="Arrival" /></div></li>
      </ul>`;

    const refs = parseLetterboxdListPage(html);

    assert.deepEqual(
      refs.map((ref) => ref.slug),
      ['arrival', 'dune', 'heat']
    );
    assert.equal(refs[0].title, 'Arrival');
    assert.equal(refs[1].title, 'Dune');
  });

  it('reads the TMDB id off a film page', () => {
    assert.deepEqual(
      parseLetterboxdFilmPage(
        '<html><body data-tmdb-id="329865" data-tmdb-type="movie"></body></html>'
      ),
      { tmdbId: 329865, mediaType: MediaType.MOVIE }
    );
    assert.deepEqual(parseLetterboxdFilmPage('<html><body></body></html>'), {
      tmdbId: undefined,
      mediaType: undefined,
    });
  });
});

describe('AniList identifiers', () => {
  it('accepts profile URLs, status segments and bare usernames', () => {
    assert.equal(
      anilistProvider.parse('https://anilist.co/user/jane/animelist').listId,
      'jane'
    );
    assert.equal(
      anilistProvider.parse('https://anilist.co/user/jane/animelist/Planning')
        .listId,
      'jane:PLANNING'
    );
    assert.equal(anilistProvider.parse('jane').listId, 'jane');
    assert.equal(anilistProvider.parse('jane:watching').listId, 'jane:CURRENT');
  });

  it('rejects an unknown status', () => {
    assert.throws(
      () => anilistProvider.parse('jane:abandoned'),
      ImportListIdentifierError
    );
  });
});

describe('MDBList identifiers', () => {
  it('accepts URLs and the username/listname short form', () => {
    assert.equal(
      mdblistProvider.parse('https://mdblist.com/lists/jane/top-movies').listId,
      'jane/top-movies'
    );
    assert.equal(
      mdblistProvider.parse('jane/top-movies').listId,
      'jane/top-movies'
    );
  });

  it('rejects malformed short forms', () => {
    for (const input of ['jane', 'jane/top/movies', '/top-movies']) {
      assert.throws(
        () => mdblistProvider.parse(input),
        ImportListIdentifierError,
        `expected "${input}" to be rejected`
      );
    }
  });

  it('only trusts the TMDB id when the row names its media type', () => {
    assert.equal(
      mdbListItemToEntry({ id: 329865, title: 'Arrival', mediatype: 'movie' })
        ?.tmdbId,
      329865
    );
    // Without a media type, a TMDB id is ambiguous and must not be used.
    assert.equal(
      mdbListItemToEntry({ id: 329865, title: 'Arrival' })?.tmdbId,
      undefined
    );
  });
});

describe('Steven Lu identifier', () => {
  it('accepts only its single well-known name', () => {
    assert.equal(stevenLuProvider.parse('stevenlu').listId, 'stevenlu');
    assert.equal(stevenLuProvider.parse('StevenLu').listId, 'stevenlu');
    assert.throws(
      () => stevenLuProvider.parse('popular-movies'),
      ImportListIdentifierError
    );
  });
});

describe('Goodreads identifiers', () => {
  it('defaults to the to-read shelf', () => {
    assert.equal(
      goodreadsProvider.parse('19281606').listId,
      '19281606:to-read'
    );
    assert.equal(
      goodreadsProvider.parse('19281606:read').listId,
      '19281606:read'
    );
  });

  it('reads the shelf out of a review list URL', () => {
    assert.equal(
      goodreadsProvider.parse(
        'https://www.goodreads.com/review/list/19281606?shelf=to-read'
      ).listId,
      '19281606:to-read'
    );
  });

  it('rejects a non-numeric user ID', () => {
    assert.throws(
      () => goodreadsProvider.parse('jane:to-read'),
      ImportListIdentifierError
    );
  });
});

describe('Open Library identifiers', () => {
  it('accepts list URLs, shelf URLs and their short forms', () => {
    assert.equal(
      openLibraryProvider.parse(
        'https://openlibrary.org/people/jane/lists/OL123L'
      ).listId,
      'jane/OL123L'
    );
    assert.equal(
      openLibraryProvider.parse(
        'https://openlibrary.org/people/jane/books/want-to-read'
      ).listId,
      'jane:want-to-read'
    );
    assert.equal(
      openLibraryProvider.parse('jane/OL123L').listId,
      'jane/OL123L'
    );
    assert.equal(
      openLibraryProvider.parse('jane:currently-reading').listId,
      'jane:currently-reading'
    );
  });

  it('rejects a shelf Open Library does not have', () => {
    assert.throws(
      () => openLibraryProvider.parse('jane:someday-maybe'),
      ImportListIdentifierError
    );
  });
});
