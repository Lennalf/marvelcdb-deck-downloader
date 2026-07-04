# Feature request: incremental backups

**Status:** proposed (post-migration). Today every run does a full backup of all
decks. This describes fetching **only decks added or updated since a timestamp**, so
a user who has already done the big backup can top up cheaply without pummeling
marvelcdb.com.

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
