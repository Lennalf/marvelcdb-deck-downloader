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

  function cardLine(code, qty, card) {
    const name = card && card.name ? esc(card.name) : esc(code);
    const sub = card && card.subname ? ' <span class="sub">' + esc(card.subname) + '</span>' : '';
    return (
      '<li><span class="q">' +
      qty +
      'x</span> <a href="' +
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
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#fff}
a{color:#1a5fb4;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1040px;margin:0 auto;padding:24px}
.toplink{font-size:13px;display:inline-block;margin-bottom:14px}
header.deck{border-bottom:2px solid #e3e3e3;padding-bottom:14px;margin-bottom:20px}
header.deck h1{margin:0 0 6px;font-size:26px}
.sub-meta{color:#555;font-size:14px}.sub-meta b{color:#1a1a1a}
.packs{margin-top:6px;font-size:13px;color:#555}
main{display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap}
.decklist{flex:1 1 300px;min-width:270px}
.notes{flex:2 1 380px;min-width:300px}
.decklist h3{margin:16px 0 4px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:3px}
.decklist h3:first-child{margin-top:0}
.decklist h3 .n{color:#999;font-weight:normal}
.decklist ul{list-style:none;margin:0;padding:0}
.decklist li{padding:1px 0}
.decklist .q{display:inline-block;min-width:26px;color:#777;font-variant-numeric:tabular-nums}
.decklist .sub{color:#999;font-size:.85em}
.special{margin-top:20px}
.notes h2{margin:0 0 8px;font-size:18px}.notes h1{font-size:22px}.notes h3{font-size:16px}
.notes blockquote{border-left:3px solid #ddd;margin:8px 0;padding:2px 12px;color:#555}
.notes code{background:#f2f2f2;padding:1px 4px;border-radius:4px;font-size:.9em}
.muted{color:#999}
footer{margin-top:28px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:12px}
.embedded .toplink{display:none}
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
body{margin:0;font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#fff}
.wrap{max-width:1040px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}.sub{color:#777;font-size:13px;margin-bottom:16px}
.controls{margin:0 0 14px}
#q{width:100%;box-sizing:border-box;padding:9px 12px;font:inherit;font-size:14px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#1a1a1a}
#q:focus{outline:none;border-color:#1a5fb4;box-shadow:0 0 0 3px rgba(26,95,180,.12)}
#count{color:#777;font-size:12px;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top}
th{color:#777;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
thead th{position:sticky;top:0;background:#fff;box-shadow:inset 0 -1px 0 #eee;z-index:1}
th[data-sort]{cursor:pointer;white-space:nowrap;user-select:none}
th[data-sort]:hover{color:#1a5fb4}
th[aria-sort=ascending]::after{content:'▲';font-size:9px;color:#1a5fb4;margin-left:5px}
th[aria-sort=descending]::after{content:'▼';font-size:9px;color:#1a5fb4;margin-left:5px}
td.u{white-space:nowrap;color:#777;font-variant-numeric:tabular-nums}
td.f{white-space:nowrap}
td.f a{font-size:12px;color:#888;margin-right:2px}
td.f a:hover{color:#1a5fb4}
a{color:#1a5fb4;text-decoration:none}a:hover{text-decoration:underline}
tbody tr{cursor:pointer}
tbody tr:hover td{background:#f7f9fc}
td .deck{font-weight:600}
#empty{color:#777;font-size:14px;padding:16px 10px}
#sheet{position:fixed;top:0;right:0;width:min(560px,92vw);height:100%;background:#fff;border-left:1px solid #e2e2e2;box-shadow:-8px 0 24px rgba(0,0,0,.08);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .18s ease;z-index:10}
#sheet.open{transform:translateX(0)}
.sheet-head{display:flex;align-items:center;gap:12px;padding:12px 16px 10px}
#sheet-title{font-weight:600;font-size:15px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sheet-close{border:0;background:none;font-size:22px;line-height:1;color:#999;cursor:pointer;padding:0 4px}
#sheet-close:hover{color:#1a1a1a}
.sheet-sub{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:0 16px 12px;border-bottom:1px solid #eee;font-size:12px}
.sheet-sub .lbl{color:#999}
#sheet-formats a{color:#888;margin-right:2px}
#sheet-formats a:hover{color:#1a5fb4}
#sheet-frame{flex:1;width:100%;border:0;background:#fff}
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
  var title=document.getElementById('sheet-title'),open=document.getElementById('sheet-open'),fmts=document.getElementById('sheet-formats');
  function hide(){if(sheet)sheet.classList.remove('open');if(frame)frame.src='about:blank';}
  function preview(tr){
    var a=tr.querySelector('a.deck');if(!a||!sheet)return;
    var href=a.getAttribute('href'),f=tr.querySelector('td.f');
    frame.src=href;title.textContent=a.textContent;open.href=href;
    if(fmts)fmts.innerHTML=f?f.innerHTML:'';
    sheet.removeAttribute('hidden');sheet.classList.add('open');
  }
  // The whole row is the preview target. Real links inside (the deck name, the
  // per-format links) keep their normal navigation, so the click falls through.
  tb.addEventListener('click',function(ev){
    if(ev.target.closest('a'))return;
    var tr=ev.target.closest('tr');if(tr&&!tr.hidden)preview(tr);
  });
  var close=document.getElementById('sheet-close');
  if(close)close.addEventListener('click',hide);
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
          '><td><a class="deck" href="' +
          esc(base + '.html') +
          '">' +
          esc(e.name || '(untitled)') +
          '</a></td><td>' +
          esc(e.hero || '') +
          '</td><td>' +
          esc(aspects) +
          '</td><td>' +
          esc(e.tags || '') +
          '</td><td class="u">' +
          esc(updated) +
          '</td><td class="f">' +
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
<style>${INDEX_STYLE}</style></head>
<body><div class="wrap">
<h1>MarvelCDB Deck Downloader</h1>
<div class="sub">Backed up ${when}. Click a row to preview it, the deck name to open its full page, or a header to re-sort.</div>
<div class="controls">
<input id="q" type="search" placeholder="Search decks by name, hero, aspect, or tag…" autocomplete="off" aria-label="Search decks">
<div id="count">${decksLabel}</div>
</div>
<table><thead><tr><th data-sort="name">Deck</th><th data-sort="hero">Hero</th><th data-sort="aspect">Aspect</th><th data-sort="tags">Tags</th><th data-sort="updated" aria-sort="descending">Updated</th><th>Files</th></tr></thead><tbody>${rows}</tbody></table>
<div id="empty" hidden>No decks match your search.</div>
</div>
<aside id="sheet" hidden aria-label="Deck preview">
<div class="sheet-head"><span id="sheet-title"></span><button id="sheet-close" type="button" aria-label="Close preview">×</button></div>
<div class="sheet-sub"><a id="sheet-open" target="_blank" rel="noopener">Open full page ↗</a><span class="lbl">Files:</span><span id="sheet-formats"></span></div>
<iframe id="sheet-frame" title="Deck preview"></iframe>
</aside>
<script>${INDEX_SCRIPT}</script>
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
    mdToHtml,
  };
})();
