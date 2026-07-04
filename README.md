# MarvelCDB Deck Downloader (Chromium extension)

Back up **all your MarvelCDB decks** in one ZIP: cards, metadata, and the Markdown
write-up that the Text and OCTGN downloads leave out. It works on your unpublished
decks too. Everything runs in your browser, and nothing is uploaded anywhere.

## Why an extension (and not a plain web page)

Reading your personal decks needs your logged-in session. MarvelCDB doesn't send
cross-origin (CORS) headers, so a normal page on another site isn't allowed to fetch
them. This extension's content script runs **on marvelcdb.com itself**, where your
session just works and there's no CORS wall in the way. It only ever reads your own
decks.

## Install

You add this to your browser yourself. It takes a couple of minutes, and you only do it
once. These steps are for Chrome, and they work the same in Brave, Edge, or any other
Chromium browser. No coding required, and you don't need a GitHub account.

### Step 1: Download the files

1. Near the top of this page, find the green **`< > Code`** button and click it.
2. In the small menu that opens, click **Download ZIP**.
3. Your browser saves a file named `marvelcdb-deck-downloader-main.zip`, usually into
   your **Downloads** folder.

### Step 2: Unzip the folder

The file you downloaded is a compressed "ZIP" folder, and the browser can't use it until
you unpack it.

- **Windows:** right-click the file, choose **Extract All**, then click **Extract**.
- **Mac:** double-click the file.

You'll now have a normal folder called `marvelcdb-deck-downloader-main`. Move it
somewhere safe that you won't clean out later, like your Documents folder. The extension
runs straight from this folder, so if you delete it, the extension stops working.

### Step 3: Add it to Chrome

1. Open a new tab, type `chrome://extensions` into the address bar, and press Enter.
2. Turn on **Developer mode** with the switch in the top-right corner.
3. Click the **Load unpacked** button that appears at the top-left.
4. Select the `marvelcdb-deck-downloader-main` folder you unzipped, then click **Select
   Folder** (Windows) or **Open** (Mac).

That's it. You'll see "MarvelCDB Deck Downloader" in your list of extensions. If you'd
like its icon in the toolbar, click the puzzle-piece button in Chrome and pin it.

Everything runs on your own computer. The extension has no server and sends nothing
anywhere.

## Use

1. Open [marvelcdb.com](https://marvelcdb.com) and make sure you're **logged in**.
2. Either click the toolbar icon or the floating **Download my decks** button
   (bottom-right of any marvelcdb.com page).
3. A progress panel appears with two stages:
   - **Discovering decks:** it pages through your deck list to build the full set of
     IDs, showing "list page N of X" and a running deck count.
   - **Downloading decks:** it fetches each deck, showing "deck Y of Z: {name}" and a
     progress bar, plus a running count of any that failed. You can **Pause/Resume** or
     **Cancel** at any point. If you cancel partway through, it offers to save the decks
     collected so far. When it finishes, `marvelcdb-decks-backup-YYYY-MM-DD.zip`
     downloads. An **Activity log** (collapsed by default) records any per-deck errors
     and server back-off notices.

## What's in the ZIP

Five formats per deck, all built from the one raw JSON (see `docs/tech-stack.md`):

- `decks/{id}-{name}.json`: the complete **raw** deck object (cards, meta, tags,
  write-up) plus its full revision history (`history`: every saved version with its
  card list and timestamp). This is the source of truth, and every other format is
  generated from it.
- `decks/{id}-{name}.md`: YAML front-matter plus your Markdown write-up, for reading.
- `decks/{id}-{name}.txt`: plain-text decklist matching MarvelCDB's **Text** download.
- `decks/{id}-{name}.o8d`: **OCTGN** deck file matching MarvelCDB's OCTGN download.
- `decks/{id}-{name}.html`: a standalone, print-friendly page that reproduces the
  MarvelCDB deck view. Decklist on the left (grouped by type, with quantities and card
  **subtitles** so you can tell apart cards that share a name, like the two Spider-Man
  allies), notes on the right, plus the hero's nemesis "Hero set". Card names link to
  marvelcdb.com. It needs no styling or images, so you can print it and build the deck
  from paper. Card names come from MarvelCDB's public card database, fetched once per
  run.
- `index.html`: a browsable table of every deck in the backup, linking to each page.
  Open this first.
- `manifest.json`: a machine-readable index of every deck backed up.

This is everything MarvelCDB exposes for a personal deck. A few things aren't included
because they aren't part of the private deck record: `previous_deck`/`next_deck`/`xp`
(left out by the site's serializer, and unused for Marvel Champions), published-version
copies (`children`, which are separate public decklists available via the public API),
full card text and images (you can derive these from the card database), and
comments/likes (which only exist on _published_ decklists).

Re-run it any time. It always pulls a fresh, complete set.

## Being a good guest (throttling)

The backup is deliberately gentle on marvelcdb.com:

- **One request at a time** (no parallel fetching), spaced about 0.6s apart with a
  little random jitter, so roughly 1.5 requests a second.
- **Honors `Retry-After`** and backs off exponentially on any `429`/`5xx`, then stays
  slower for the rest of the run so it never crowds the server.
- Requests go out as normal first-party calls from your logged-in session, the same
  thing the site's own pages do, so there's nothing unusual for the server to absorb.

A few hundred decks take roughly 3 to 5 minutes. If you'd like it slower still, raise
`MIN_DELAY` near the top of `content.js`.

## How it works

- It enumerates your deck IDs by paging through `/decks/{page}` (using your session
  cookie, which is sent automatically because the content script is same-origin). The
  pagination links on those pages give the total page count, which drives the discovery
  progress bar.
- It loads the public card database **once** (`/api/public/cards/?encounter=1`) and the
  pack list once (`/api/public/packs/`), the same endpoints MarvelCDB's own front-end
  uses, to resolve card codes to names/subtitles/types and to order packs. One bulk
  fetch each, never per-card or per-deck.
- For each deck, it fetches `/deck/view/{id}` and extracts the deck object that
  marvelcdb embeds inline as `app.deck.init({...})`. That's where `description_md`
  lives, along with the `app.deck_history.init([...])` revision history.
- It turns that raw deck into `.md`, `.txt` (matching the site's Text export), `.o8d`
  (matching the OCTGN export), and `.html`, writes the raw `.json`, adds a top-level
  `index.html`, and packs everything into a ZIP with a small built-in store-only ZIP
  writer (no external libraries). See `docs/tech-stack.md` for why Text and OCTGN are
  rebuilt rather than fetched from the (login-gated, per-deck) export endpoints.

## Files

Extraction and transformation live in separate modules (see `docs/tech-stack.md`):

- `manifest.json`: MV3 manifest.
- `background.js`: routes the toolbar-icon click to the active marvelcdb tab.
- `content.js`: thin orchestrator that wires the modules into one backup run.
- `src/extract.js`: **extraction**, meaning all network I/O plus throttling/pause/cancel.
  It returns raw data only (deck objects, card DB, packs).
- `src/transform.js`: **transformation**, pure functions that turn raw data into each
  output format (Markdown, Text, OCTGN, HTML, index).
- `src/zip.js`: dependency-free ZIP writer.
- `src/ui.js`: the launcher button and progress panel.
- `icons/`: the Marvel Champions Codex icon.
- `docs/`: tech-stack reference and proposed-feature notes (not shipped in the
  extension zip).
