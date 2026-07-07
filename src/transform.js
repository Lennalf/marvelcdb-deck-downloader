// transform.js — PURE transformations: raw deck data → output formats.
// No network, no DOM, no globals beyond the MCB namespace. Every function takes
// the raw deck object plus a shared context (cardMap, packMap, specialsBySet) and
// returns a string. Ported/adapted from the MarvelCDB source (reference/marvelsdb).
(function () {
  const MCB = (window.MCB = window.MCB || {});

  // ── shared helpers ───────────────────────────────────────────────────────────
  const slugify = (n) =>
    (n || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled';

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const xmlEsc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const yaml = (v) => (v == null || v === '' ? '""' : JSON.stringify(String(v)));
  const CARD_URL = (code) => 'https://marvelcdb.com/card/' + encodeURIComponent(code);

  const parseAspects = (deck) => {
    try {
      const m = JSON.parse(deck.meta || '{}');
      return [m.aspect, m.aspect2].filter(Boolean);
    } catch (e) {
      return [];
    }
  };

  // Non-empty slots in the deck's stored order, resolved against the card DB.
  function orderedSlots(deck, cardMap) {
    const out = [];
    const slots = deck.slots && typeof deck.slots === 'object' ? deck.slots : {};
    for (const code in slots) {
      const qty = slots[code];
      if (!qty) continue;
      out.push({ code, qty, card: cardMap ? cardMap.get(String(code)) : null });
    }
    return out;
  }

  // Group by type_code (only the six deck types), preserving slot order — mirrors
  // SlotCollectionDecorator::getSlotsByType.
  function slotsByType(deck, cardMap) {
    const by = {
      upgrade: [],
      ally: [],
      support: [],
      event: [],
      resource: [],
      player_side_scheme: [],
    };
    for (const s of orderedSlots(deck, cardMap)) {
      const t = s.card && s.card.type_code;
      if (t && by[t]) by[t].push(s);
    }
    return by;
  }

  // Packs used, ordered by pack position, with copies-needed count — mirrors
  // SlotCollectionDecorator::getIncludedPacks (nb = ceil(qty / card.quantity)).
  function includedPacks(deck, cardMap, packMap) {
    const byPos = new Map();
    for (const s of orderedSlots(deck, cardMap)) {
      const card = s.card;
      if (!card) continue;
      const pack = packMap ? packMap.get(String(card.pack_code)) : null;
      const pos = pack ? pack.position : 9999;
      const name = (pack && pack.name) || card.pack_name || card.pack_code || '';
      const perPack = card.quantity || 1;
      const nb = Math.ceil(s.qty / perPack);
      const cur = byPos.get(pos) || { name, nb: 0 };
      if (nb > cur.nb) cur.nb = nb;
      cur.name = name;
      byPos.set(pos, cur);
    }
    return [...byPos.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }

  // ── Markdown ─────────────────────────────────────────────────────────────────
  function buildMarkdown(deck) {
    const aspect = parseAspects(deck).join(' / ');
    const fm = [
      '---',
      'id: ' + deck.id,
      'name: ' + yaml(deck.name),
      'hero: ' + yaml(deck.hero_name),
      'hero_code: ' + yaml(deck.hero_code),
      aspect ? 'aspect: ' + yaml(aspect) : null,
      deck.tags ? 'tags: ' + yaml(deck.tags) : null,
      'version: ' + yaml(deck.version),
      'date_creation: ' + yaml(deck.date_creation),
      'date_update: ' + yaml(deck.date_update),
      'source_url: ' + yaml('https://marvelcdb.com/deck/view/' + deck.id),
      '---',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    return fm + (deck.description_md || '*No description.*') + '\n';
  }

  // ── Text (reproduces Export/plain.txt.twig) ──────────────────────────────────
  const TEXT_SECTIONS = [
    ['upgrade', 'Upgrade', 'Upgrades'],
    ['event', 'Event', 'Events'],
    ['support', 'Support', 'Supports'],
    ['resource', 'Resource', 'Resources'],
    ['ally', 'Ally', 'Allies'],
    ['player_side_scheme', 'Player Side Scheme', 'Player Side Schemes'],
  ];
  function buildText(deck, ctx) {
    const cardMap = ctx && ctx.cardMap;
    const packMap = ctx && ctx.packMap;
    const by = slotsByType(deck, cardMap);
    const packs = includedPacks(deck, cardMap, packMap);
    const packLabel = (p) => p.name + (p.nb > 1 ? ' (' + p.nb + ')' : '');

    let packsLine = '';
    if (packs.length > 1) {
      packsLine = 'From ' + packLabel(packs[0]) + ' to ' + packLabel(packs[packs.length - 1]);
    } else if (packs.length === 1) {
      packsLine = packLabel(packs[0]);
    }

    const out = [];
    out.push(deck.name || '', '');
    out.push(deck.hero_name || '', '');
    out.push('Packs:', packsLine, '');

    for (const [type, singular, plural] of TEXT_SECTIONS) {
      const slots = by[type];
      if (!slots.length) continue;
      out.push(slots.length > 1 ? plural : singular, '');
      for (const s of slots) {
        const c = s.card || {};
        const name = c.name || s.code;
        const sub = type === 'event' && c.subname ? ':' + c.subname : '';
        const pack = c.pack_name || (c.pack_code ? c.pack_code : '');
        out.push(s.qty + 'x ' + name + sub + ' (' + pack + ')');
      }
      out.push('');
    }
    return out.join('\n').replace(/\n+$/, '\n');
  }

  // ── OCTGN (reproduces Export/octgn.xml.twig) ─────────────────────────────────
  const OCTGN_GAME = '055c536f-adba-4bc2-acbf-9aefb9756046';
  const OCTGN_SECTIONS = ['support', 'event', 'upgrade', 'ally', 'resource', 'player_side_scheme'];
  function buildOctgn(deck, ctx) {
    const cardMap = ctx && ctx.cardMap;
    const by = slotsByType(deck, cardMap);
    const hero = cardMap ? cardMap.get(String(deck.hero_code)) : null;
    // Hero octgn id: getOctgnId(1) → first part of a colon-joined id.
    const heroId = hero && hero.octgn_id ? String(hero.octgn_id).split(':')[0] : '';
    const line = (qty, id, name) =>
      '    <card qty="' + qty + '" id="' + (id || '') + '">' + xmlEsc(name) + '</card>';

    const rows = [line(1, heroId, (hero && hero.name) || deck.hero_name || '')];
    for (const type of OCTGN_SECTIONS) {
      for (const s of by[type]) {
        const c = s.card || {};
        rows.push(line(s.qty, c.octgn_id || '', c.name || s.code));
      }
    }
    return (
      '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n' +
      '<deck game="' +
      OCTGN_GAME +
      '" sleeveid="0">\n' +
      '  <section name="Cards" shared="False">\n' +
      rows.join('\n') +
      '\n' +
      '  </section>\n' +
      '<notes><![CDATA[]]></notes>\n' +
      '</deck>\n'
    );
  }

  // ── HTML (standalone, print-friendly per-deck page) ──────────────────────────
  const TYPE_ORDER = [
    'ally',
    'event',
    'player_side_scheme',
    'resource',
    'support',
    'upgrade',
    'permanent',
  ];
  const TYPE_LABEL = {
    ally: 'Ally',
    event: 'Event',
    player_side_scheme: 'Player Side Scheme',
    resource: 'Resource',
    support: 'Support',
    upgrade: 'Upgrade',
    permanent: 'Permanent',
  };

  // Precompute hero_special (nemesis) sets keyed by parent set code, once per run.
  function indexSpecials(cardMap) {
    const bySet = new Map();
    if (cardMap)
      cardMap.forEach((c) => {
        if (c.card_set_type_name_code === 'hero_special' && c.card_set_parent_code) {
          const k = c.card_set_parent_code;
          if (!bySet.has(k)) bySet.set(k, []);
          bySet.get(k).push(c);
        }
      });
    return bySet;
  }

  // ── Aspect / signature markers ───────────────────────────────────────────────
  // Mirrors MarvelCDB's deck-view icon language: a small colored dot per aspect, and
  // a person glyph for signature (hero-specific) cards. Aspect-vs-signature is a shape
  // difference (dot vs person), so it reads without relying on color alone; the five
  // aspects then differ by color just like the site. 'pool is the fifth aspect, not a
  // Deadpool-only thing. Colors live in CSS vars (MARKER_CSS + theme), so both light
  // and dark, and print, stay consistent.
  const ASPECT_META = {
    aggression: 'Aggression',
    justice: 'Justice',
    leadership: 'Leadership',
    protection: 'Protection',
    pool: "'Pool",
    basic: 'Basic',
  };
  const SIGNATURE_ICON =
    '<span class="mk sig" title="Signature card" aria-label="Signature card">' +
    '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
    '<circle cx="8" cy="5" r="3" fill="currentColor"/>' +
    '<path d="M2.5 14.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5z" fill="currentColor"/>' +
    '</svg></span>';
  const aspectDot = (faction) => {
    const label = ASPECT_META[faction];
    if (!label) return '';
    return '<span class="mk asp asp-' + faction + '" title="' + label + '" aria-label="' + label + '"></span>';
  };
  // The one marker a card shows: person for signature (faction hero), else its aspect dot.
  const cardMarker = (card) => {
    if (!card || !card.faction_code) return '';
    if (card.faction_code === 'hero') return SIGNATURE_ICON;
    return aspectDot(card.faction_code);
  };

  function cardLine(code, qty, card) {
    const name = card && card.name ? esc(card.name) : esc(code);
    const sub = card && card.subname ? ' <span class="sub">' + esc(card.subname) + '</span>' : '';
    return (
      '<li><span class="q">' +
      qty +
      'x</span> ' +
      cardMarker(card) +
      '<a href="' +
      CARD_URL(code) +
      '">' +
      name +
      '</a>' +
      sub +
      '</li>'
    );
  }

  function buildDeckHtml(deck, ctx) {
    const cardMap = ctx && ctx.cardMap;
    const specialsBySet = ctx && ctx.specialsBySet;
    const lookup = (code) => (cardMap ? cardMap.get(String(code)) : null);
    const slots = deck.slots && typeof deck.slots === 'object' ? deck.slots : {};

    const aspects = parseAspects(deck);
    const buckets = {};
    let total = 0;
    const packs = new Set();
    for (const code in slots) {
      const qty = slots[code];
      if (!qty) continue;
      total += qty;
      const c = lookup(code);
      let bucket = c ? c.type_code : 'other';
      if (c && c.type_code === 'upgrade' && c.permanent) bucket = 'permanent';
      (buckets[bucket] = buckets[bucket] || []).push({ code, qty, card: c });
      if (c && c.pack_name) packs.add(c.pack_name);
    }
    const heroCard = lookup(deck.hero_code);
    if (heroCard && heroCard.pack_name) packs.add(heroCard.pack_name);

    const order = TYPE_ORDER.slice();
    for (const b in buckets) if (!order.includes(b)) order.push(b);
    let listHtml = '';
    for (const bucket of order) {
      const items = buckets[bucket];
      if (!items || !items.length) continue;
      items.sort((a, b) =>
        ((a.card && a.card.name) || a.code).localeCompare((b.card && b.card.name) || b.code),
      );
      const label = TYPE_LABEL[bucket] || (items[0].card && items[0].card.type_name) || bucket;
      const count = items.reduce((s, i) => s + i.qty, 0);
      listHtml +=
        '<h3>' +
        esc(label) +
        ' <span class="n">(' +
        count +
        ')</span></h3><ul>' +
        items.map((it) => cardLine(it.code, it.qty, it.card)).join('') +
        '</ul>';
    }

    let specialHtml = '';
    const special = heroCard && specialsBySet ? specialsBySet.get(heroCard.card_set_code) : null;
    if (special && special.length) {
      const sorted = special
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name));
      specialHtml =
        '<div class="special"><h3>Hero set <span class="n">(comes with ' +
        esc(deck.hero_name) +
        ')</span></h3><ul>' +
        sorted.map((c) => cardLine(c.code, c.quantity || 1, c)).join('') +
        '</ul></div>';
    }

    const heroLink =
      heroCard || deck.hero_code
        ? '<a href="' + CARD_URL(deck.hero_code) + '">' + esc(deck.hero_name) + '</a>'
        : esc(deck.hero_name);
    const aspectStr = aspects.map(cap).join(' / ');
    const packStr = [...packs].sort().map(esc).join(', ');
    const srcUrl = 'https://marvelcdb.com/deck/view/' + deck.id;
    const updated = deck.date_update ? String(deck.date_update).slice(0, 10) : '';
    const notes = (deck.description_md || '').trim();
    const notesHtml = notes ? mdToHtml(notes) : '<p class="muted">No notes.</p>';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.name)} (MarvelCDB Deck Downloader)</title>
<style>
${THEME_CSS}
${MARKER_CSS}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);background:var(--bg)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1040px;margin:0 auto;padding:24px}
.toplink{font-size:13px;display:inline-block;margin-bottom:14px}
header.deck{border-bottom:2px solid var(--border-strong);padding-bottom:14px;margin-bottom:20px}
header.deck h1{margin:0 0 6px;font-size:26px}
.sub-meta{color:var(--muted);font-size:14px}.sub-meta b{color:var(--fg)}
.packs{margin-top:6px;font-size:13px;color:var(--muted)}
.src{margin-top:8px;font-size:13px}
main{display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap}
.decklist{flex:1 1 300px;min-width:270px}
.notes{flex:2 1 380px;min-width:300px}
.decklist h3{margin:16px 0 4px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:3px}
.decklist h3:first-child{margin-top:0}
.decklist h3 .n{color:var(--faint);font-weight:normal}
.decklist ul{list-style:none;margin:0;padding:0}
.decklist li{padding:1px 0}
.decklist .q{display:inline-block;min-width:26px;color:var(--muted);font-variant-numeric:tabular-nums}
.decklist .sub{color:var(--faint);font-size:.85em}
.special{margin-top:20px}
.notes h2{margin:0 0 8px;font-size:18px}.notes h1{font-size:22px}.notes h3{font-size:16px}
.notes blockquote{border-left:3px solid var(--border-med);margin:8px 0;padding:2px 12px;color:var(--muted)}
.notes code{background:var(--code-bg);padding:1px 4px;border-radius:4px;font-size:.9em}
.muted{color:var(--faint)}
footer{margin-top:28px;padding-top:12px;border-top:1px solid var(--border);color:var(--faint);font-size:12px}
.embedded .toplink{display:none}
@media(max-width:640px){.wrap{padding:16px 14px}main{gap:18px}header.deck h1{font-size:22px}}
@media print{.toplink{display:none}a{color:#000}body{font-size:11pt}.decklist h3{page-break-after:avoid}.decklist li{page-break-inside:avoid}}
</style>
<script>try{if(window.top!==window.self)document.documentElement.className='embedded'}catch(e){document.documentElement.className='embedded'}</script>
</head>
<body><div class="wrap">
<a class="toplink" href="../index.html">← All decks</a>
<header class="deck">
<h1>${esc(deck.name)}</h1>
<div class="sub-meta"><b>${heroLink}</b>${aspectStr ? ' · ' + esc(aspectStr) : ''} · ${total} cards</div>
${packStr ? '<div class="packs">Packs: ' + packStr + '</div>' : ''}
<div class="src"><a href="${srcUrl}" target="_blank" rel="noopener">View on MarvelCDB ↗</a></div>
</header>
<main>
<section class="decklist">${listHtml || '<p class="muted">No cards.</p>'}${specialHtml}</section>
<section class="notes"><h2>Notes</h2>${notesHtml}</section>
</main>
<footer>Backed up from <a href="${srcUrl}">${srcUrl}</a>${updated ? ' · updated ' + esc(updated) : ''}${deck.version ? ' · v' + esc(deck.version) : ''}</footer>
</div></body></html>`;
  }

  // The one manifest entry per deck, shared by the in-run manifest and the
  // localStorage cache. `base` ('decks/{id}-{slug}') lets both the index and the
  // cache derive every format's filename without storing five paths.
  function buildManifestEntry(deck, base) {
    return {
      id: deck.id,
      name: deck.name,
      hero: deck.hero_name,
      hero_code: deck.hero_code,
      aspects: parseAspects(deck),
      tags: deck.tags || '',
      date_update: deck.date_update,
      has_writeup: !!(deck.description_md || '').trim(),
      base,
      url: 'https://marvelcdb.com/deck/view/' + deck.id,
    };
  }

  // ── Shared theme + marker styles ─────────────────────────────────────────────
  // One palette, expressed as CSS custom properties, shared by every HTML output
  // (per-deck page, index, single-file viewer). Light is the default; dark follows the
  // OS via prefers-color-scheme; a data-theme attribute on <html> forces either one and
  // wins over the media query. Print always forces the light, white-background palette
  // so a printout stays clean (the printer-friendly rule in AGENTS.md).
  const LIGHT_VARS =
    '--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--faint:#999;' +
    '--accent:#1a5fb4;--accent-soft:rgba(26,95,180,.12);' +
    '--border:#eee;--border-med:#ddd;--border-strong:#e3e3e3;' +
    '--row-hover:#f7f9fc;--code-bg:#f2f2f2;--panel-bg:#fff;--shadow:rgba(0,0,0,.08);' +
    '--asp-aggression:#c62828;--asp-justice:#c08a00;--asp-leadership:#2b57b3;' +
    '--asp-protection:#2e7d32;--asp-pool:#c2185b;--asp-basic:#5c5c5c;';
  const DARK_VARS =
    '--bg:#16181c;--fg:#e6e7e9;--muted:#a0a4ab;--faint:#787c84;' +
    '--accent:#6ea8ff;--accent-soft:rgba(110,168,255,.2);' +
    '--border:#2a2d33;--border-med:#363a42;--border-strong:#363a42;' +
    '--row-hover:#1e2127;--code-bg:#23262c;--panel-bg:#1a1d22;--shadow:rgba(0,0,0,.5);' +
    '--asp-aggression:#ef5350;--asp-justice:#e0b400;--asp-leadership:#5b8cf0;' +
    '--asp-protection:#4caf50;--asp-pool:#ec407a;--asp-basic:#9aa0a8;';
  const PRINT_VARS =
    '--bg:#fff;--fg:#000;--muted:#333;--faint:#666;--accent:#000;--accent-soft:transparent;' +
    '--border:#ccc;--border-med:#ccc;--border-strong:#999;' +
    '--row-hover:transparent;--code-bg:#f2f2f2;--panel-bg:#fff;--shadow:transparent;';
  const THEME_CSS =
    ':root{' +
    LIGHT_VARS +
    '}\n@media(prefers-color-scheme:dark){:root{' +
    DARK_VARS +
    '}}\n:root[data-theme=light]{' +
    LIGHT_VARS +
    '}\n:root[data-theme=dark]{' +
    DARK_VARS +
    '}\n@media print{:root{' +
    PRINT_VARS +
    '}}';
  // Aspect dots + signature person glyph, shared by the deck page and the tables.
  const MARKER_CSS =
    '.mk{display:inline-block;vertical-align:middle;margin-right:5px}' +
    '.asp{width:9px;height:9px;border-radius:50%;margin-bottom:2px;background:var(--asp-basic)}' +
    '.asp-aggression{background:var(--asp-aggression)}.asp-justice{background:var(--asp-justice)}' +
    '.asp-leadership{background:var(--asp-leadership)}.asp-protection{background:var(--asp-protection)}' +
    '.asp-pool{background:var(--asp-pool)}.asp-basic{background:var(--asp-basic)}' +
    '.sig{color:var(--faint);line-height:0;margin-right:4px}.sig svg{vertical-align:middle}';
  // Compact legend explaining the markers, and the light/dark/auto toggle button.
  const UI_CSS =
    '.legend{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;color:var(--muted);font-size:12px;margin:0 0 14px}' +
    '.legend .item{display:inline-flex;align-items:center}.legend .mk{margin-right:4px}' +
    '#theme-btn{border:1px solid var(--border-med);background:var(--panel-bg);color:var(--muted);' +
    'font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;cursor:pointer}' +
    '#theme-btn:hover{color:var(--accent);border-color:var(--accent)}' +
    '.head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}' +
    '@media print{#theme-btn{display:none}}';
  // Reads/writes the saved choice, cycles auto → light → dark, and lets a page hook in
  // (the viewer re-themes its open preview). Concatenation, no template literals, so it
  // drops cleanly into a page's own template literal.
  const THEME_SCRIPT =
    "(function(){var K='mcb-theme',r=document.documentElement,b=document.getElementById('theme-btn');" +
    "function ap(t){if(t==='light'||t==='dark')r.setAttribute('data-theme',t);else r.removeAttribute('data-theme');" +
    "if(b)b.textContent=t==='light'?'\\u2600\\uFE0E Light':t==='dark'?'\\u263D\\uFE0E Dark':'\\u25D1\\uFE0E Auto';" +
    "if(window.__mcbThemed)window.__mcbThemed(t);}" +
    "var c;try{c=localStorage.getItem(K)||'auto'}catch(e){c='auto'}ap(c);" +
    "if(b)b.addEventListener('click',function(){c=c==='auto'?'light':c==='light'?'dark':'auto';" +
    "try{localStorage.setItem(K,c)}catch(e){}ap(c);});" +
    "window.__mcbTheme=function(){return c;};})();";

  // Aspect column cell: dot(s) + the aspect name(s), for the index and viewer tables.
  const aspectCellHtml = (codes) =>
    (codes || []).map(aspectDot).join('') + esc((codes || []).map(cap).join(' / '));
  // Shared legend so the dot/person language explains itself on both tables.
  const LEGEND_HTML =
    '<div class="legend">' +
    Object.keys(ASPECT_META)
      .map((k) => '<span class="item">' + aspectDot(k) + ASPECT_META[k] + '</span>')
      .join('') +
    '<span class="item">' +
    SIGNATURE_ICON +
    'Signature</span></div>';
  const themeBtn = '<button id="theme-btn" type="button" title="Toggle light / dark / auto"></button>';
  // The preview modal, shared by the index and the viewer so they stay identical. The
  // deck's own page (in the iframe) carries the title and its own "View on MarvelCDB"
  // link, so the header is just a thin toolbar. The viewer's is only a fullscreen toggle
  // and a close/back button; the folder index adds its per-format download links inline,
  // the one thing it has that the single-file viewer does not.
  const sheetAside = (withFiles) =>
    '<aside id="sheet" hidden aria-label="Deck preview">' +
    '<div class="sheet-head">' +
    (withFiles ? '<span class="lbl">Files:</span><span id="sheet-formats"></span>' : '') +
    '<span class="sheet-spacer"></span>' +
    '<button id="sheet-full" type="button" aria-label="Toggle fullscreen" title="Fullscreen"></button>' +
    '<button id="sheet-close" type="button" aria-label="Close preview"></button>' +
    '</div>' +
    '<iframe id="sheet-frame" title="Deck preview"></iframe></aside>';

  // ── index.html (browsable table) ─────────────────────────────────────────────
  // opts.backedUpAt is the ISO run timestamp for the header line. Rows carry data-*
  // attributes (including a full-precision data-updated sort key) so the search box,
  // sortable headers, and side-sheet viewer below are pure JS add-ons: with scripting
  // off you still get the sorted table and every file link. Every backup is complete,
  // so there is no partial-ZIP case. Kept white-background and print-clean on purpose
  // (see feature-index-page.md and the printer-friendly rule in AGENTS.md).
  const INDEX_FORMATS = [
    ['json', 'JSON'],
    ['md', 'MD'],
    ['txt', 'TXT'],
    ['o8d', 'OCTGN'],
    ['html', 'HTML'],
  ];
  // Default order: most recently updated on top. Empty dates sink to the bottom.
  const byUpdatedDesc = (a, b) =>
    String(b.date_update || '').localeCompare(String(a.date_update || '')) ||
    String(a.name || '').localeCompare(b.name || '');
  const INDEX_STYLE = `
body{margin:0;font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);background:var(--bg)}
.wrap{max-width:1040px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}.sub{color:var(--muted);font-size:13px;margin-bottom:16px}
.controls{margin:0 0 14px}
#q{width:100%;box-sizing:border-box;padding:9px 12px;font:inherit;font-size:14px;border:1px solid var(--border-med);border-radius:8px;background:var(--panel-bg);color:var(--fg)}
#q:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#count{color:var(--muted);font-size:12px;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
thead th{position:sticky;top:0;background:var(--bg);box-shadow:inset 0 -1px 0 var(--border);z-index:1}
th[data-sort]{cursor:pointer;white-space:nowrap;user-select:none}
th[data-sort]:hover{color:var(--accent)}
th[aria-sort=ascending]::after{content:'▲';font-size:9px;color:var(--accent);margin-left:5px}
th[aria-sort=descending]::after{content:'▼';font-size:9px;color:var(--accent);margin-left:5px}
td.u{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
td.f{white-space:nowrap}
td.f a{font-size:12px;color:var(--muted);margin-right:2px}
td.f a:hover{color:var(--accent)}
td.c-aspect{white-space:nowrap}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
tbody tr{cursor:pointer}
tbody tr:hover td{background:var(--row-hover)}
td .deck{font-weight:600}
#empty{color:var(--muted);font-size:14px;padding:16px 10px}
#sheet{position:fixed;top:0;right:0;width:min(560px,92vw);height:100%;background:var(--panel-bg);border-left:1px solid var(--border-strong);box-shadow:-8px 0 24px var(--shadow);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .18s ease,width .18s ease;z-index:10}
#sheet.open{transform:translateX(0)}
#sheet.full{width:100%;border-left:0}
.sheet-head{display:flex;align-items:center;gap:4px;padding:8px 10px}
.sheet-spacer{flex:1}
#sheet-full,#sheet-close{display:inline-flex;align-items:center;justify-content:center;border:0;background:none;font-size:20px;line-height:1;color:var(--faint);cursor:pointer;padding:2px 8px}
#sheet-full:hover,#sheet-close:hover{color:var(--fg)}
#sheet-full::before{content:'';width:16px;height:16px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8V4h4M16 4h4v4M8 20H4v-4M20 16v4h-4'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 8V4h4M16 4h4v4M8 20H4v-4M20 16v4h-4'/%3E%3C/svg%3E") center/contain no-repeat}
#sheet.full #sheet-full::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 4v4H4M16 4v4h4M4 16h4v4M20 16h-4v4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 4v4H4M16 4v4h4M4 16h4v4M20 16h-4v4'/%3E%3C/svg%3E")}
#sheet-close::before{content:'\\00D7'}
.sheet-head .lbl{color:var(--faint);font-size:12px;margin-right:4px}
#sheet-formats{font-size:12px}
#sheet-formats a{color:var(--muted);margin-right:6px}
#sheet-formats a:hover{color:var(--accent)}
#sheet-frame{flex:1;width:100%;border:0;background:var(--panel-bg);border-top:1px solid var(--border)}
@media(max-width:640px){
.wrap{padding:16px 13px}
h1{font-size:20px}
thead{display:none}
table,tbody{display:block}
tbody tr{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:3px;padding:12px 2px}
tbody td{display:block;padding:0;border:0;white-space:normal}
tbody tr:hover td{background:transparent}
td.c-deck{flex:1 0 100%;font-size:16px}
td.c-deck a{font-weight:600}
td.c-aspect{order:2;font-size:13px;white-space:normal}
td.c-hero{order:3;flex:1;min-width:0;color:var(--muted);font-size:13px}
td.c-updated{order:4;font-size:12px;color:var(--muted);text-align:right;white-space:nowrap}
td.c-tags,td.c-files{display:none}
#sheet{width:100%;border-left:0}
.sheet-head{padding:8px 10px}
#sheet-full{display:none}
.sheet-head .lbl,#sheet-formats{display:none}
#sheet-close{order:-1;font-size:24px;padding:2px 10px 2px 4px}
#sheet-close::before{content:'\\2190'}
}
@media print{.controls,#sheet{display:none!important}thead th{position:static;box-shadow:none}tbody tr{cursor:auto}tbody tr:hover td{background:transparent}tr{break-inside:avoid}th[aria-sort]::after{content:''!important}}
`;
  // Vanilla, no-dependency enhancement layer. Written with string concatenation (no
  // template literals) so it drops cleanly into the page's own template literal.
  const INDEX_SCRIPT = `
(function(){
  var tb=document.querySelector('tbody');if(!tb)return;
  var rows=[].slice.call(tb.rows),total=rows.length;
  var q=document.getElementById('q'),count=document.getElementById('count'),empty=document.getElementById('empty');
  function filter(){
    var s=(q.value||'').trim().toLowerCase(),shown=0;
    for(var i=0;i<rows.length;i++){
      var d=rows[i].dataset,hit=!s||(d.name+' '+d.hero+' '+d.aspect+' '+d.tags).indexOf(s)>-1;
      rows[i].hidden=!hit;if(hit)shown++;
    }
    if(count)count.textContent=(shown===total?total:shown+' of '+total)+' deck'+(total===1?'':'s');
    if(empty)empty.hidden=shown>0;
  }
  if(q)q.addEventListener('input',filter);
  var key='updated',dir=-1,ths=[].slice.call(document.querySelectorAll('th[data-sort]'));
  function sort(){
    rows.slice().sort(function(a,b){
      var av=a.dataset[key]||'',bv=b.dataset[key]||'';
      var c=key==='updated'?(av<bv?-1:av>bv?1:0):av.localeCompare(bv);
      return c*dir;
    }).forEach(function(r){tb.appendChild(r);});
    for(var j=0;j<ths.length;j++){
      if(ths[j].dataset.sort===key)ths[j].setAttribute('aria-sort',dir===1?'ascending':'descending');
      else ths[j].removeAttribute('aria-sort');
    }
  }
  ths.forEach(function(t){t.addEventListener('click',function(){
    var nk=t.dataset.sort;
    if(key===nk)dir=-dir;else{key=nk;dir=nk==='updated'?-1:1;}
    sort();
  });});
  var sheet=document.getElementById('sheet'),frame=document.getElementById('sheet-frame');
  var fmts=document.getElementById('sheet-formats');
  function hide(){if(sheet){sheet.classList.remove('open');sheet.classList.remove('full');}if(frame)frame.src='about:blank';}
  function preview(tr){
    var a=tr.querySelector('a.deck');if(!a||!sheet)return;
    var f=tr.querySelector('td.f');
    frame.src=a.getAttribute('href');
    if(fmts)fmts.innerHTML=f?f.innerHTML:'';
    sheet.removeAttribute('hidden');sheet.classList.add('open');
  }
  // The whole row is the preview target. Real links inside (the deck name, the
  // per-format links) keep their normal navigation, so the click falls through.
  tb.addEventListener('click',function(ev){
    if(ev.target.closest('a'))return;
    var tr=ev.target.closest('tr');if(tr&&!tr.hidden)preview(tr);
  });
  var close=document.getElementById('sheet-close'),full=document.getElementById('sheet-full');
  if(close)close.addEventListener('click',hide);
  if(full)full.addEventListener('click',function(){sheet.classList.toggle('full');});
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape')hide();});
})();
`;
  function buildIndexHtml(entries, opts) {
    opts = opts || {};
    const rows = entries
      .slice()
      .sort(byUpdatedDesc)
      .map((e) => {
        // Tolerate the legacy shape ({ file }) as well as the current one ({ base }).
        const base = e.base || (e.file ? e.file.replace(/\.html$/, '') : '');
        const aspects = (e.aspects || []).map(cap).join(' / ');
        const updated = e.date_update ? String(e.date_update).slice(0, 10) : '';
        const links = INDEX_FORMATS.map(
          ([ext, label]) => '<a href="' + esc(base + '.' + ext) + '">' + label + '</a>',
        ).join(' ');
        const data =
          ' data-name="' +
          esc((e.name || '').toLowerCase()) +
          '" data-hero="' +
          esc((e.hero || '').toLowerCase()) +
          '" data-aspect="' +
          esc(aspects.toLowerCase()) +
          '" data-tags="' +
          esc((e.tags || '').toLowerCase()) +
          '" data-updated="' +
          esc(e.date_update || '') +
          '"';
        return (
          '<tr' +
          data +
          '><td class="c-deck"><a class="deck" href="' +
          esc(base + '.html') +
          '">' +
          esc(e.name || '(untitled)') +
          '</a></td><td class="c-hero">' +
          esc(e.hero || '') +
          '</td><td class="c-aspect">' +
          aspectCellHtml(e.aspects) +
          '</td><td class="c-tags">' +
          esc(e.tags || '') +
          '</td><td class="u c-updated">' +
          esc(updated) +
          '</td><td class="f c-files">' +
          links +
          '</td></tr>'
        );
      })
      .join('');
    const when = String(opts.backedUpAt || new Date().toISOString()).slice(0, 10);
    const n = entries.length;
    const decksLabel = n + ' deck' + (n === 1 ? '' : 's');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MarvelCDB Deck Downloader (${n} decks)</title>
<style>${THEME_CSS}${MARKER_CSS}${UI_CSS}${INDEX_STYLE}</style></head>
<body><div class="wrap">
<div class="head-row"><div><h1>MarvelCDB Deck Downloader</h1>
<div class="sub">Backed up ${when}. Click a row to preview it, the deck name to open its full page, or a header to re-sort.</div></div>
${themeBtn}</div>
${LEGEND_HTML}
<div class="controls">
<input id="q" type="search" placeholder="Search decks by name, hero, aspect, or tag…" autocomplete="off" aria-label="Search decks">
<div id="count">${decksLabel}</div>
</div>
<table><thead><tr><th data-sort="name">Deck</th><th data-sort="hero">Hero</th><th data-sort="aspect">Aspect</th><th data-sort="tags">Tags</th><th data-sort="updated" aria-sort="descending">Updated</th><th>Files</th></tr></thead><tbody>${rows}</tbody></table>
<div id="empty" hidden>No decks match your search.</div>
</div>
${sheetAside(true)}
<script>${INDEX_SCRIPT}</script>
<script>${THEME_SCRIPT}</script>
</body></html>`;
  }

  // ── viewer.html (single self-contained file, every deck embedded) ────────────
  // Same table/search/sort as the index, but built for portability: a user can email
  // this one file to themselves or host it anywhere and browse offline on a phone. The
  // difference from the index is that there are no sibling files — each deck's full
  // page HTML is embedded in a DECKS blob and shown in the side sheet via iframe srcdoc
  // (file://-safe, keeps the deck page's own styles and its embedded back-link hiding).
  // The blob is JSON with every '<' escaped to \\u003c so a deck's notes can never close
  // the script tag. buildDeckHtml already themes via CSS vars, so the preview follows
  // the chosen theme once we inject data-theme onto its root at render time.
  const VIEWER_SCRIPT =
    '(function(){' +
    "var tb=document.querySelector('tbody');if(!tb)return;" +
    'var rows=[].slice.call(tb.rows),total=rows.length;' +
    "var q=document.getElementById('q'),count=document.getElementById('count'),empty=document.getElementById('empty');" +
    'function filter(){var s=(q.value||\'\').trim().toLowerCase(),shown=0;' +
    "for(var i=0;i<rows.length;i++){var d=rows[i].dataset,hit=!s||(d.name+' '+d.hero+' '+d.aspect+' '+d.tags).indexOf(s)>-1;" +
    'rows[i].hidden=!hit;if(hit)shown++;}' +
    "if(count)count.textContent=(shown===total?total:shown+' of '+total)+' deck'+(total===1?'':'s');" +
    'if(empty)empty.hidden=shown>0;}' +
    "if(q)q.addEventListener('input',filter);" +
    "var key='updated',dir=-1,ths=[].slice.call(document.querySelectorAll('th[data-sort]'));" +
    "function sort(){rows.slice().sort(function(a,b){var av=a.dataset[key]||'',bv=b.dataset[key]||'';" +
    "var c=key==='updated'?(av<bv?-1:av>bv?1:0):av.localeCompare(bv);return c*dir;}).forEach(function(r){tb.appendChild(r);});" +
    "for(var j=0;j<ths.length;j++){if(ths[j].dataset.sort===key)ths[j].setAttribute('aria-sort',dir===1?'ascending':'descending');else ths[j].removeAttribute('aria-sort');}}" +
    "ths.forEach(function(t){t.addEventListener('click',function(){var nk=t.dataset.sort;if(key===nk)dir=-dir;else{key=nk;dir=nk==='updated'?-1:1;}sort();});});" +
    "var sheet=document.getElementById('sheet'),frame=document.getElementById('sheet-frame'),curId=null;" +
    'function themed(h){var t=window.__mcbTheme?window.__mcbTheme():\'auto\';' +
    'return (t===\'light\'||t===\'dark\')?h.replace(\'<html \',\'<html data-theme="\'+t+\'" \'):h;}' +
    'function render(){if(curId!=null&&frame&&DECKS[curId])frame.srcdoc=themed(DECKS[curId]);}' +
    'window.__mcbThemed=function(){render();};' +
    "function hide(){if(sheet){sheet.classList.remove('open');sheet.classList.remove('full');}curId=null;if(frame)frame.srcdoc='';}" +
    "function preview(tr){var id=tr.getAttribute('data-id');if(id==null||!sheet||!DECKS[id])return;" +
    'curId=id;render();' +
    "sheet.removeAttribute('hidden');sheet.classList.add('open');}" +
    "tb.addEventListener('click',function(ev){var a=ev.target.closest('a');" +
    "if(a&&a.classList.contains('deck'))ev.preventDefault();else if(a)return;" +
    "var tr=ev.target.closest('tr');if(tr&&!tr.hidden)preview(tr);});" +
    "var close=document.getElementById('sheet-close');if(close)close.addEventListener('click',hide);" +
    "var full=document.getElementById('sheet-full');if(full)full.addEventListener('click',function(){sheet.classList.toggle('full');});" +
    "document.addEventListener('keydown',function(ev){if(ev.key==='Escape')hide();});" +
    '})();';
  function buildViewerHtml(entries, deckHtmlById, opts) {
    opts = opts || {};
    const rows = entries
      .slice()
      .sort(byUpdatedDesc)
      .map((e) => {
        const aspects = (e.aspects || []).map(cap).join(' / ');
        const updated = e.date_update ? String(e.date_update).slice(0, 10) : '';
        const data =
          ' data-id="' +
          esc(String(e.id)) +
          '" data-name="' +
          esc((e.name || '').toLowerCase()) +
          '" data-hero="' +
          esc((e.hero || '').toLowerCase()) +
          '" data-aspect="' +
          esc(aspects.toLowerCase()) +
          '" data-tags="' +
          esc((e.tags || '').toLowerCase()) +
          '" data-updated="' +
          esc(e.date_update || '') +
          '"';
        return (
          '<tr' +
          data +
          '><td class="c-deck"><a class="deck" href="#">' +
          esc(e.name || '(untitled)') +
          '</a></td><td class="c-hero">' +
          esc(e.hero || '') +
          '</td><td class="c-aspect">' +
          aspectCellHtml(e.aspects) +
          '</td><td class="c-tags">' +
          esc(e.tags || '') +
          '</td><td class="u c-updated">' +
          esc(updated) +
          '</td></tr>'
        );
      })
      .join('');
    const when = String(opts.backedUpAt || new Date().toISOString()).slice(0, 10);
    const n = entries.length;
    const decksLabel = n + ' deck' + (n === 1 ? '' : 's');
    // Every '<' escaped so a deck's notes can't break out of the <script> data blob.
    const blob = JSON.stringify(deckHtmlById || {}).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MarvelCDB decks (${n})</title>
<style>${THEME_CSS}${MARKER_CSS}${UI_CSS}${INDEX_STYLE}</style></head>
<body><div class="wrap">
<div class="head-row"><div><h1>MarvelCDB decks</h1>
<div class="sub">Backed up ${when}. Everything is in this one file, so it works offline. Click a row to preview a deck, or a header to re-sort.</div></div>
${themeBtn}</div>
${LEGEND_HTML}
<div class="controls">
<input id="q" type="search" placeholder="Search decks by name, hero, aspect, or tag…" autocomplete="off" aria-label="Search decks">
<div id="count">${decksLabel}</div>
</div>
<table><thead><tr><th data-sort="name">Deck</th><th data-sort="hero">Hero</th><th data-sort="aspect">Aspect</th><th data-sort="tags">Tags</th><th data-sort="updated" aria-sort="descending">Updated</th></tr></thead><tbody>${rows}</tbody></table>
<div id="empty" hidden>No decks match your search.</div>
</div>
${sheetAside(false)}
<script>var DECKS=${blob};</script>
<script>${VIEWER_SCRIPT}</script>
<script>${THEME_SCRIPT}</script>
</body></html>`;
  }

  // Minimal, self-contained Markdown → HTML (headings, lists, blockquotes, hr,
  // bold/italic/code/links, paragraphs). Barebones by design — no dependencies.
  function mdToHtml(md) {
    const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s) =>
      e(s)
        .replace(/`([^`]+)`/g, (m, x) => '<code>' + x + '</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
          /^(https?:\/\/|\/|#|mailto:)/.test(u)
            ? '<a href="' + u.replace(/"/g, '%22') + '">' + t + '</a>'
            : t,
        );
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let html = '',
      para = [],
      i = 0;
    const closePara = () => {
      if (para.length) {
        html += '<p>' + inline(para.join(' ')) + '</p>';
        para = [];
      }
    };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        closePara();
        const l = m[1].length;
        html += '<h' + l + '>' + inline(m[2]) + '</h' + l + '>';
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closePara();
        html += '<hr>';
        i++;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        closePara();
        html += '<ul>';
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          html += '<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>';
          i++;
        }
        html += '</ul>';
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        closePara();
        html += '<ol>';
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          html += '<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>';
          i++;
        }
        html += '</ol>';
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        closePara();
        const q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + inline(q.join(' ')) + '</blockquote>';
        continue;
      }
      if (/^\s*$/.test(line)) {
        closePara();
        i++;
        continue;
      }
      para.push(line.trim());
      i++;
    }
    closePara();
    return html;
  }

  MCB.transform = {
    slugify,
    parseAspects,
    indexSpecials,
    buildMarkdown,
    buildText,
    buildOctgn,
    buildDeckHtml,
    buildManifestEntry,
    buildIndexHtml,
    buildViewerHtml,
    mdToHtml,
  };
})();
