# Feature request: incremental backups

**Status:** implemented in v1.3.0. How it actually shipped (which differs from the
proposal below in two good ways):

- **The list page DOES expose each deck's timestamp.** The proposal's central caveat
  ("the deck-list row HTML does not render each deck's `dateUpdate`") is **wrong against
  the current source**: every deck block on `/decks` includes
  `<time datetime="{{ dateUpdate|date('c') }}">`. We already download that HTML during
  enumeration, so reading it is free. `enumerateDecks` (in `src/extract.js`) now returns
  `{ id, dateUpdate }` per deck.
- **So there's no timestamp modal and no order-based early-stop.** A run enumerates the
  whole list (cheap), diffs each deck's list stamp against the cached per-deck stamp, and
  downloads only the new/updated ones. Comparison is timestamp-vs-timestamp, so there is
  no client-clock cutoff to get wrong. First run = full; later runs top up automatically.
- **User identity comes from the site itself.** MarvelCDB's `app.user.js` caches the
  logged-in user under `localStorage['user']`; we read it (same origin, free) to key the
  cache by `user_id` up front, so a shared computer login never mixes accounts. The first
  fetched deck's `user_id` is the authoritative fallback.
- **The cache is the incremental part; the ZIP is always a full copy.** The cache stores
  each deck's **raw object** (the `.json` source of truth, history and all), so a run only
  re-downloads changed decks. But every run regenerates all five files for *every* deck —
  from a freshly fetched raw deck if it changed, or the cached one if it didn't — so the
  ZIP is always a complete, self-contained backup. There is no unzip-"over"-an-old-folder
  step. The cache drops decks no longer enumerated, so deletions are reflected.
- **Stored in IndexedDB, not localStorage.** Raw decks can be several MB across a big
  collection, past localStorage's ~5MB (which we'd also share with MarvelCDB's own data).
  Keyed `backup:{userId}` → `{ lastBackupAt, decks: { [id]: rawDeck } }`. Cache, never a
  source of truth: missing/unreadable/another-account → the run just does a full backup and
  rebuilds it.
- **Cancel/error resumes, it doesn't restart.** Because each deck carries its own stamp,
  the cache is committed even on a cancelled or errored run (guarded so an *interrupted
  enumeration* — empty set — can't clobber a good cache). Any deck not refreshed keeps its
  old stamp and is re-detected next run, so an interrupted backup picks up where it left
  off instead of re-downloading everything. The in-run Pause/Resume button is separate
  (in-memory flow control within one run).
- **"Clear cached decks"** (a button by the launcher, shown once a cache exists) is the
  deliberate, discouraged way to force a full re-download.

See `content.js` (identity + diff + regenerate + clear + the IndexedDB wrapper),
`src/extract.js` (`enumerateDecks`), and `src/transform.js` (`buildManifestEntry`,
`buildIndexHtml`). The "detect the previous backup folder via the File System Access API
and update it in place" idea below stays a possible later upgrade.

The original proposal follows (kept for history; note the timestamp caveat above is now
obsolete). Today every run does a full backup of all decks. This describes fetching
**only decks added or updated since a timestamp**.

## Goal

- Let the user back up only what changed since a chosen timestamp.
- **Remember** the last successful backup time (localStorage) and **suggest** an
  incremental run automatically — make the low-impact choice the easy default.

## Feasibility (investigated against the MarvelCDB source)

Good news: the deck list is already ordered by recency.

- `/decks/{page}` (the enumeration endpoint) sorts by **`dateUpdate DESC` by
  default** (`DeckManager::findDecksWithComplexSearch`, `sort` switch: `updated` is
  the default case → `ORDER BY d.dateUpdate DESC`). It also accepts a `sort` query
  param (`updated` | `date` (creation) | `name`).
- Because the order is most-recently-updated-first, we can **stop early**: walk decks
  in list order and halt as soon as we reach one older than the cutoff — everything
  after it is older too.

Caveat found: the deck-list **row HTML does not render each deck's `dateUpdate`**
(the `list.html.twig` row has name, hero image, version, tags — no date). So the
cutoff can't be applied from the list page alone. Two workable approaches:

1. **Order-based early stop (no per-deck date on the list):** enumerate IDs in list
   order (do **not** re-sort by numeric id — the current code does `sort((a,b)=>a-b)`,
   which must change to preserve `dateUpdate DESC`). Fetch decks in that order; each
   `/deck/view/{id}` payload has `date_update`. Stop at the first deck with
   `date_update < cutoff`. Cost: only the changed decks + **one** boundary deck.
2. **Confirm whether a lighter signal exists:** check if any list-page field or a
   cheap endpoint exposes per-deck `dateUpdate` (e.g. an API/JSON variant, or a
   column we missed) so we could skip even fetching the boundary deck. Lower priority.

Either way the enumeration itself still pages through the list (cheap HTML), but the
expensive per-deck fetches are limited to what actually changed.

## UX

- On launch, if a stored `lastBackupAt` exists, offer: **"Incremental (since {date})"**
  vs **"Full backup"**, incremental preselected.
- Show how many decks look new/updated before committing (from the early-stop scan).
- On success, write `lastBackupAt = now` (and maybe a per-deck `dateUpdate` map) to
  `localStorage`, scoped to the logged-in `user_id`.
- Let the user pick a custom cutoff.

## Merging with an existing backup

An incremental run produces a partial ZIP. Decide how it composes with the prior
one:

- Simplest: incremental ZIP contains only changed decks; user unzips over the old
  folder (new/updated files overwrite; deletions not reflected).
- Later: detect the previous backup folder (via File System Access API) and update
  it in place, including a manifest diff. Bigger scope.

## Persistence details

- Key on `user_id` (from any deck's payload, or the session) so switching accounts
  doesn't cross-contaminate timestamps.
- Store: `{ userId, lastBackupAt, deckCount, perDeckUpdatedAt? }`.
- localStorage is per-origin (marvelcdb.com) and survives across sessions — exactly
  what we want, and it never leaves the browser.

## Code touch-points

- `src/extract.js` — preserve list order; add `enumerate(sinceTs)` early-stop;
  expose each deck's `date_update`.
- `src/ui.js` — the full-vs-incremental prompt and the "N changed" preview.
- `content.js` — read/write `localStorage`; choose the enumeration mode.
