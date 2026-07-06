---
name: verify-generated-html
description: How to headlessly drive the extension's generated HTML (index.html, deck pages) to test JS behavior
metadata:
  type: reference
---

The repo is zero-dependency, so there is no test runner. To exercise the JS in generated
pages (e.g. `buildIndexHtml`'s search / sort / side-sheet), render the HTML with a Node
shim and drive it with `playwright-core` installed **in the scratchpad, never the repo**:

- Generate HTML: `global.window = {}; require('./src/transform.js')` then call
  `window.MCB.transform.buildIndexHtml(entries, opts)` and write it to a file.
- A Chromium is already cached for Playwright at
  `~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`
  (glob the version). Pass it as `executablePath` — `playwright install` is not needed.
- `chromium.launch({ executablePath })`, `page.goto('file://…')`, assert on `tbody tr`
  order/`dataset`, `#count`, `#sheet` state. Collect `console`/`pageerror` to catch runtime
  errors. See [[feature-index-page]] for what each control should do.
