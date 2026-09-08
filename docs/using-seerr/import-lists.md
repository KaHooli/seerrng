---
sidebar_position: 23
---

# Import Lists

Import lists let each user subscribe to lists they keep elsewhere — an IMDb
watchlist, a Trakt list, a Letterboxd list, a Goodreads shelf — and have new
entries requested in SeerrNG automatically.

A list belongs to the user who added it. Requests it creates are attributed to
that user and go through their own permissions, quota, and approval rules, so a
list cannot get someone more than they could request by hand.

Lists are synced by the **Import List Sync** job. Administrators can change its
frequency, run it on demand, or cancel a run under **Settings → Jobs & Cache**.

## Enabling it for a user

Import lists are gated by the **Manage Import Lists** permission, granted per
user under **Settings → Users → (user) → Permissions**.

Someone holding it manages their own lists at **Profile → Settings → Import
Lists**. Administrators who also hold the permission can manage anyone's lists
from that user's settings page.

For a list set to request items, the owner additionally needs the relevant
auto-request permission (**Auto-Request Movies**, **Auto-Request Series**,
**Auto-Request Books**). Without it the list still syncs, but items are recorded
as skipped rather than requested.

## Global settings

**Settings → Import Lists** holds the settings that apply to every user's lists:

| Setting | What it does |
| --- | --- |
| Enable Import List Syncing | Master switch. When off, the job runs but processes nothing. |
| Maximum Items Per List | Upper bound on items read from any one list, per sync. Default 500. |
| Sync Concurrency | How many lists are fetched at once, across all users. |
| Default Action For New Lists | What the "add list" dialog preselects. |
| Trakt Client ID | Required before any Trakt list can sync. |
| TVDB API Key | Optional. |
| MDBList API Key | Optional; public MDBList lists work without one. |

The sync frequency lives with the job itself, under **Settings → Jobs & Cache**,
so there is one place that decides when lists run.

### Trakt credentials

1. Go to [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) and
   create a new application. The name is up to you; use
   `urn:ietf:wg:oauth:2.0:oob` as the redirect URI.
2. Copy the **Client ID** — the client secret is not needed.
3. Paste it under **Settings → Import Lists** and press **Test** to confirm
   Trakt accepts it before saving.

Only public lists are supported. There is no OAuth flow, so a private Trakt list
cannot be read.

## Supported providers

Paste the list's URL, or use the short form shown for each provider. Both are
normalized to the same stored identifier, so it does not matter which you use.

| Provider | Accepted identifiers |
| --- | --- |
| **IMDb** | `https://www.imdb.com/list/ls012345678/`, `ls012345678`, a chart name (`top`, `boxoffice`, `moviemeter`, `tvmeter`), or a watchlist (`https://www.imdb.com/user/ur12345678/watchlist`, `ur12345678`) |
| **Trakt** | `https://trakt.tv/users/<user>/watchlist`, `https://trakt.tv/users/<user>/lists/<list>`, or a chart shortcut such as `trending:movies`, `popular:shows`, `anticipated:movies` |
| **TMDB List** | `https://www.themoviedb.org/list/12345`, or the numeric ID |
| **TMDB Collection** | `https://www.themoviedb.org/collection/1241`, or the numeric ID |
| **TVDB List** | `https://www.thetvdb.com/lists/12345`, or the numeric ID |
| **Letterboxd** | `https://letterboxd.com/<user>/list/<list>/` or `https://letterboxd.com/<user>/watchlist/` |
| **AniList** | `https://anilist.co/user/<user>/animelist`, optionally with a status (`/animelist/Planning`), or just the username |
| **MDBList** | `https://mdblist.com/lists/<user>/<list>`, or `<user>/<list>` |
| **Steven Lu** | `stevenlu` — a single curated popular-movies feed |
| **Goodreads** | `19281606`, `19281606:read`, or `https://www.goodreads.com/review/list/19281606?shelf=to-read` |
| **Open Library** | `https://openlibrary.org/people/<user>/lists/OL123L`, `<user>/OL123L`, or a reading-log shelf: `<user>:want-to-read`, `<user>:currently-reading`, `<user>:already-read` |

Chart shortcuts for Trakt combine a list type (`trending`, `popular`,
`anticipated`, `watched`, `boxoffice`, `streaming`, `favorited`) with a media
type (`movies`, `shows`). Trakt only publishes a box office chart for movies.

SIMKL is not supported: its API has no endpoint for public custom lists.

### Book lists

Goodreads and Open Library lists request books, which needs a default
**Bookshelf** service configured under **Settings → Services**. When none is
configured, those providers do not appear in the picker.

Each book list chooses a format, because SeerrNG tracks the ebook and the
audiobook copy of a book separately:

| Format | Requests |
| --- | --- |
| Ebook | The ebook only (the default) |
| Audiobook | The audiobook only |
| Both | One of each, in a single request |

Goodreads shelves must belong to a public profile — SeerrNG reads the shelf's
RSS feed, which Goodreads serves only for public profiles. Books are matched to
Open Library by ISBN where the shelf has one, and by title and author otherwise.
Open Library lists name works directly and need no matching at all.

## What a sync does

For each enabled list, in turn:

1. The list is read, up to the configured item cap.
2. Each entry is resolved to something SeerrNG can request — an exact ID where
   the source gives one, otherwise a lookup, otherwise a title-and-year search.
3. Anything already available, already requested, or blocklisted is skipped.
4. The rest is either requested as the list owner, or added to their watchlist,
   depending on the list's **On Sync** setting.

Items settled by an earlier run are not reprocessed, so repeat syncs of a
long-standing list are cheap.

Each list records what its last sync did — items seen, requests created, items
skipped, and errors — visible both on the Import Lists tab and as a summary card
on the user's profile.

## Reading the status

| Status | Meaning |
| --- | --- |
| **Not yet synced** | The list has been added but has not run. |
| **Synced** | The list was read and every item was handled. |
| **Synced with problems** | The list was read, but some items could not be matched or requested. |
| **Failed** | The list itself could not be read. The reason is shown beneath the status. |

A list that returns items SeerrNG cannot interpret is reported as **Failed**,
not as an empty success. That distinction matters: a provider changing its
response format would otherwise look identical to "your list is empty", and
nothing would ever be requested again without any sign of a problem.

A user hitting their quota is not a failure: those items are recorded as skipped
and picked up on a later run, once the quota window has moved.

## Known limitations

**IMDb** has no list API. SeerrNG reads the JSON embedded in IMDb's own pages,
which works but is not guaranteed: IMDb intermittently serves a bot check
instead of the list. When that happens the list is marked **Failed** with an
explanation rather than silently syncing nothing, and the next scheduled run
tries again.

**Letterboxd** also has no API, and a film's TMDB ID only appears on the film's
own page — so the first sync of a Letterboxd list makes one request per film.
Those results are cached for a month, so later syncs only pay for new films.

Both are the two providers most likely to need a retry. The other providers use
real APIs and are not affected.
