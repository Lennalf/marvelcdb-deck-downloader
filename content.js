// content.js — orchestrator. Wires the modules (extract → transform → zip, with
// ui for progress) into one backup run. All the logic lives in src/*.js; this file
// is just glue: it owns no format code and no network code of its own.
(function () {
  if (window.__mcbInjected) return;
  window.__mcbInjected = true;

  const { zip, transform, extract, ui } = window.MCB;
  const enc = zip.enc;

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

    let panel;
    const session = extract.createSession({ onLog: (m, e) => panel && panel.log(m, e) });
    session.onPausedChange((p) => panel && panel.setPaused(p));

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

    // Files/manifest live out here so a cancel can still package what was collected.
    const files = [],
      manifest = [];
    let ok = 0,
      fail = 0;
    const packageZip = () => {
      const f = files.slice();
      f.push({ name: 'index.html', data: enc(transform.buildIndexHtml(manifest)) });
      f.push({ name: 'manifest.json', data: enc(JSON.stringify(manifest, null, 2)) });
      return zip.makeZip(f);
    };
    const rebuild = () => triggerDownload(packageZip());

    try {
      // 1. enumerate deck IDs
      panel.discover({ page: 0, totalPages: 0, found: 0 });
      const { ids, pagesWithDecks } = await extract.enumerateDeckIds(session, (p) =>
        panel.discover(p),
      );
      const list = ids.slice().sort((a, b) => a - b); // deterministic file order
      if (!list.length) {
        panel.finalize('empty');
        return;
      }
      panel.discoverDone(list.length, pagesWithDecks);

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

      // 2. per-deck: fetch raw, then transform into all five formats.
      panel.beginDownload(list.length);
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        let name = 'deck ' + id;
        try {
          const deck = await extract.fetchDeckRaw(session, id);
          name = deck.name || name;
          const base = 'decks/' + id + '-' + transform.slugify(deck.name);
          files.push({ name: base + '.json', data: enc(JSON.stringify(deck, null, 2)) });
          files.push({ name: base + '.md', data: enc(transform.buildMarkdown(deck)) });
          files.push({ name: base + '.txt', data: enc(transform.buildText(deck, ctx)) });
          files.push({ name: base + '.o8d', data: enc(transform.buildOctgn(deck, ctx)) });
          files.push({ name: base + '.html', data: enc(transform.buildDeckHtml(deck, ctx)) });
          manifest.push({
            id: deck.id,
            name: deck.name,
            hero: deck.hero_name,
            tags: deck.tags || '',
            has_writeup: !!(deck.description_md || '').trim(),
            file: base + '.html',
            url: 'https://marvelcdb.com/deck/view/' + id,
          });
          ok++;
        } catch (e) {
          if (e === extract.CANCELLED) throw e;
          fail++;
          panel.log('✕ deck ' + id + ' failed: ' + e.message, true);
        }
        panel.download({ index: i + 1, total: list.length, name, fail });
        await session.pace();
      }

      // 3. zip + download (adds index.html + manifest.json)
      triggerDownload(packageZip());
      panel.finalize('done', { ok, fail, rebuild });
    } catch (e) {
      if (e === extract.CANCELLED) {
        const collected = manifest.length;
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
