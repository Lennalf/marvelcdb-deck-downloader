// ui.js — presentation only: the launcher button and the progress panel. Emits
// user intents (pause/cancel/close) back to the orchestrator via handler callbacks;
// it owns no run state and does no network I/O.
(function () {
  const MCB = (window.MCB = window.MCB || {});

  const ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  function injectStyles() {
    if (document.getElementById('mcb-style')) return;
    const s = document.createElement('style');
    s.id = 'mcb-style';
    s.textContent = `
#mcb-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;display:inline-flex;align-items:center;
  gap:9px;font:600 13.5px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;background:#2f6fed;
  border:0;border-radius:11px;padding:11px 16px 11px 14px;cursor:pointer;
  box-shadow:0 8px 24px rgba(21,60,150,.40),inset 0 1px 0 rgba(255,255,255,.10);
  transition:transform .1s ease,background .15s ease}
#mcb-btn:hover{background:#2861d8;transform:translateY(-1px)}
#mcb-btn:active{transform:translateY(0)}
#mcb-btn svg{flex:0 0 auto}
#mcb-panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:364px;max-width:calc(100vw - 40px);
  background:#111621;color:#e6e9ef;border:1px solid #283143;border-radius:14px;
  box-shadow:0 16px 48px rgba(0,0,0,.55);overflow:hidden;
  font:13px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
#mcb-panel *{box-sizing:border-box}
.mcb-head{display:flex;align-items:center;gap:9px;padding:12px 13px;background:#0e131d;border-bottom:1px solid #1e2634}
.mcb-head .mcb-ico{color:#4c8dff;display:flex;flex:0 0 auto}
.mcb-title{font-weight:650;font-size:13.5px;letter-spacing:.2px}
.mcb-status{margin-left:auto;font-size:11.5px;color:#8a94a6;font-weight:500;white-space:nowrap}
.mcb-x{margin-left:6px;display:flex;padding:3px;border:0;border-radius:6px;background:0;color:#8a94a6;cursor:pointer}
.mcb-x:hover{background:#1c2432;color:#e6e9ef}
.mcb-body{padding:14px}
.mcb-phase{margin-bottom:15px;transition:opacity .3s ease}
.mcb-phase:last-child{margin-bottom:0}
.mcb-phase.mcb-off{opacity:.38}
.mcb-prow{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:7px}
.mcb-plabel{font-weight:600;font-size:12.5px;color:#dfe4ec}
.mcb-pcount{font-size:12px;color:#9aa4b2;font-variant-numeric:tabular-nums;white-space:nowrap}
.mcb-track{height:8px;border-radius:999px;background:#1c2432;overflow:hidden;position:relative}
.mcb-fill{position:absolute;top:0;left:0;height:100%;border-radius:999px;width:0;
  background:linear-gradient(90deg,#4c8dff,#6aa8ff);transition:width .3s ease}
.mcb-track.mcb-indet .mcb-fill{width:34%;transition:none;animation:mcb-slide 1.15s ease-in-out infinite;
  background:linear-gradient(90deg,#3a6fd0,#6aa8ff,#3a6fd0)}
.mcb-track.mcb-done .mcb-fill{background:linear-gradient(90deg,#22a06b,#3ac98a)}
@keyframes mcb-slide{0%{left:-34%}100%{left:100%}}
.mcb-detail{margin-top:8px;font-size:11.5px;color:#8a94a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcb-detail.mcb-warn{color:#ffb454}
.mcb-controls{display:flex;gap:8px;padding:12px 13px;background:#0e131d;border-top:1px solid #1e2634}
.mcb-btn2{flex:1;padding:8px 10px;border-radius:8px;border:1px solid #2b3648;background:#1a2130;color:#dfe4ec;
  font:600 12.5px system-ui,sans-serif;cursor:pointer;transition:background .12s ease}
.mcb-btn2:hover:not([disabled]){background:#212a3b}
.mcb-btn2.mcb-primary{background:#2f6fed;border-color:#2f6fed;color:#fff}
.mcb-btn2.mcb-primary:hover:not([disabled]){background:#2861d8}
.mcb-btn2[disabled]{opacity:.45;cursor:default}
details.mcb-logwrap{padding:0 13px 12px}
details.mcb-logwrap summary{cursor:pointer;font-size:11.5px;color:#8a94a6;user-select:none;list-style:none;
  padding:6px 0}
details.mcb-logwrap summary::-webkit-details-marker{display:none}
details.mcb-logwrap summary:before{content:'▸ ';color:#5a6577}
details.mcb-logwrap[open] summary:before{content:'▾ '}
.mcb-log{max-height:110px;overflow:auto;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#8a94a6;
  border-top:1px solid #1e2634;padding-top:8px}
.mcb-log div{white-space:pre-wrap;word-break:break-word}
.mcb-log .mcb-err{color:#ff8a8a}`;
    (document.head || document.documentElement).appendChild(s);
  }

  // Create + mount the floating launcher button. onRun fires on click.
  function makeLauncher(onRun) {
    injectStyles();
    const btn = document.createElement('button');
    btn.id = 'mcb-btn';
    btn.type = 'button';
    btn.innerHTML = ICON + '<span>Back up my decks</span>';
    btn.addEventListener('click', () => onRun());
    const mount = () => {
      if (document.body && !document.getElementById('mcb-btn')) document.body.appendChild(btn);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
    return {
      el: btn,
      hide: () => (btn.style.display = 'none'),
      show: () => (btn.style.display = ''),
    };
  }

  // Build the progress panel. handlers: { onPauseToggle, onCancel, onClose }.
  function makePanel(handlers) {
    handlers = handlers || {};
    const panel = document.createElement('div');
    panel.id = 'mcb-panel';
    panel.innerHTML = `
<div class="mcb-head">
  <span class="mcb-ico">${ICON}</span>
  <span class="mcb-title">Deck Backup</span>
  <span class="mcb-status" data-status>Starting…</span>
  <button class="mcb-x" data-close title="Close" aria-label="Close">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
  </button>
</div>
<div class="mcb-body">
  <div class="mcb-phase" data-phase="discover">
    <div class="mcb-prow"><span class="mcb-plabel">Discovering decks</span><span class="mcb-pcount" data-count></span></div>
    <div class="mcb-track" data-track><div class="mcb-fill" data-fill></div></div>
    <div class="mcb-detail" data-detail>Waiting…</div>
  </div>
  <div class="mcb-phase mcb-off" data-phase="download">
    <div class="mcb-prow"><span class="mcb-plabel">Downloading decks</span><span class="mcb-pcount" data-count></span></div>
    <div class="mcb-track" data-track><div class="mcb-fill" data-fill></div></div>
    <div class="mcb-detail" data-detail>Waiting for the deck list…</div>
  </div>
</div>
<div class="mcb-controls" data-controls>
  <button class="mcb-btn2" data-pause>Pause</button>
  <button class="mcb-btn2" data-cancel>Cancel</button>
</div>
<details class="mcb-logwrap"><summary>Activity log</summary><div class="mcb-log" data-log></div></details>`;
    document.body.appendChild(panel);

    const q = (sel, root) => (root || panel).querySelector(sel);
    const dPhase = q('[data-phase="discover"]'),
      wPhase = q('[data-phase="download"]');
    const el = {
      status: q('[data-status]'),
      controls: q('[data-controls]'),
      pause: q('[data-pause]'),
      cancel: q('[data-cancel]'),
      close: q('[data-close]'),
      log: q('[data-log]'),
      d: {
        count: q('[data-count]', dPhase),
        track: q('[data-track]', dPhase),
        fill: q('[data-fill]', dPhase),
        detail: q('[data-detail]', dPhase),
      },
      w: {
        count: q('[data-count]', wPhase),
        track: q('[data-track]', wPhase),
        fill: q('[data-fill]', wPhase),
        detail: q('[data-detail]', wPhase),
      },
      dPhase,
      wPhase,
    };

    function setTrack(phase, frac) {
      if (frac == null) {
        phase.track.classList.add('mcb-indet');
        phase.fill.style.width = '';
      } else {
        phase.track.classList.remove('mcb-indet');
        phase.fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
      }
    }

    const remove = () => panel.remove();
    el.close.addEventListener('click', () => handlers.onClose && handlers.onClose());
    el.pause.addEventListener('click', () => handlers.onPauseToggle && handlers.onPauseToggle());
    el.cancel.addEventListener('click', () => {
      el.cancel.textContent = 'Cancelling…';
      el.cancel.disabled = true;
      el.pause.disabled = true;
      handlers.onCancel && handlers.onCancel();
    });

    return {
      remove,
      discover({ page, totalPages, found }) {
        el.status.textContent = 'Discovering…';
        setTrack(el.d, totalPages > 1 ? page / totalPages : null);
        el.d.count.textContent =
          totalPages > 1 ? page + ' / ' + totalPages : page ? 'page ' + page : '';
        el.d.detail.textContent = page
          ? 'Scanning list page ' +
            page +
            (totalPages > 1 ? ' of ' + totalPages : '') +
            ' · ' +
            found +
            ' deck' +
            (found === 1 ? '' : 's') +
            ' found'
          : 'Looking for your decks…';
      },
      discoverDone(total, pages) {
        el.d.track.classList.remove('mcb-indet');
        el.d.track.classList.add('mcb-done');
        el.d.fill.style.width = '100%';
        el.d.count.textContent = total + ' deck' + (total === 1 ? '' : 's');
        el.d.detail.textContent =
          'Found ' +
          total +
          ' deck' +
          (total === 1 ? '' : 's') +
          ' across ' +
          pages +
          ' page' +
          (pages === 1 ? '' : 's');
      },
      beginDownload(total) {
        el.wPhase.classList.remove('mcb-off');
        el.status.textContent = 'Downloading…';
        el.w.count.textContent = '0 / ' + total;
        el.w.detail.textContent = 'Starting downloads…';
        setTrack(el.w, 0);
      },
      download({ index, total, name, fail }) {
        setTrack(el.w, index / total);
        el.w.count.textContent = index + ' / ' + total;
        el.w.detail.textContent = 'Deck ' + index + ' of ' + total + ': ' + (name || '—');
        el.w.detail.classList.toggle('mcb-warn', fail > 0);
        if (fail > 0) el.w.detail.textContent += '  ·  ' + fail + ' failed';
      },
      setPaused(p) {
        el.pause.textContent = p ? 'Resume' : 'Pause';
        el.pause.classList.toggle('mcb-primary', p);
        el.status.textContent = p
          ? 'Paused'
          : el.wPhase.classList.contains('mcb-off')
            ? 'Discovering…'
            : 'Downloading…';
      },
      log(msg, isErr) {
        const d = document.createElement('div');
        if (isErr) d.className = 'mcb-err';
        d.textContent = msg;
        el.log.appendChild(d);
        el.log.scrollTop = el.log.scrollHeight;
      },
      finalize(status, data) {
        data = data || {};
        el.controls.innerHTML = '';
        const addBtn = (label, primary, onClick) => {
          const b = document.createElement('button');
          b.className = 'mcb-btn2' + (primary ? ' mcb-primary' : '');
          b.textContent = label;
          b.addEventListener('click', onClick);
          el.controls.appendChild(b);
          return b;
        };
        const close = () => {
          remove();
          if (handlers.onClose) handlers.onClose();
        };
        if (status === 'done') {
          el.status.textContent = 'Done';
          el.w.track.classList.add('mcb-done');
          el.w.fill.style.width = '100%';
          el.w.detail.classList.remove('mcb-warn');
          el.w.detail.textContent =
            'Saved ' +
            data.ok +
            ' deck' +
            (data.ok === 1 ? '' : 's') +
            (data.fail ? ' · ' + data.fail + ' failed' : '') +
            ' · ZIP downloaded';
          addBtn('Download again', true, data.rebuild);
          addBtn('Close', false, close);
        } else if (status === 'cancelled' && data.collected > 0) {
          el.status.textContent = 'Cancelled';
          el.w.detail.classList.remove('mcb-warn');
          el.w.detail.textContent =
            'Stopped. ' +
            data.collected +
            ' deck' +
            (data.collected === 1 ? '' : 's') +
            ' collected so far.';
          addBtn('Save ' + data.collected + ' collected', true, data.rebuild);
          addBtn('Discard', false, close);
        } else {
          el.status.textContent =
            status === 'error' ? 'Error' : status === 'empty' ? 'No decks' : 'Cancelled';
          el.w.detail.classList.toggle('mcb-warn', status === 'error');
          el.w.detail.textContent =
            status === 'error'
              ? 'Error: ' + (data.message || 'unknown')
              : status === 'empty'
                ? 'No decks found — are you logged in? Open marvelcdb.com/decks to check.'
                : 'Cancelled — nothing was downloaded.';
          addBtn('Close', false, close);
        }
      },
    };
  }

  MCB.ui = { ICON, injectStyles, makeLauncher, makePanel };
})();
