// content.js — orchestrator. Wires the modules (extract → transform → zip, with
// ui for progress) into one backup run. All the logic lives in src/*.js; this file
// is just glue: it owns no format code and no network code of its own. The one bit
// of state it does own is the cross-run backup cache in localStorage — see below.
(function () {
  if (window.__mcbInjected) return;
  window.__mcbInjected = true;

  const { zip, transform, extract, ui } = window.MCB;
  const enc = zip.enc;

  // Cross-run memory for incremental backups. localStorage is per-origin
  // (marvelcdb.com), needs no extra permission from a content script, and never
  // leaves the browser. We treat it as a CACHE, never a source of truth: if it is
  // missing or unreadable, the run simply falls back to a full backup and rebuilds
  // it. A lost cache can never corrupt the ZIP the user already has on disk.
  //   mcb:lastUser        → the user_id of the most recent backup on this browser
  //   mcb:backup:{userId} → { lastBackupAt, decks: { [id]: manifestEntry } }
  const CACHE_PREFIX = 'mcb:backup:';
  const LAST_USER_KEY = 'mcb:lastUser';
  function readCache(userId) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + userId);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && obj.decks ? obj : null;
    } catch (e) {
      return null;
    }
  }
  function writeCache(userId, obj) {
    try {
      localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(obj));
      localStorage.setItem(LAST_USER_KEY, String(userId));
    } catch (e) {
      // Private mode / quota / disabled storage: skip. Next run self-heals.
    }
  }
  function readLastUser() {
    try {
      return localStorage.getItem(LAST_USER_KEY);
    } catch (e) {
      return null;
    }
  }

  let running = false;

  const launcher = ui.makeLauncher(run);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg === 'mcb-start-backup') run();
  });

  function triggerDownload(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marvelcdb-decks-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  async function run() {
    if (running) return;
    running = true;
    launcher.hide();

    let panel = null;
    const session = extract.createSession({ onLog: (m, e) => panel && panel.log(m, e) });
    session.onPausedChange((p) => panel && panel.setPaused(p));

    // The cutoff we store is the moment this run STARTED (before enumeration), not
    // "now" at the end. Any deck edited mid-run then has date_update > cutoff, so the
    // next incremental re-fetches it instead of trusting a stale copy.
    const runStart = new Date().toISOString();

    // Decide full vs incremental up front from the most recent backup on this
    // browser. The user is almost always the same account here; if the first deck we
    // fetch says otherwise, we reconcile below before trusting the cutoff.
    const lastUser = readLastUser();
    let cache = lastUser ? readCache(lastUser) : null;
    let mode = 'full';
    let cutoff = null;
    if (cache && cache.lastBackupAt) {
      const choice = await ui.chooseMode({ lastBackupAt: cache.lastBackupAt });
      mode = choice.mode;
      if (mode === 'incremental') cutoff = cache.lastBackupAt;
    }

    const handlers = {
      onPauseToggle: () => session.setPaused(!session.isPaused()),
      onCancel: () => session.cancel(),
      onClose: () => {
        if (running) session.cancel();
        if (panel) panel.remove();
        launcher.show();
      },
    };
    panel = ui.makePanel(handlers);

    // Run state lives out here so a cancel can still package what was collected.
    const files = []; // ZIP file entries for decks fetched THIS run
    const fresh = {}; // id → manifest entry, fetched this run
    let enumIds = new Set(); // every deck id the account currently has
    let ok = 0,
      fail = 0;

    // The COMPLETE manifest for the index/ZIP: every enumerated deck, preferring a
    // freshly-fetched entry, falling back to the cached one (whose files are already
    // on the user's disk from a prior backup). Cached decks no longer enumerated are
    // dropped, so deletions on the site are reflected.
    const buildMerged = () => {
      const m = {};
      const cached = (cache && cache.decks) || {};
      for (const id of enumIds) {
        if (fresh[id]) m[id] = fresh[id];
        else if (cached[id]) m[id] = cached[id];
      }
      return m;
    };
    const entriesArray = () => Object.values(buildMerged()).sort((a, b) => a.id - b.id);
    const packageZip = () => {
      const f = files.slice();
      f.push({
        name: 'index.html',
        data: enc(
          transform.buildIndexHtml(entriesArray(), {
            incremental: mode === 'incremental',
            backedUpAt: runStart,
          }),
        ),
      });
      f.push({ name: 'manifest.json', data: enc(JSON.stringify(entriesArray(), null, 2)) });
      return zip.makeZip(f);
    };
    const rebuild = () => triggerDownload(packageZip());

    try {
      // 1. enumerate deck IDs — keep list order (dateUpdate DESC). The incremental
      //    early-stop below relies on it, so do NOT re-sort numerically here.
      panel.discover({ page: 0, totalPages: 0, found: 0 });
      const { ids, pagesWithDecks } = await extract.enumerateDeckIds(session, (p) =>
        panel.discover(p),
      );
      const enumOrder = ids.slice();
      enumIds = new Set(enumOrder);
      if (!enumOrder.length) {
        panel.finalize('empty');
        return;
      }
      panel.discoverDone(enumOrder.length, pagesWithDecks);

      // 1b. bulk reference data (once): card DB + pack list power every transform.
      let cardMap = null,
        packMap = null,
        specialsBySet = null;
      panel.log('Loading card names…');
      try {
        cardMap = await extract.fetchCardMap(session);
        specialsBySet = transform.indexSpecials(cardMap);
        panel.log('Loaded ' + cardMap.size + ' card names.');
      } catch (e) {
        if (e === extract.CANCELLED) throw e;
        panel.log(
          'Could not load card names (' + e.message + ') — Text/OCTGN/HTML will use card codes.',
          true,
        );
      }
      await session.pace();
      try {
        packMap = await extract.fetchPackMap(session);
      } catch (e) {
        if (e === extract.CANCELLED) throw e;
        panel.log(
          'Could not load pack list (' + e.message + ') — Text pack line may be approximate.',
          true,
        );
      }
      await session.pace();
      const ctx = { cardMap, packMap, specialsBySet };

      // Fetch → transform one deck into all five formats + its manifest entry.
      const writeDeck = (deck) => {
        const base = 'decks/' + deck.id + '-' + transform.slugify(deck.name);
        files.push({ name: base + '.json', data: enc(JSON.stringify(deck, null, 2)) });
        files.push({ name: base + '.md', data: enc(transform.buildMarkdown(deck)) });
        files.push({ name: base + '.txt', data: enc(transform.buildText(deck, ctx)) });
        files.push({ name: base + '.o8d', data: enc(transform.buildOctgn(deck, ctx)) });
        files.push({ name: base + '.html', data: enc(transform.buildDeckHtml(deck, ctx)) });
        fresh[deck.id] = transform.buildManifestEntry(deck, base);
      };

      // 2. per-deck: fetch raw, then transform. In incremental mode, decks come
      //    newest-first, so we stop at the first one older than the cutoff.
      let actualUserId = null;
      const attempted = new Set(); // ids the main loop actually tried to fetch
      panel.beginDownload(enumOrder.length);
      for (let i = 0; i < enumOrder.length; i++) {
        const id = enumOrder[i];
        let name = 'deck ' + id;
        attempted.add(id);
        try {
          const deck = await extract.fetchDeckRaw(session, id);
          name = deck.name || name;

          // First real deck tells us the true account. If it isn't the one whose
          // cache we loaded, switch to the right cache (and drop the cutoff if that
          // account has no prior backup) before trusting anything.
          if (actualUserId == null) {
            actualUserId = deck.user_id;
            if (String(actualUserId) !== String(lastUser)) {
              cache = readCache(actualUserId);
              if (mode === 'incremental') {
                if (cache && cache.lastBackupAt) cutoff = cache.lastBackupAt;
                else {
                  mode = 'full';
                  cutoff = null;
                }
              }
            }
          }

          if (mode === 'incremental' && cutoff) {
            const dMs = Date.parse(deck.date_update);
            const cMs = Date.parse(cutoff);
            // Older than the last backup → so is everything after it. Stop. (This
            // boundary deck is unchanged, so we don't write it; its files are on disk.)
            if (!Number.isNaN(dMs) && !Number.isNaN(cMs) && dMs < cMs) break;
          }

          writeDeck(deck);
          ok++;
        } catch (e) {
          if (e === extract.CANCELLED) throw e;
          fail++;
          panel.log('✕ deck ' + id + ' failed: ' + e.message, true);
        }
        panel.download({ index: i + 1, total: enumOrder.length, name, fail });
        await session.pace();
      }

      // 2b. Self-heal: an enumerated deck the early-stop skipped that also isn't in
      //     the cache (a partial/cleared cache) gets fetched now so the index stays
      //     complete. Decks the loop already tried are excluded, so a genuine fetch
      //     failure is reported once, not retried here.
      const cachedDecks = (cache && cache.decks) || {};
      const gaps = [...enumIds].filter((id) => !attempted.has(id) && !cachedDecks[id]);
      if (gaps.length) {
        panel.log(
          'Fetching ' + gaps.length + ' deck' + (gaps.length === 1 ? '' : 's') + ' the cache was missing…',
        );
        for (const id of gaps) {
          try {
            writeDeck(await extract.fetchDeckRaw(session, id));
            ok++;
          } catch (e) {
            if (e === extract.CANCELLED) throw e;
            fail++;
            panel.log('✕ deck ' + id + ' failed: ' + e.message, true);
          }
          await session.pace();
        }
      }

      // 3. zip + download (adds a COMPLETE index.html + manifest.json every run).
      triggerDownload(packageZip());

      // 4. Commit the cache — only on a clean finish. Advance the cutoff only if
      //    nothing failed, so a changed-but-failed deck is retried next time rather
      //    than silently skipped.
      if (actualUserId != null) {
        const lastBackupAt = fail === 0 ? runStart : (cache && cache.lastBackupAt) || null;
        writeCache(actualUserId, { lastBackupAt, decks: buildMerged() });
      }

      const total = Object.keys(buildMerged()).length;
      panel.finalize('done', { ok, fail, rebuild, mode, changed: ok, reused: total - ok });
    } catch (e) {
      if (e === extract.CANCELLED) {
        // Package what we have (index still lists cached decks too), but write no
        // cache — a cancelled run must not advance the cutoff.
        const collected = Object.keys(buildMerged()).length;
        panel.finalize('cancelled', collected > 0 ? { collected, rebuild } : {});
      } else {
        panel.log('Error: ' + e.message, true);
        panel.finalize('error', { message: e.message });
      }
    } finally {
      running = false;
    }
  }
})();
