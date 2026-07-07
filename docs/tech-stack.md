# Tech stack & data flow

How the extension acquires and transforms data. This is the reference for the
standalone repo: every network call it makes, why, and how the code is layered.

## Design principle: extract raw, then transform

The tool has two clearly separated halves, in two source modules:

- **Extraction** (`src/extract.js`) — talks to marvelcdb.com and returns **raw,
  unadulterated data**: the deck object exactly as the site embeds it, the deck's
  revision history, the bulk card database, and the pack list. It knows nothing
  about output formats.
- **Transformation** (`src/transform.js`) — **pure functions** that take that raw
  data and produce each output format (Markdown, Text, OCTGN, HTML, the index
  page). No network, no DOM, no globals.

Everything downstream is derived: the raw deck JSON is the source of truth, and
every other format is regenerated from it. If a transform is ever wrong, the raw
JSON in the backup still has the complete information to regenerate it.

`src/zip.js` (pure ZIP writer) and `src/ui.js` (progress panel/button) are the
other two modules; `content.js` is the thin orchestrator that wires them together.
It also owns the cross-run deck cache (raw decks in IndexedDB, keyed by MarvelCDB
user id) that powers incremental backups — see the incremental-backup doc. Because
the ZIP is regenerated in full from raw decks every run (cached or freshly fetched),
every backup is complete regardless of how few decks were actually downloaded.

## Network calls

Everything runs **same-origin on marvelcdb.com** (a content script), so the user's
login cookie is sent automatically and there is no CORS wall. Requests are
single-flight, spaced ~0.6 s with jitter, and back off honoring `Retry-After`.

The content script is injected **only on the My Decks list pages** (`matches:
https://marvelcdb.com/decks*`), so the launcher button appears there and nowhere else.
It still reaches the per-deck and API endpoints below via same-origin `fetch()` from
that page, so it never needs to be injected on `/deck/view/{id}` or the API paths.

| #   | Request                                     | Freq                            | Auth                                                   | Purpose                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------- | ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /decks/{page}` (HTML)                  | per list page (~1 per 12 decks) | **session**                                            | Enumerate the user's personal decks. The only listing that includes _unpublished_ decks. Paginated 12/page; per deck block we read its id, and its last-updated stamp from `<time datetime>` (`enumerateDecks`). Incremental backups diff that stamp against the cache to skip unchanged decks, so most decks are never fetched at all. Default order is **`dateUpdate DESC`**.         |
| 2   | `GET /deck/view/{id}` (HTML)                | **per deck**                    | public if "Share your decks" is on, else owner session | The raw deck. The page embeds the full deck object inline as `app.deck.init({…})` (includes `description_md`) and the revision history as `app.deck_history.init([…])`. There is **no JSON API** for personal decks, so this HTML is the source.                |
| 3   | `GET /api/public/cards/?encounter=1` (JSON) | **once per run**                | none (public)                                          | Bulk card database. Resolves card codes → `name`, `subname`, `type_code`, `pack_code`/`pack_name`, `quantity`, `octgn_id`, `permanent`, card-set info. One bulk call powers every deck's Text/OCTGN/HTML transforms — **never per-card, never per-deck-cards**. |
| 4   | `GET /api/public/packs/` (JSON)             | **once per run**                | none (public)                                          | Pack list with `position`. Needed to order the Text export's "Packs: From X to Y" line and to group cards by pack (`getIncludedPacks`).                                                                                                                         |

So a full backup of _N_ decks is roughly `ceil(N/12) + N + 2` requests: the two
bulk reference calls are amortized across the whole run. An incremental top-up is only
`ceil(N/12) + C + 2`, where _C_ is the number of new/changed decks: the list paging still
happens (it is how we detect changes and deletions), but the expensive per-deck fetches
are limited to what actually changed.

### Local state (no network)

Two things are read/written locally rather than over the wire:

- **Who is logged in.** We read the current user id from MarvelCDB's own
  `localStorage['user']` (its `app.user.js` caches `{ id, name, … }` there). Same origin,
  so it is free and needs no request; we only ever read it, and use it to key the cache
  per account. The first fetched deck's `user_id` is the authoritative fallback.
- **The deck cache.** Raw decks in IndexedDB keyed `backup:{userId}` (see the
  incremental-backup doc). This is what lets a top-up re-fetch only what changed while the
  ZIP is still regenerated in full.

### Endpoints we deliberately do NOT use

- **`/deck/export/text/{id}` and `/deck/export/octgn/{id}`** — these _are_ the UI's
  Text/OCTGN downloads, but they (a) **require login** (they redirect anonymous
  requests to `/login`, unlike `/deck/view`) and (b) are **one extra request per
  deck**, which would roughly triple request volume. We generate both formats by
  transformation from the bulk card DB instead. If byte-exact fidelity to the site's
  output ever matters more than request volume, these endpoints are the fallback
  (the user explicitly allowed "other API calls" if a transform can't be reliable).
- **`/api/public/decklist/{id}`** — public API, but only serves **published**
  decklists; personal/unpublished decks (the whole point) aren't covered.
- **`/api/oauth2/*` (private API)** — would need an OAuth token the user doesn't have.
- **`/deck/export/all`** — bulk zip, but only card-list text; drops the write-up.

## Raw data shapes

**Deck object** (from `app.deck.init(...)`, the `.json` we save verbatim):
`id, name, date_creation, date_update, description_md, user_id, hero_code,
hero_name, slots ({cardcode: qty}), ignoreDeckLimitSlots, version, meta (JSON
string with aspect/aspect2), tags, problem`, plus `history` (array of saved
versions: `{variation, is_saved, version, content: {cardcode: qty}, date_creation}`)
that we attach from `app.deck_history.init(...)`.

**Card** (bulk API): `code, name, subname, quantity, type_code, type_name,
pack_code, pack_name, octgn_id, deck_limit, permanent, card_set_code,
card_set_type_name_code, card_set_parent_code, position`.

**Pack** (bulk API): `code, name, position, available, id`.

## Transforms (raw → format)

All in `src/transform.js`, ported/adapted from the MarvelCDB source
(`reference/marvelsdb` in the Codex repo). Each takes the raw deck plus the shared
`cardMap`/`packMap` context.

- **JSON** — the raw deck object, untouched (the preservation guarantee).
- **Markdown** — YAML front-matter (id, name, hero, aspect, tags, dates, source
  URL) + `description_md`.
- **Text** — reproduces `Export/plain.txt.twig`: name, hero, a "Packs:" line
  (first→last by pack `position`, via `getIncludedPacks`), then sections in the
  template's order — Upgrades, Events, Supports, Resources, Allies, Player Side
  Schemes — each line `{qty}x {name} ({pack})` (events append `:{subname}`). Card
  order within a section follows the deck's stored slot order.
- **OCTGN** — reproduces `Export/octgn.xml.twig`: the fixed game GUID, the hero via
  `octgn_id` split on `:` (part 1), then `<card qty id={octgn_id}>name</card>` for
  support, event, upgrade, ally, resource, player_side_scheme. XML, so indentation
  is cosmetic — OCTGN clients parse it regardless.
- **HTML** — a standalone, print-friendly deck page (decklist grouped by type with
  quantities + subnames, notes rendered from Markdown, the hero's nemesis set). Each card
  shows a MarvelCDB-style marker: a colored aspect dot, or a person icon for signature
  (hero-faction) cards, keyed off `card.faction_code`. Card names link to marvelcdb.com.
  Self-contained (inline CSS, no images required); light/dark theme via CSS variables.
- **index.html** — a browsable table of every deck (hero, aspect, tags, last-updated),
  reverse-chronological by default, linking each deck's page and all five raw formats.
  Search-as-you-type, sortable headers, and a side-sheet preview (see the index-page
  feature doc). Built from the manifest entries, not the raw decks.
- **marvelcdb-decks.html** — a single self-contained viewer with every deck embedded, for
  phones or emailing to yourself. Same table as the index, but the side sheet renders each
  deck from an inline `DECKS` blob via iframe `srcdoc` (no sibling files), so it browses
  offline from one file. See the single-file viewer feature doc. Built by `buildViewerHtml`.
- **manifest.json** — the machine-readable index: one `buildManifestEntry` per deck
  (id, name, hero, aspects, tags, `date_update`, file base path, url).

All HTML outputs share one palette expressed as CSS custom properties (`transform.js`),
with light default, `prefers-color-scheme` dark, a light/dark/auto toggle, and a print
override that forces white.

## Slot ordering note

`deck.slots` is a `{cardcode: qty}` object. MarvelCDB card codes are zero-padded
strings (`"01071"`), which are **non-array-index** keys in JS, so iterating the
object preserves insertion order (the order MarvelCDB stored). Text/OCTGN rely on
this to match the site's within-section card order without a separate sort.
