# Feature: single-file offline viewer

**Status:** done in v1.5.0.

## Why

The backup ZIP unzips to a folder: `index.html`, `manifest.json`, and a `decks/` folder
with five files per deck. That is great on a desktop, but it does not travel. `index.html`
reaches its siblings by relative path (the per-format links and the side-sheet preview
iframe), so the moment you email just that file to yourself or move it on its own, every
link and preview breaks.

So alongside the folder we now write one more file, `marvelcdb-decks.html`, that has every
deck baked in. Email it to yourself or host it on a private server and it works fully
offline from that one file. The folder is still there for people who want the raw formats.

## What it does

- Same browsable table as `index.html` (Deck / Hero / Aspect / Tags / Updated),
  reverse-chronological by default, with search-as-you-type and sortable headers.
- Tapping a row opens the right-hand side sheet and shows that deck's full page. There are
  no sibling files, so instead of an iframe pointing at `decks/….html`, each deck's page
  HTML is embedded in an inline `DECKS` blob and shown via the iframe's `srcdoc`. That is
  `file://`-safe and keeps the deck page's own styles and its embedded-mode back-link
  hiding. The blob is JSON with every `<` escaped to `<`, so a deck's notes can never
  close the script tag.
- Light / dark / auto toggle in the corner, remembered in `localStorage`. When you flip it
  while a deck is open, the preview re-themes with it.
- Responsive, following the Material list/detail pattern. On a narrow screen (≤640px) the
  table restacks into a single-column list (deck name, then an aspect + hero + updated meta
  line; tags and file links fold away), and the side sheet becomes a fullscreen detail view
  with a back arrow instead of a right-hand panel. Same restack applies to `index.html`.
  This is pure CSS on the same markup, so search and sort keep working. Two lines of
  concatenated JS aside, nothing branches on screen size.

## How it is built

`buildViewerHtml(entries, deckHtmlById, opts)` in `src/transform.js`, wired into
`packageZip` in `content.js`. `buildOutputs` already renders each deck's page for the
`.html` file, so it hands those strings straight to the viewer instead of rendering twice.

## Shared with the other HTML outputs (v1.5.0)

Two changes landed across every HTML output, not just the viewer:

- **Theme.** One palette expressed as CSS custom properties, shared by the per-deck pages,
  the index, and the viewer. Light is the default, dark follows the OS via
  `prefers-color-scheme`, a `data-theme` attribute on `<html>` forces either one, and
  `@media print` forces the white, printer-friendly palette regardless.
- **Card markers.** Matching MarvelCDB's deck-view icon language: a small colored dot per
  aspect (leadership blue, justice yellow, aggression red, protection green, 'Pool magenta,
  basic dark grey) and a person icon for signature cards, keyed off `card.faction_code`
  (`hero` = signature). Aspect-vs-signature is a shape difference, so it reads without
  relying on color alone. A compact legend on the index and viewer explains it.

## Possible next steps

- The far-right resource icons (physical / mental / energy / wild) and the `•` unique
  bullet that MarvelCDB shows. The card data carries `resource_*` and `is_unique`, so these
  are additive.
