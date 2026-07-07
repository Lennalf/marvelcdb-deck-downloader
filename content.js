// content.js — orchestrator. Wires the modules (extract → transform → zip, with
// ui for progress) into one backup run. All the logic lives in src/*.js; this file
// is just glue: it owns no format code and no network code of its own. The one bit
// of state it does own is the cross-run deck cache — see below.
(function () {
  if (window.__mcbInjected) return;
  window.__mcbInjected = true;

  const { zip, transform, extract, ui } = window.MCB;
  const enc = zip.enc;

  // Cross-run cache. The cache is the *incremental* part: it stores each deck's raw
  // object (the .json source of truth, history and all) so a run only has to
  // re-download the decks that changed. The ZIP itself is ALWAYS a full, self-
  // contained backup — every deck's five files are regenerated every run, from a
  // freshly fetched raw deck if it changed or the cached one if it didn't. So the
  // user never has to unzip a top-up "over" an old folder.
  //
  // We use IndexedDB, not localStorage: raw decks can be several MB across a big
  // collection, well past localStorage's ~5MB (which we'd also be sharing with
  // MarvelCDB's own data). The cache is a cache, never a source of truth: if it is
  // missing or unreadable, the run just does a full backup and rebuilds it, and a
  // lost cache can never corrupt the ZIP the user already has. Keyed by MarvelCDB
  // user id so a shared computer login can't cross-contaminate accounts.
  //   key backup:{userId} → { lastBackupAt, decks: { [id]: rawDeck } }
  const CACHE_PREFIX = 'backup:';
  const kv = window.MCB.kv || makeIdbKv();
  function makeIdbKv() {
    const DB = 'mcb',
      STORE = 'backups';
    // Open once and reuse the connection for every op. On failure we clear the
    // cached promise so a later call can retry a fresh open.
    let dbPromise = null;
    const open = () => {
      if (!dbPromise) {
        dbPromise = new Promise((res, rej) => {
          const r = indexedDB.open(DB, 1);
          r.onupgradeneeded = () => {
            if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }).catch((e) => {
          dbPromise = null;
          throw e;
        });
      }
      return dbPromise;
    };
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      get: (k) => run('readonly', (os) => os.get(k)).then((v) => (v == null ? null : v)).catch(() => null),
      set: (k, v) => run('readwrite', (os) => os.put(v, k)).then(() => true).catch(() => false),
      del: (k) => run('readwrite', (os) => os.delete(k)).then(() => true).catch(() => false),
    };
  }
  async function readCache(userId) {
    const obj = await kv.get(CACHE_PREFIX + userId);
    return obj && obj.decks ? obj : null;
  }
  const writeCache = (userId, obj) => kv.set(CACHE_PREFIX + userId, obj);

  // The logged-in MarvelCDB user id, read from the site's OWN cache. app.user.js
  // stores the current user (id, name, …) under localStorage['user']; we share the
  // origin, so this is free and instant. We only ever READ it. Null when unknown
  // (logged out, or the site hasn't cached it yet) — the run then falls back to the
  // user id on the first fetched deck.
  function getSiteUserId() {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      return u && u.id != null ? u.id : null;
    } catch (e) {
      return null;
    }
  }

  let running = false;

  const launcher = ui.makeLauncher(run, clearCache);
  // Reveal the "Clear cached decks" control if this account already has a cache.
  (async () => {
    try {
      const su = getSiteUserId();
      if (su != null && (await readCache(su))) launcher.showClear();
    } catch (e) {}
  })();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg === 'mcb-start-backup') run();
  });

  async function clearCache() {
    const su = getSiteUserId();
    const yes = await ui.confirmModal({
      title: 'Clear cached decks?',
      text:
        'Your decks are cached locally. Only new and changed decks will be downloaded, ' +
        'which saves time and reduces load on the MarvelCDB website. Clearing the cache is ' +
        'only recommended if you are experiencing issues. Do you want to clear the cache?',
      cancelLabel: 'Cancel',
      confirmLabel: 'Clear',
    });
    if (!yes) return;
    if (su != null) await kv.del(CACHE_PREFIX + su);
    launcher.hideClear();
  }

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

    const runStart = new Date().toISOString();

    // Identify the account up front so we load the right cache before downloading.
    const siteUser = getSiteUserId();
    let cache = siteUser != null ? await readCache(siteUser) : null;
    const incremental = !!(cache && cache.decks && Object.keys(cache.decks).length);

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
    if (incremental) {
      panel.setLabels(
        Object.keys(cache.decks).length + ' decks cached · checking for updates',
        'Downloading new and updated decks',
      );
    }

    // Run state lives out here so a cancel can still package what was collected and
    // commit progress to the cache.
    const freshRaw = {}; // id → raw deck fetched THIS run
    let enumIds = new Set(); // every deck id the account currently has
    let ctx = null; // card/pack context for the transforms (set after bulk fetch)
    let actualUserId = null; // user id from the first fetched deck (authoritative)
    let ok = 0,
      fail = 0;

    // The raw deck to use for a given id: freshly fetched if we got it this run, else
    // the cached copy (whose data is complete and unchanged). This is what makes the
    // ZIP a full backup regardless of how few decks we actually downloaded.
    const rawFor = (id) => freshRaw[id] || (cache && cache.decks && cache.decks[id]) || null;
    const allRaw = () => {
      const m = {};
      for (const id of enumIds) {
        const d = rawFor(id);
        if (d) m[id] = d; // a new deck that failed to fetch has no raw source; skip it
      }
      return m;
    };

    // Persist progress to the cache. Safe to call on a clean finish OR on cancel/
    // error: because each deck carries its own stamp, any deck we didn't refresh this
    // run keeps its old stamp and is re-detected next run — so a cancelled backup
    // resumes instead of starting over. Guarded so an interrupted enumeration (empty
    // set, nothing to merge) can never clobber a good cache.
    const commitCache = async () => {
      const keyUser = actualUserId != null ? actualUserId : siteUser;
      const raw = allRaw();
      if (keyUser == null || !Object.keys(raw).length) return true;
      const saved = await writeCache(keyUser, { lastBackupAt: runStart, decks: raw });
      if (saved) launcher.showClear();
      return saved;
    };

    // Regenerate every deck's five files + manifest entry from its raw object. Runs
    // fresh at package time so the ZIP always reflects the full current set.
    const buildOutputs = () => {
      const files = [];
      const manifest = [];
      // Keep each deck's rendered page around so the single-file viewer can embed it
      // without rendering every deck a second time.
      const deckHtmlById = {};
      if (!ctx) return { files, manifest, deckHtmlById };
      for (const id of [...enumIds].sort((a, b) => a - b)) {
        const deck = rawFor(id);
        if (!deck) continue;
        const base = 'decks/' + id + '-' + transform.slugify(deck.name);
        const deckHtml = transform.buildDeckHtml(deck, ctx);
        files.push({ name: base + '.json', data: enc(JSON.stringify(deck, null, 2)) });
        files.push({ name: base + '.md', data: enc(transform.buildMarkdown(deck)) });
        files.push({ name: base + '.txt', data: enc(transform.buildText(deck, ctx)) });
        files.push({ name: base + '.o8d', data: enc(transform.buildOctgn(deck, ctx)) });
        files.push({ name: base + '.html', data: enc(deckHtml) });
        deckHtmlById[id] = deckHtml;
        manifest.push(transform.buildManifestEntry(deck, base));
      }
      return { files, manifest, deckHtmlById };
    };
    const packageZip = () => {
      const { files, manifest, deckHtmlById } = buildOutputs();
      files.push({
        name: 'index.html',
        data: enc(transform.buildIndexHtml(manifest, { backedUpAt: runStart })),
      });
      // One portable file with every deck inlined, for phones or emailing to yourself.
      files.push({
        name: 'marvelcdb-decks.html',
        data: enc(transform.buildViewerHtml(manifest, deckHtmlById, { backedUpAt: runStart })),
      });
      files.push({ name: 'manifest.json', data: enc(JSON.stringify(manifest, null, 2)) });
      return zip.makeZip(files);
    };
    const rebuild = () => triggerDownload(packageZip());

    try {
      // 1. enumerate decks + their last-updated stamps (both come from the cheap
      //    list HTML). We page the whole list so deletions and the full backup are
      //    covered, not just the changed decks.
      panel.discover({ page: 0, totalPages: 0, found: 0 });
      const { decks, pagesWithDecks } = await extract.enumerateDecks(session, (p) =>
        panel.discover(p),
      );
      enumIds = new Set(decks.map((d) => d.id));
      if (!decks.length) {
        panel.finalize('empty');
        return;
      }
      panel.discoverDone(decks.length, pagesWithDecks);

      // 1b. Diff against the cache to decide what to download. Fetch a deck when it is
      //     new, its stamp differs from the cached one, or its stamp is unknown (be
      //     safe). Compared as timestamps, so format quirks don't matter.
      const cachedDecks = (cache && cache.decks) || {};
      const toFetch = decks
        .filter((d) => {
          const c = cachedDecks[d.id];
          if (!c) return true;
          if (!d.dateUpdate || !c.date_update) return true;
          return Date.parse(d.dateUpdate) !== Date.parse(c.date_update);
        })
        .map((d) => d.id);
      if (incremental) {
        panel.log(
          toFetch.length +
            ' new or updated · ' +
            (decks.length - toFetch.length) +
            ' unchanged (reused from cache)',
        );
      }

      // 1c. bulk reference data (once): card DB + pack list power every transform.
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
      ctx = { cardMap, packMap, specialsBySet };

      // 2. download only the new/updated decks (the unchanged ones come from cache).
      panel.beginDownload(toFetch.length);
      if (!toFetch.length) panel.log('Everything is already up to date.');
      for (let i = 0; i < toFetch.length; i++) {
        const id = toFetch[i];
        let name = 'deck ' + id;
        try {
          const deck = await extract.fetchDeckRaw(session, id);
          name = deck.name || name;

          // The first real deck confirms the account. If the site's cached user id
          // was stale (someone switched accounts), reload the RIGHT account's cache
          // so we never mix two people's decks.
          if (actualUserId == null) {
            actualUserId = deck.user_id;
            if (String(actualUserId) !== String(siteUser)) cache = await readCache(actualUserId);
          }

          freshRaw[id] = deck;
          ok++;
        } catch (e) {
          if (e === extract.CANCELLED) throw e;
          fail++;
          panel.log('✕ deck ' + id + ' failed: ' + e.message, true);
        }
        panel.download({ index: i + 1, total: toFetch.length, name, fail });
        await session.pace();
      }

      // 3. zip + download — a COMPLETE backup of every deck, every run.
      triggerDownload(packageZip());

      // 4. Commit progress to the cache.
      const saved = await commitCache();
      if (!saved) {
        panel.log('Could not save the deck cache — the next run will re-download everything.', true);
      }

      const total = Object.keys(allRaw()).length;
      panel.finalize('done', {
        ok,
        fail,
        rebuild,
        mode: incremental ? 'incremental' : 'full',
        changed: ok,
        reused: total - ok,
        total,
      });
    } catch (e) {
      // Commit whatever we fetched before the interruption so the next run resumes
      // from here instead of starting over (the per-deck stamp diff re-detects the
      // rest). The guard in commitCache protects a good cache if enumeration itself
      // was interrupted.
      await commitCache();
      if (e === extract.CANCELLED) {
        // Package what we have — thanks to the cache this is still a full backup of
        // every deck.
        const collected = Object.keys(allRaw()).length;
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
