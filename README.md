# MarvelCDB Deck Backup (Chromium extension)

Back up **all your MarvelCDB decks** — cards, metadata, **and the Markdown write-up**
that the Text/OCTGN downloads leave out — as a single ZIP. Works on unpublished decks.
Everything runs in your browser; nothing is uploaded anywhere.

## Why an extension (and not a plain web page)

Reading your personal decks needs your logged-in session, and marvelcdb.com sends no
cross-origin (CORS) headers, so a normal page on another site can't fetch them. This
extension's content script runs **on marvelcdb.com itself**, where your session works
automatically and there's no CORS wall. It only ever reads your own decks.

## Install (Brave / Chrome / any Chromium browser)

**A. From this folder (simplest for development):**

1. Go to `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this repository folder.
4. (Optional) Pin the extension so its icon shows in the toolbar.

**B. From a packaged zip (cleaner to hand to someone else):**
Run `./build.sh` to produce `dist/marvelcdb-deck-backup-v<version>.zip` containing only
the runtime files. The recipient unzips it and does **Load unpacked** on the unzipped
folder (steps 1–3 above).

**C. Chrome Web Store (true one-click install):**
Upload that same zip to the [Chrome Web Store](https://chrome.google.com/webstore/devconsole)
(one-time $5 developer account + a review). Brave installs Web Store extensions directly,
so this is the only route that gives a one-click, auto-updating install with nothing to
unzip. _Note:_ standalone `.crx` files can't be used — Chromium blocks installing
extensions from outside the Web Store, so a downloadable `.crx` is not offered.

Everything runs locally either way; the extension has no server and sends nothing anywhere.

## Use

1. Open [marvelcdb.com](https://marvelcdb.com) and make sure you're **logged in**.
2. Either click the toolbar icon **or** the floating **Back up my decks** button
   (bottom-right of any marvelcdb.com page).
3. A progress panel appears with two stages:
   - **Discovering decks** — pages through your deck list to build the full set of
     IDs, showing "list page N of X" and a running deck count.
   - **Downloading decks** — fetches each deck, showing "deck Y of Z: {name}" and a
     progress bar, plus a running count of any that failed.
     You can **Pause/Resume** or **Cancel** at any point. Cancelling mid-run offers to
     save the decks collected so far. When it finishes,
     `marvelcdb-decks-backup-YYYY-MM-DD.zip` downloads. An **Activity log** (collapsed
     by default) records any per-deck errors and server back-off notices.

## What's in the ZIP

Five formats per deck, all derived from the one raw JSON (see `docs/tech-stack.md`):

- `decks/{id}-{name}.json` — the complete **raw** deck object (cards, meta, tags,
  write-up) **plus its full revision history** (`history`: every saved version with
  its card list and timestamp). This is the source of truth; every other format is
  generated from it.
- `decks/{id}-{name}.md` — YAML front-matter + your Markdown write-up (human-readable).
- `decks/{id}-{name}.txt` — plain-text decklist matching MarvelCDB's **Text** download.
- `decks/{id}-{name}.o8d` — **OCTGN** deck file matching MarvelCDB's OCTGN download.
- `decks/{id}-{name}.html` — a **standalone, print-friendly page** that reproduces the
  MarvelCDB deck view: decklist on the left (grouped by type, with quantities and card
  **subtitles** to tell apart cards that share a name, e.g. the two Spider-Man allies),
  notes on the right, plus the hero's nemesis "Hero set". Card names are hyperlinks to
  marvelcdb.com. No styling/images required — you can print it and build the deck from
  paper. Card names come from MarvelCDB's public card database, fetched once per run.
- `index.html` — a browsable table of every deck in the backup, linking to each page.
  Open this first.
- `manifest.json` — a machine-readable index of every deck backed up.

This is everything MarvelCDB exposes for a personal deck. Not included because it isn't
part of the private deck record: `previous_deck`/`next_deck`/`xp` (excluded by the site's
serializer; unused for Marvel Champions), published-version copies (`children` — separate
public decklists, available via the public API), full card text/images (derivable from the
card database), and comments/likes (only exist on _published_ decklists).

Re-run any time; it always pulls a fresh, complete set.

## Being a good guest (throttling)

The backup is deliberately gentle on marvelcdb.com:

- **One request at a time** (no parallel fetching), spaced ~0.6s apart with a little
  random jitter — roughly 1.5 requests/second.
- **Honors `Retry-After`** and backs off exponentially on any `429`/`5xx`, then stays
  slower for the rest of the run so it never crowds the server.
- Requests go out as normal first-party calls from your logged-in session — the same
  thing the site's own pages do — so there's nothing unusual for the server to absorb.

A few hundred decks take roughly 3–5 minutes. If you want it slower still, raise
`MIN_DELAY` near the top of `content.js`.

## How it works

- Enumerates your deck IDs by paging through `/decks/{page}` (uses your session cookie,
  sent automatically because the content script is same-origin). The pagination links on
  those pages give the total page count, which drives the discovery progress bar.
- Loads the public card database **once** (`/api/public/cards/?encounter=1`) and the pack
  list once (`/api/public/packs/`) — the same endpoints MarvelCDB's own front-end uses — to
  resolve card codes to names/subtitles/types and to order packs. One bulk fetch each,
  never per-card or per-deck.
- For each deck, fetches `/deck/view/{id}` and extracts the deck object that marvelcdb
  embeds inline as `app.deck.init({...})` — this is where `description_md` lives — plus the
  `app.deck_history.init([...])` revision history.
- Transforms that raw deck into `.md`, `.txt` (matching the site's Text export), `.o8d`
  (matching the OCTGN export), and `.html`, writes the raw `.json`, plus a top-level
  `index.html`, and packs everything into a ZIP with a small built-in store-only ZIP writer
  (no external libraries). See `docs/tech-stack.md` for why Text/OCTGN are transformed
  rather than fetched from the (login-gated, per-deck) export endpoints.

## Files

Extraction and transformation are kept in separate modules (see `docs/tech-stack.md`):

- `manifest.json` — MV3 manifest.
- `background.js` — routes the toolbar-icon click to the active marvelcdb tab.
- `content.js` — thin orchestrator; wires the modules into one backup run.
- `src/extract.js` — **extraction**: all network I/O + throttling/pause/cancel;
  returns raw data only (deck objects, card DB, packs).
- `src/transform.js` — **transformation**: pure functions, raw data → each output
  format (Markdown, Text, OCTGN, HTML, index).
- `src/zip.js` — dependency-free ZIP writer.
- `src/ui.js` — the launcher button and progress panel.
- `icons/` — the Marvel Champions Codex icon.
- `docs/` — tech-stack reference and proposed-feature notes (not shipped in the
  extension zip).
