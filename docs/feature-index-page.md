# Feature request: richer HTML index page

**Status:** partly implemented in v1.3.0. The table is now Deck / Hero / Aspect / Tags /
Updated with a link to each deck's page and to every raw format, and each row carries
`data-name/hero/aspect/tags` attributes so the search box below is a pure add-on. The
manifest entry was widened (`buildManifestEntry` in `src/transform.js`) to carry the data
these columns need, and the index is regenerated complete on every run (including
incremental top-ups). Still to do from this doc: the search-as-you-type filtering, the
side-sheet viewer, and sortable columns. When those land, the natural next step is the
"static `index.html` shell + a regenerated `decks-data.js` loaded via `<script>` (so it
works over `file://`)" split, which keeps the presentation stable while only the small
data file changes each run.

The original proposal follows. A basic `index.html` already ships. This describes the
upgrade.

## Goal

Make `index.html` the front door to a backup: a single self-contained page for
browsing, filtering, and previewing every deck and its files — no unzip-and-hunt.

## Requirements

- **One row per deck.** Columns:
  - Deck name (link to the HTML view)
  - Hero
  - Aspect(s)
  - Tags
  - Last updated
  - **One column per format** — JSON, MD, TXT, OCTGN, HTML — each a small
    link/icon to that deck's file (Material Symbols icon is fine).
- **Search-as-you-type (SAYT) filtering.** An always-visible box that filters rows
  live across name / hero / aspect / tags as the user types. Instant, client-side.
- **Integrated viewer.** Clicking a deck opens an in-page **side sheet** (right-hand
  panel) that previews the deck without leaving the index — render the deck's `.html`
  (or the parsed deck) inline, with quick links to each raw format. A side sheet is
  preferred over a modal so the list stays visible for fast scanning.
- **Sortable columns** (nice-to-have): click a header to sort by hero, updated, etc.

## Constraints

- **Self-contained.** No sibling CSS/JS files. Inline everything, OR pull from a
  **major CDN** — Tailwind (Play CDN) and Google **Material Symbols** are explicitly
  acceptable. Nothing that requires a build step at open time.
- Must open straight from the unzipped folder over `file://` (so viewer previews
  should use relative links; be mindful that `fetch()` of sibling files can be
  blocked under `file://` in some browsers — prefer `<iframe src="decks/….html">`
  for the side-sheet preview, or inline the needed data as a JSON blob in the page).
- Degrade gracefully with JS disabled: the table + links still work; SAYT/viewer are
  enhancements.

## Implementation sketch

- At backup time, `buildIndexHtml(entries)` already has every deck's metadata and
  file paths. Extend `entries` to carry `aspect`, `tags`, `updated`, and the file
  name per format, then emit:
  - a `<table>` with a `data-*`-annotated row per deck (for filtering/sorting),
  - an inline `<script>` for SAYT (filter rows on `input`) and the side-sheet
    (populate an `<aside>` with an `<iframe>` to `decks/{id}-{slug}.html` on row click),
  - inline `<style>` (or Tailwind Play CDN) for layout + the sliding side sheet.
- Consider embedding a compact `decks` JSON array in the page so sorting/filtering
  doesn't depend on scraping the DOM.

## Open questions

- Bundle the deck data inline (bigger `index.html`, but `file://`-safe previews) vs.
  `<iframe>` the per-deck HTML (smaller page, relies on relative file access)?
- Should the viewer show the raw Markdown notes, the rendered HTML, or a toggle?
