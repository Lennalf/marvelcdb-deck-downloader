#!/usr/bin/env bash
# Package the extension into a single distributable zip (runtime files only).
# Load it via chrome://extensions → Developer mode → "Load unpacked" (after unzip),
# or upload the zip to the Chrome Web Store for a one-click install.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/marvelcdb-deck-backup-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
# Ship only what the browser runs — no README, docs, build script, or dist/ itself.
zip -q -r "$OUT" manifest.json background.js content.js src icons -x '*/.*' 'icons/*.mjs'

echo "Built $OUT"
unzip -l "$OUT"
