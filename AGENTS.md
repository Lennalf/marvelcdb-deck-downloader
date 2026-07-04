# AGENTS.md

Guidance for AI agents (and humans) working in this repo. Keep it short; keep it true.

## What this is

A Chromium (MV3) browser extension that backs up a user's MarvelCDB decks — raw
JSON, Markdown write-up, Text, OCTGN, and a print-friendly HTML — as one ZIP.
Everything runs in the browser on marvelcdb.com; nothing is uploaded. Read
[README.md](README.md) for the user-facing story and [docs/tech-stack.md](docs/tech-stack.md)
for the data flow.

## The one hard rule: zero dependencies

No npm packages, no CDN scripts, no build toolchain. The repo *is* the extension —
"Load unpacked" on this folder must just work. This keeps install trivial and the
attack surface tiny. If you reach for a library (ZIP, Markdown, etc.), write it small
and vendor it into `src/` instead. `build.sh` only zips existing files.

## Layout

- `manifest.json` — MV3 manifest. Bump `version` when shipping.
- `background.js` — routes the toolbar click to the active marvelcdb tab.
- `content.js` — thin orchestrator; wires the modules together.
- `src/extract.js` — **extraction**: all network I/O + throttling/pause/cancel. Raw data only.
- `src/transform.js` — **transformation**: pure functions, raw data → each output format.
- `src/zip.js` — dependency-free ZIP writer.
- `src/ui.js` — launcher button + progress panel.
- Keep extraction (I/O) and transformation (pure) separate — don't fetch inside a transform.

## Code style

- Vanilla ES, no modules/bundler. Each `src/` file is an IIFE that hangs its exports
  off `window.MCB` (`const MCB = (window.MCB = window.MCB || {})`). Load order is set
  in `manifest.json` `content_scripts.js`.
- 2-space indent, semicolons, `const`/`let`, arrow functions, single quotes.
- Comment the *why*, not the *what*. Match the surrounding density.

## Voice of user-facing text

Anything a user reads — the README and every string in the extension UI — should
sound like a warm, plain-spoken human designer wrote it, not an AI. Concretely:

- No em dashes. Use a period, comma, parentheses, or "and" instead.
- No AI-tell jargon or filler: "load-bearing", "delve", "seamless", "leverage",
  "robust", "it's worth noting", "in the world of…". Say the plain thing.
- Short, friendly sentences. Speak to the reader as "you". Explain the *why* when it
  helps trust (e.g. "nothing leaves your browser"), but don't lecture.
- Code comments and these governance docs are exempt — this rule is about text users see.
- Be a good guest to marvelcdb.com: single-flight requests, throttled, honor
  `Retry-After`. Never add parallel fetching. See the throttling notes in README.

## Workflow

- **Test:** `brave://extensions` (or `chrome://extensions`) → Developer mode → Load
  unpacked → this folder. Reload the extension after edits, then reload a marvelcdb tab.
- **Package:** `./build.sh` → `dist/…zip` (runtime files only; `dist/` is gitignored).
- **Commit/push only when asked.** Bump `manifest.json` version for shipped changes.

## Governance: where things live

- `docs/` — for **humans**: reference material and feature proposals. Not shipped in
  the extension zip.
- `memory/` — for **AI**: working notes and plans. Not shipped either.
