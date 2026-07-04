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
<title>${esc(deck.name)} — deck backup</title>
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
@media print{.toplink{display:none}a{color:#000}body{font-size:11pt}.decklist h3{page-break-after:avoid}.decklist li{page-break-inside:avoid}}
</style></head>
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

  // ── index.html (browsable table) ─────────────────────────────────────────────
  function buildIndexHtml(entries) {
    const rows = entries
      .slice()
      .sort(
        (a, b) =>
          String(a.hero || '').localeCompare(b.hero || '') ||
          String(a.name || '').localeCompare(b.name || ''),
      )
      .map(
        (e) =>
          '<tr><td><a href="' +
          esc(e.file) +
          '">' +
          esc(e.name || '(untitled)') +
          '</a></td><td>' +
          esc(e.hero || '') +
          '</td><td class="c">' +
          (e.has_writeup ? '✓' : '') +
          '</td></tr>',
      )
      .join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MarvelCDB deck backup (${entries.length} decks)</title>
<style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#fff}
.wrap{max-width:860px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}.sub{color:#777;font-size:13px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee}
th{color:#777;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.c,th.c{text-align:center}
a{color:#1a5fb4;text-decoration:none}a:hover{text-decoration:underline}
tr:hover td{background:#f7f9fc}
</style></head>
<body><div class="wrap">
<h1>MarvelCDB deck backup</h1>
<div class="sub">${entries.length} deck${entries.length === 1 ? '' : 's'} · backed up ${new Date().toISOString().slice(0, 10)}</div>
<table><thead><tr><th>Deck</th><th>Hero</th><th class="c">Notes</th></tr></thead><tbody>${rows}</tbody></table>
</div></body></html>`;
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
    indexSpecials,
    buildMarkdown,
    buildText,
    buildOctgn,
    buildDeckHtml,
    buildIndexHtml,
    mdToHtml,
  };
})();
