// extract.js — EXTRACTION: all network I/O and raw-data acquisition. Returns raw
// data only (deck objects, card DB, packs); it knows nothing about output formats.
// A Session owns the polite-throttling + pause/cancel state so the UI can drive it.
(function () {
  const MCB = (window.MCB = window.MCB || {});

  const CANCELLED = { __cancelled: true }; // sentinel thrown to unwind on cancel

  // Create a run session: the throttled HTTP client + flow control.
  // opts.onLog(msg, isErr) is called for back-off notices.
  function createSession(opts) {
    const onLog = (opts && opts.onLog) || (() => {});
    const MIN_DELAY = 600,
      MAX_DELAY = 8000;
    let reqDelay = MIN_DELAY;
    let paused = false,
      cancelled = false;
    let cancelWake = null;
    let pauseResolvers = [];
    let onPausedChange = null;

    const jittered = (ms) => ms * (0.85 + Math.random() * 0.3); // ±15%

    // Interruptible sleep: a cancel wakes it immediately (Cancel feels instant even
    // mid-backoff). Pause is handled at request boundaries via gate(), not here.
    const sleep = (ms) =>
      new Promise((res) => {
        const t = setTimeout(() => {
          cancelWake = null;
          res();
        }, ms);
        cancelWake = () => {
          clearTimeout(t);
          cancelWake = null;
          res();
        };
      });

    const waitWhilePaused = () =>
      paused ? new Promise((r) => pauseResolvers.push(r)) : Promise.resolve();

    // Checkpoint honored before every request: unwinds on cancel, holds while paused.
    async function gate() {
      if (cancelled) throw CANCELLED;
      if (paused) await waitWhilePaused();
      if (cancelled) throw CANCELLED;
    }

    function retryAfterMs(res) {
      const ra = res.headers.get('retry-after');
      if (!ra) return null;
      const secs = Number(ra);
      if (!Number.isNaN(secs)) return secs * 1000;
      const when = Date.parse(ra);
      return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
    }

    async function get(path) {
      await gate();
      for (let a = 0; a < 5; a++) {
        if (cancelled) throw CANCELLED;
        const r = await fetch(path, { credentials: 'same-origin' });
        if (r.status === 429 || r.status >= 500) {
          // Honor Retry-After if given, else exponential backoff, and permanently
          // slow the steady-state pace so we stop crowding the server.
          const wait = retryAfterMs(r) ?? Math.min(MAX_DELAY, 1000 * 2 ** a);
          reqDelay = Math.min(MAX_DELAY, Math.max(reqDelay * 1.5, 1200));
          onLog(
            'Server busy (HTTP ' +
              r.status +
              ') — waiting ' +
              Math.round(wait / 1000) +
              's, easing off',
          );
          await sleep(wait);
          if (cancelled) throw CANCELLED;
          continue;
        }
        if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
        return r.text();
      }
      throw new Error(path + ' → gave up after repeated errors');
    }

    // Polite pause between requests (jittered, adaptive).
    const pace = () => sleep(jittered(reqDelay));

    return {
      CANCELLED,
      get,
      pace,
      gate,
      isPaused: () => paused,
      isCancelled: () => cancelled,
      onPausedChange(fn) {
        onPausedChange = fn;
      },
      setPaused(p) {
        if (paused === p) return;
        paused = p;
        if (!p) {
          const rs = pauseResolvers;
          pauseResolvers = [];
          rs.forEach((f) => f());
        }
        if (onPausedChange) onPausedChange(p);
      },
      cancel() {
        cancelled = true;
        if (cancelWake) cancelWake(); // break any in-flight sleep now
        if (paused) this.setPaused(false); // release a paused gate so the loop unwinds
      },
    };
  }

  // Enumerate the user's personal deck IDs by paging through /decks/{page}.
  // Returns { ids (list order = dateUpdate DESC), pagesWithDecks, totalPages }.
  // onProgress({ page, totalPages, found }) is called after each page.
  async function enumerateDeckIds(session, onProgress) {
    const seen = new Set();
    const ordered = [];
    let totalPages = 1,
      pagesWithDecks = 0;
    for (let page = 1; page <= 300; page++) {
      const html = await session.get('/decks/' + page);
      for (const mm of html.matchAll(/\/decks\/(\d+)/g)) {
        const n = +mm[1];
        if (n > totalPages) totalPages = n;
      }
      const before = seen.size;
      for (const m of html.matchAll(/\/deck\/(?:view|edit)\/(\d+)/g)) {
        const n = +m[1];
        if (!seen.has(n)) {
          seen.add(n);
          ordered.push(n);
        }
      }
      if (seen.size === before) break; // a page with no new decks = past the end
      pagesWithDecks = page;
      if (page > totalPages) totalPages = page;
      if (onProgress) onProgress({ page, totalPages, found: seen.size });
      await session.pace();
    }
    return { ids: ordered, pagesWithDecks, totalPages };
  }

  // Bulk card database → Map(code → raw card). One request, reused for all decks.
  async function fetchCardMap(session) {
    const arr = JSON.parse(await session.get('/api/public/cards/?encounter=1'));
    return new Map(arr.map((c) => [String(c.code), c]));
  }

  // Pack list → Map(code → raw pack) for pack-position ordering in the Text export.
  async function fetchPackMap(session) {
    const arr = JSON.parse(await session.get('/api/public/packs/'));
    return new Map(arr.map((p) => [String(p.code), p]));
  }

  // Raw deck object from /deck/view/{id}: the inline app.deck.init({...}) payload
  // plus the app.deck_history.init([...]) revision history. Pure parse, no formats.
  function parseDeckHtml(html) {
    const m = html.match(/app\.deck\s*&&\s*app\.deck\.init\((\{[\s\S]*?\})\);\s*(?:\r|\n)/);
    if (!m) throw new Error('no embedded deck JSON');
    const deck = JSON.parse(m[1]);
    const h = html.match(/app\.deck_history\s*&&\s*app\.deck_history\.init\((\[[\s\S]*?\])\);/);
    if (h) {
      try {
        deck.history = JSON.parse(h[1]);
      } catch (e) {}
    }
    return deck;
  }

  async function fetchDeckRaw(session, id) {
    return parseDeckHtml(await session.get('/deck/view/' + id));
  }

  MCB.extract = {
    CANCELLED,
    createSession,
    enumerateDeckIds,
    fetchCardMap,
    fetchPackMap,
    fetchDeckRaw,
    parseDeckHtml,
  };
})();
