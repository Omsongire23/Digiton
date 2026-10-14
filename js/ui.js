// ui.js — DOM rendering, tabs, toasts, aria-live status updates

import { state, setState } from './state.js';
import { formatBytes, copyToClipboard, escapeHtml, truncate } from './utils.js';
import { compareHash, normalizeHash, isValidHash } from './hash.js';
import { downloadPdfReport } from './reportPdf.js';
import { downloadJsonReport } from './reportJson.js';
import { runEla, clearElaCache } from './ela.js';
import { debounce } from './utils.js';

// ── DOM refs ──────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── TABS ──────────────────────────────────────────────────────────

export function initTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));

  function activateTab(idx) {
    tabs.forEach((t, i) => {
      const active = i === idx;
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.tabIndex = active ? 0 : -1;
      if (panels[i]) panels[i].hidden = !active;
    });
    setState({ view: { ...state.view, tab: tabs[idx].dataset.tab } });
  }

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activateTab(idx));
    tab.addEventListener('keydown', e => {
      let next = idx;
      if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else return;
      e.preventDefault();
      activateTab(next);
      tabs[next].focus();
    });
  });

  activateTab(0);
  return { activateTab, tabs };
}

// ── TOASTS ──────────────────────────────────────────────────────

const toastContainer = document.querySelector('.toast-container');

export function showToast(message, type = 'info', duration = 2800) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── ARIA LIVE ────────────────────────────────────────────────────

export function announce(msg) {
  const el = $('aria-live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 50);
}

// ── EVIDENCE STRIP ───────────────────────────────────────────────

export function renderEvidenceStrip() {
  const { file, image, metadata, hash, status } = state;
  const strip = $('evidence-strip');
  if (!strip) return;

  const dash = '—';

  const cards = [
    { label: 'Filename',    value: file?.name || dash, mono: false },
    { label: 'Format',      value: image?.format || dash },
    { label: 'Dimensions',  value: image ? `${image.width} × ${image.height}` : dash },
    { label: 'File size',   value: file ? formatBytes(file.size) : dash },
    { label: 'EXIF tags',   value: status === 'processing' ? 'Extracting…' : (file ? String(metadata.count) : dash) },
    {
      label: 'SHA-256',
      value: hash.sha256 ? hash.sha256.slice(0, 16) + '…' : (status === 'processing' ? 'Computing…' : dash),
      mono: true,
    },
  ];

  strip.innerHTML = cards.map(c => `
    <div class="ev-card">
      <div class="ev-label">${escapeHtml(c.label)}</div>
      <div class="ev-value ${c.mono ? 'mono' : ''}">${escapeHtml(c.value)}</div>
    </div>
  `).join('');
}

// ── OVERVIEW TAB ──────────────────────────────────────────────────

export function renderOverview() {
  const container = $('tab-overview');
  if (!container) return;

  const { image, file, overall, status, originalUrl } = state;

  if (status === 'idle') {
    container.innerHTML = `
      <div class="idle-placeholder">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 16px;color:var(--border-strong)">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <h3>Upload an image to begin</h3>
        <p>Drop a JPEG, PNG, or WebP image onto the upload zone above.</p>
        <ul>
          <li>EXIF and image metadata extraction</li>
          <li>SHA-256 integrity hash (+ reference comparison)</li>
          <li>JPEG Error Level Analysis (ELA)</li>
          <li>Neutral overall result summary</li>
          <li>Downloadable PDF and JSON reports</li>
        </ul>
      </div>`;
    return;
  }

  let verdictHtml = '';
  if (overall) {
    const colors = {
      'no-notable-indicators': { border: 'var(--ok)', icon: verdictIconOk() },
      'review-suggested':      { border: 'var(--warn)', icon: verdictIconWarn() },
      'incomplete':            { border: 'var(--info)', icon: verdictIconInfo() },
    };
    const { border, icon } = colors[overall.level] || colors['incomplete'];

    const indicatorsHtml = overall.indicators.map(ind => `
      <li class="verdict-indicator tone-${ind.tone}">
        <span class="indicator-label">${escapeHtml(ind.label)}:</span>
        <span class="indicator-detail">${escapeHtml(ind.detail)}</span>
      </li>`).join('');

    const limitationsHtml = overall.limitations.map(l => `<li>${escapeHtml(l)}</li>`).join('');

    verdictHtml = `
      <div class="verdict-card ${overall.level}" style="--_border:${border}">
        <div class="verdict-header">
          <div class="verdict-icon">${icon}</div>
          <div>
            <div class="verdict-title">${escapeHtml(overall.title)}</div>
          </div>
        </div>
        <p class="verdict-summary">${escapeHtml(overall.summary)}</p>
        <ul class="verdict-indicators">${indicatorsHtml}</ul>
        <div class="verdict-limitations">
          <div class="verdict-limitations-title">Limitations</div>
          <ul>${limitationsHtml}</ul>
        </div>
      </div>`;
  } else if (status === 'processing') {
    verdictHtml = `<div class="verdict-card incomplete">
      <div class="verdict-header"><div class="spin"></div><div class="verdict-title" style="color:var(--text-muted)">Analysing…</div></div>
    </div>`;
  }

  const propsHtml = image ? `
    <div class="table-wrap mt-md">
      <table class="data-table">
        <thead><tr><th>Property</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Format</td><td>${escapeHtml(image.format)}</td></tr>
          <tr><td>Dimensions</td><td>${image.width} × ${image.height} px</td></tr>
          <tr><td>Color mode</td><td>${escapeHtml(image.colorMode)}</td></tr>
          <tr><td>File size</td><td>${formatBytes(file.size)} (${file.size} bytes)</td></tr>
          ${file.lastModified ? `<tr><td>Last modified</td><td>${new Date(file.lastModified).toLocaleString()}</td></tr>` : ''}
        </tbody>
      </table>
    </div>` : '';

  const imgHtml = originalUrl
    ? `<div class="img-preview mt-md"><img src="${escapeHtml(originalUrl)}" alt="Preview of uploaded image: ${escapeHtml(file?.name || '')}" /></div>`
    : '';

  const dlHtml = overall ? `
    <div class="flex gap-md mt-lg" style="flex-wrap:wrap">
      <button class="btn btn-primary btn-lg" id="btn-dl-pdf-overview">
        ${svgDownload()} Download PDF Report
      </button>
      <button class="btn btn-secondary btn-lg" id="btn-dl-json-overview">
        ${svgDownload()} Download JSON
      </button>
    </div>` : '';

  container.innerHTML = verdictHtml + imgHtml + propsHtml + dlHtml;

  // Wire download buttons
  $('btn-dl-pdf-overview')?.addEventListener('click', triggerPdf);
  $('btn-dl-json-overview')?.addEventListener('click', triggerJson);
}

// ── METADATA TAB ──────────────────────────────────────────────────

export function renderMetadata() {
  const container = $('tab-metadata');
  if (!container) return;
  const { metadata, status, file } = state;

  if (status === 'idle') { container.innerHTML = '<p class="text-muted text-sm">Upload an image to see metadata.</p>'; return; }

  if (status === 'processing' && metadata.count === 0 && !metadata.error) {
    container.innerHTML = '<p class="text-muted text-sm"><span class="spin"></span> Extracting metadata…</p>';
    return;
  }

  let html = '';

  // GPS warning
  if (metadata.gps) {
    html += `<div class="interp-note" style="margin-bottom:var(--gap)">
      <strong>Location data present.</strong> GPS coordinates found in EXIF.
      These are masked below by default.
      Use the GPS reveal toggle or enable GPS in the Report tab to include them in exports.
    </div>`;
  }

  if (metadata.error) {
    html += `<div class="interp-note" style="margin-bottom:var(--gap)">EXIF read error: ${escapeHtml(metadata.error)}</div>`;
  }

  if (metadata.tags.length === 0) {
    html += `<div class="empty-state">
      <strong>No EXIF metadata found.</strong>
      This is common for screenshots, web images, and re-saved files and is not evidence of tampering.
    </div>`;
  } else {
    // Search input
    html += `
      <div class="flex" style="gap:var(--gap);align-items:center;margin-bottom:var(--gap)">
        <div class="search-wrap flex-1">
          ${svgSearch()}
          <input class="input" type="search" id="meta-search" placeholder="Filter tags…" aria-label="Filter metadata tags">
        </div>
        <button class="btn btn-sm btn-ghost" id="btn-copy-all-meta">Copy all</button>
      </div>
      <p class="meta-filter-count" id="meta-filter-count">${metadata.tags.length} tags</p>
      <div class="table-wrap" id="meta-table-wrap">
        ${buildMetaTable(metadata.tags, metadata.gps)}
      </div>`;
  }

  container.innerHTML = html;

  // Wire search
  const searchInput = $('meta-search');
  searchInput?.addEventListener('input', debounce(() => {
    const q = searchInput.value.toLowerCase().trim();
    filterMetaTable(q);
  }, 150));

  // Wire copy all
  $('btn-copy-all-meta')?.addEventListener('click', async () => {
    const all = metadata.tags.map(t => `${t.key}: ${t.value}`).join('\n');
    const ok = await copyToClipboard(all);
    showToast(ok ? 'Metadata copied to clipboard' : 'Copy failed', ok ? 'ok' : 'error');
  });
}

function buildMetaTable(tags, gps) {
  let currentGroup = '', html = '<table class="data-table"><thead><tr><th>Group</th><th>Tag</th><th>Value</th><th></th></tr></thead><tbody>';
  for (const tag of tags) {
    const isGps = tag.group === 'GPS';
    let valDisplay = escapeHtml(truncate(tag.value, 300));
    if (isGps && gps) {
      valDisplay = `<span class="gps-mask" data-revealed="false">••••••••</span>
        <button class="btn btn-sm btn-ghost" style="margin-left:6px" onclick="this.previousElementSibling.textContent=this.previousElementSibling.dataset.revealed==='false'?'${escapeHtml(tag.value)}':'••••••••';this.previousElementSibling.dataset.revealed=this.previousElementSibling.dataset.revealed==='false'?'true':'false';this.textContent=this.previousElementSibling.dataset.revealed==='true'?'Hide':'Reveal'">Reveal</button>`;
    }
    html += `<tr data-group="${escapeHtml(tag.group)}" data-key="${escapeHtml(tag.key)}" data-val="${escapeHtml(tag.value)}">
      <td class="text-muted text-xs">${escapeHtml(tag.group)}</td>
      <td class="fw-600">${escapeHtml(tag.key)}</td>
      <td class="mono">${valDisplay}</td>
      <td><button class="copy-btn" title="Copy value" onclick="navigator.clipboard.writeText('${escapeHtml(tag.value).replace(/'/g,"\\'")}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='Copy',1200)})">Copy</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function filterMetaTable(query) {
  const wrap = $('meta-table-wrap');
  const count = $('meta-filter-count');
  if (!wrap) return;
  const rows = wrap.querySelectorAll('tbody tr');
  let visible = 0;
  rows.forEach(row => {
    const matches = !query
      || row.dataset.group?.toLowerCase().includes(query)
      || row.dataset.key?.toLowerCase().includes(query)
      || row.dataset.val?.toLowerCase().includes(query);
    row.style.display = matches ? '' : 'none';
    if (matches) visible++;
  });
  if (count) count.textContent = query ? `${visible} of ${state.metadata.tags.length} tags` : `${state.metadata.tags.length} tags`;
}

// ── ELA TAB ───────────────────────────────────────────────────────

let _elaBitmap = null;
let _elaFormat  = null;

export function setElaBitmap(bitmap, format) {
  if (_elaBitmap !== bitmap) {
    clearElaCache();
  }
  _elaBitmap = bitmap;
  _elaFormat  = format;
}

export function renderElaTab() {
  const container = $('tab-ela');
  if (!container) return;
  const { ela, status } = state;

  if (status === 'idle') { container.innerHTML = '<p class="text-muted text-sm">Upload an image to run ELA.</p>'; return; }

  const viewLabels = { original: 'Original', ela: 'ELA', sidebyside: 'Side by side' };
  const currentView = state.view.compare || 'ela';

  container.innerHTML = `
    <div class="flex" style="gap:var(--gap);align-items:center;flex-wrap:wrap;margin-bottom:var(--gap)">
      <div class="flex-1">
        <div class="slider-wrap">
          <div class="slider-row">
            <label class="slider-label" for="ela-quality">JPEG quality</label>
            <span class="slider-value" id="ela-quality-val">${ela.quality}</span>
          </div>
          <input class="slider" type="range" id="ela-quality" min="50" max="100" step="1" value="${ela.quality}" aria-label="ELA JPEG quality">
        </div>
      </div>
      <div class="flex-1">
        <div class="slider-wrap">
          <div class="slider-row">
            <label class="slider-label" for="ela-amp">Amplification</label>
            <span class="slider-value" id="ela-amp-val">${ela.amplification}</span>
          </div>
          <input class="slider" type="range" id="ela-amp" min="1" max="40" step="1" value="${ela.amplification}" aria-label="ELA amplification">
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" id="ela-reset-btn">Reset</button>
    </div>

    <div class="seg-control" role="group" aria-label="ELA view mode" style="margin-bottom:var(--gap)">
      <button class="seg-btn ${currentView === 'original' ? 'active' : ''}" data-view="original">Original</button>
      <button class="seg-btn ${currentView === 'ela' ? 'active' : ''}" data-view="ela">ELA</button>
      <button class="seg-btn ${currentView === 'sidebyside' ? 'active' : ''}" data-view="sidebyside">Side by side</button>
    </div>

    <div id="ela-canvas-area">
      ${renderElaCanvasArea(ela, currentView)}
    </div>

    ${ela.stats ? renderElaStats(ela.stats) : ''}

    <div class="method-note mt-md">
      ${escapeHtml(ela.workingCopyNote || 'ELA computed from a derived copy re-encoded as JPEG. Original file bytes are unchanged.')}
    </div>
    <div class="interp-note mt-md">
      ELA differences can come from compression, texture, resizing, and prior editing. Treat as a clue for further examination — not conclusive evidence. ELA values differ between browser engines.
    </div>
  `;

  // Wire sliders
  const qualitySlider = $('ela-quality');
  const ampSlider = $('ela-amp');
  const qualityVal  = $('ela-quality-val');
  const ampVal      = $('ela-amp-val');

  const rerunEla = debounce(async () => {
    if (!_elaBitmap) return;
    setState({ ela: { ...state.ela, dataUrl: null, stats: null } });
    const updEl = $('ela-canvas-area');
    if (updEl) updEl.innerHTML = '<p class="text-muted text-sm" style="padding:24px"><span class="spin"></span> Updating…</p>';
    const myRun = state.runId;
    const result = await runEla(_elaBitmap, _elaFormat, state.ela.quality, state.ela.amplification, () => state.runId);
    if (state.runId !== myRun || !result) return;
    setState({ ela: { ...state.ela, dataUrl: result.dataUrl, stats: result.stats, workingCopyNote: result.note, resized: result.resized, workingSize: result.workingSize } });
    renderElaTab();
    renderSidebar();
  }, 150);

  qualitySlider?.addEventListener('input', () => {
    qualityVal.textContent = qualitySlider.value;
    setState({ ela: { ...state.ela, quality: parseInt(qualitySlider.value) } });
    rerunEla();
  });
  ampSlider?.addEventListener('input', () => {
    ampVal.textContent = ampSlider.value;
    setState({ ela: { ...state.ela, amplification: parseInt(ampSlider.value) } });
    rerunEla();
  });

  // View mode
  container.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ view: { ...state.view, compare: btn.dataset.view } });
      container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const area = $('ela-canvas-area');
      if (area) area.innerHTML = renderElaCanvasArea(state.ela, btn.dataset.view);
    });
  });

  // Reset
  $('ela-reset-btn')?.addEventListener('click', () => {
    setState({ ela: { ...state.ela, quality: 90, amplification: 15 } });
    rerunEla();
    renderElaTab();
  });
}

function renderElaCanvasArea(ela, view) {
  if (!ela.dataUrl) return '<p class="text-muted text-sm" style="padding:24px"><span class="spin"></span> Computing ELA…</p>';

  const origImg = state.originalUrl
    ? `<img src="${escapeHtml(state.originalUrl)}" alt="Original uploaded image" style="max-width:100%;max-height:500px;object-fit:contain;border-radius:var(--radius-sm)">`
    : '';
  const elaImg = `<img src="${escapeHtml(ela.dataUrl)}" alt="ELA visualization — brighter areas indicate higher compression difference" style="max-width:100%;max-height:500px;object-fit:contain;border-radius:var(--radius-sm)">`;

  if (view === 'original') return `<div class="ela-canvas-wrap">${origImg}</div>`;
  if (view === 'ela') return `<div class="ela-canvas-wrap">${elaImg}</div>`;
  // sidebyside
  return `<div class="ela-side-by-side">
    <div class="ela-canvas-wrap"><p class="text-xs text-muted" style="padding:6px 8px">Original</p>${origImg}</div>
    <div class="ela-canvas-wrap"><p class="text-xs text-muted" style="padding:6px 8px">ELA visualization</p>${elaImg}</div>
  </div>`;
}

function renderElaStats(stats) {
  return `
    <div class="ela-stats-grid">
      <div class="ela-stat"><div class="ela-stat-val">${stats.mean}</div><div class="ela-stat-label">Mean diff</div></div>
      <div class="ela-stat"><div class="ela-stat-val">${stats.p95}</div><div class="ela-stat-label">95th pct</div></div>
      <div class="ela-stat"><div class="ela-stat-val">${stats.max}</div><div class="ela-stat-label">Max diff</div></div>
      <div class="ela-stat"><div class="ela-stat-val">${stats.pctAboveThreshold.toFixed(1)}%</div><div class="ela-stat-label">Above ≥${stats.threshold}</div></div>
      <div class="ela-stat"><div class="ela-stat-val" style="font-size:var(--text-sm)">${stats.hotRegion.ratioToGlobalMean}×</div><div class="ela-stat-label">Hot region ratio</div></div>
      <div class="ela-stat"><div class="ela-stat-val" style="font-size:var(--text-xs)">R${stats.hotRegion.row}/C${stats.hotRegion.col}</div><div class="ela-stat-label">Hottest cell</div></div>
    </div>`;
}

// ── INTEGRITY TAB ─────────────────────────────────────────────────

export function renderIntegrity() {
  const container = $('tab-integrity');
  if (!container) return;
  const { hash, status } = state;

  if (status === 'idle') { container.innerHTML = '<p class="text-muted text-sm">Upload an image to compute SHA-256.</p>'; return; }

  const hashDisplay = hash.sha256
    ? `<div class="hash-display" id="hash-display">${escapeHtml(hash.sha256)}</div>
       <div class="flex gap-sm mt-sm" style="align-items:center">
         <button class="btn btn-sm btn-secondary" id="btn-copy-hash">Copy hash</button>
         ${hash.computedAt ? `<span class="text-xs text-muted">Computed ${new Date(hash.computedAt).toLocaleTimeString()}</span>` : ''}
       </div>
       <p class="text-xs text-muted mt-sm">Hash computed from the exact bytes of the uploaded file.</p>`
    : `<p class="text-muted text-sm"><span class="spin"></span> Computing hash…</p>`;

  // Reference hash comparison
  let refHtml = '';
  if (hash.sha256) {
    let matchHtml = '';
    if (hash.reference) {
      const norm = normalizeHash(hash.reference);
      if (!isValidHash(norm)) {
        matchHtml = `<p class="input-msg error">Reference hash must be exactly 64 hexadecimal characters.</p>`;
      } else if (hash.match === true) {
        matchHtml = `<div class="match-result match">✓ Matches the reference hash — file is byte-identical to the recorded baseline.</div>`;
      } else if (hash.match === false) {
        matchHtml = `<div class="match-result mismatch">⚠ Does not match the reference hash — the file differs from the recorded baseline.</div>`;
      }
    }

    refHtml = `
      <div class="divider"></div>
      <h3 class="section-title">Reference hash comparison</h3>
      <label class="input-label" for="ref-hash-input">Paste a previously recorded SHA-256</label>
      <input class="input mono" type="text" id="ref-hash-input" placeholder="64 hex characters (e.g. ba7816bf…)" value="${escapeHtml(hash.reference || '')}" aria-describedby="ref-hash-msg">
      <div id="ref-hash-msg">${matchHtml}</div>
      <p class="text-xs text-muted mt-sm">Accepts: raw 64-char hex, uppercase, whitespace, or <code>sha256:</code> prefix.</p>`;
  }

  const explanationHtml = `
    <div class="divider"></div>
    <div class="method-note">
      SHA-256 verifies byte-level consistency against a previously recorded baseline. It cannot establish the image's earlier history, origin, or authenticity. 
      Record this hash at acquisition time, then re-hash the same file later to confirm it has not changed.
    </div>`;

  container.innerHTML = `
    <h3 class="section-title">SHA-256 digest</h3>
    ${hashDisplay}
    ${refHtml}
    ${explanationHtml}`;

  // Wire copy
  $('btn-copy-hash')?.addEventListener('click', async () => {
    const ok = await copyToClipboard(hash.sha256);
    showToast(ok ? 'Hash copied to clipboard' : 'Copy failed', ok ? 'ok' : 'error');
  });

  // Wire reference input
  $('ref-hash-input')?.addEventListener('input', e => {
    const raw = e.target.value;
    setState({ hash: { ...state.hash, reference: raw } });
    if (!raw.trim()) {
      setState({ hash: { ...state.hash, reference: '', match: null } });
      renderIntegrity();
      renderSidebar();
      return;
    }
    const result = compareHash(hash.sha256, raw);
    if (result.error) {
      setState({ hash: { ...state.hash, match: null } });
    } else {
      setState({ hash: { ...state.hash, match: result.match } });
    }
    renderIntegrity();
    renderSidebar();
  });
}

// ── REPORT TAB ────────────────────────────────────────────────────

export function renderReportTab() {
  const container = $('tab-report');
  if (!container) return;
  const { overall, status, options } = state;
  const ready = status === 'ready';

  container.innerHTML = `
    <h3 class="section-title">Report contents</h3>
    <ul class="report-section-list">
      <li>Overall result (level, summary, indicator list)</li>
      <li>Evidence details (filename, format, dimensions, size)</li>
      <li>SHA-256 integrity hash + reference comparison</li>
      <li>Original image thumbnail</li>
      <li>EXIF metadata table (grouped)</li>
      <li>ELA visualization + statistics</li>
      <li>Findings and warnings</li>
      <li>Methodology, limitations, and conclusion</li>
    </ul>

    <label class="checkbox-label" style="margin-bottom:var(--gap)">
      <input type="checkbox" id="gps-opt" ${options.includeGpsInReports ? 'checked' : ''}>
      <span>Include GPS coordinates in reports <span class="text-muted text-xs">(GPS data, if present, is excluded by default to protect privacy)</span></span>
    </label>

    <div class="flex gap-md" style="flex-wrap:wrap">
      <button class="btn btn-primary btn-lg ${ready ? '' : 'disabled'}" id="btn-dl-pdf-report" ${ready ? '' : 'aria-disabled="true"'} title="${ready ? 'Download PDF' : 'Analysis must complete first'}">
        ${svgDownload()} Download PDF Report
      </button>
      <button class="btn btn-secondary btn-lg ${ready ? '' : 'disabled'}" id="btn-dl-json-report" ${ready ? '' : 'aria-disabled="true"'} title="${ready ? 'Download JSON' : 'Analysis must complete first'}">
        ${svgDownload()} Download JSON
      </button>
    </div>
    ${!ready ? `<p class="text-xs text-muted mt-sm">Downloads are enabled once analysis is complete.</p>` : ''}
    <div id="report-gen-status" class="text-sm text-muted mt-md"></div>
  `;

  $('gps-opt')?.addEventListener('change', e => {
    setState({ options: { ...state.options, includeGpsInReports: e.target.checked } });
  });

  $('btn-dl-pdf-report')?.addEventListener('click', triggerPdf);
  $('btn-dl-json-report')?.addEventListener('click', triggerJson);
}

// ── SIDEBAR ──────────────────────────────────────────────────────

export function renderSidebar() {
  const sidebar = $('details-sidebar');
  if (!sidebar) return;
  const { file, image, metadata, hash, ela, overall, status } = state;

  const dash = '—';
  const facts = [
    ['Filename', file?.name ? truncate(file.name, 20) : dash],
    ['Type', image?.format || dash],
    ['Size', file ? formatBytes(file.size) : dash],
    ['Dimensions', image ? `${image.width}×${image.height}` : dash],
    ['SHA-256', hash.sha256 ? hash.sha256.slice(0, 10) + '…' : (status === 'processing' ? 'Computing…' : dash)],
    ['EXIF tags', String(metadata.count || (status === 'processing' ? '…' : 0))],
    ['GPS', metadata.gps ? 'Present' : (file ? 'None' : dash)],
  ];

  const checks = [
    { label: 'Metadata',  done: metadata.count >= 0 && status !== 'idle', ok: !metadata.error },
    { label: 'SHA-256',   done: !!hash.sha256,   ok: true },
    { label: 'ELA',       done: !!ela.dataUrl,   ok: true },
    { label: 'Overall',   done: !!overall,       ok: overall?.level !== 'incomplete' },
  ];

  const ready = status === 'ready';

  sidebar.innerHTML = `
    <div class="card">
      <div class="card-body-sm">
        <div class="sidebar-section">
          <div class="sidebar-section-title">Evidence facts</div>
          <ul class="sidebar-facts">
            ${facts.map(([k, v]) => `<li class="sidebar-fact"><span class="sidebar-fact-key">${escapeHtml(k)}</span><span class="sidebar-fact-val">${escapeHtml(v)}</span></li>`).join('')}
          </ul>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-section-title">Analysis status</div>
          <ul class="status-list">
            ${checks.map(c => `
              <li class="status-item">
                <span class="status-dot ${c.done ? (c.ok ? 'ok' : 'warn') : (status === 'processing' ? 'active' : '')}"></span>
                ${escapeHtml(c.label)} ${c.done ? (c.ok ? '✓' : '⚠') : (status === 'processing' ? '…' : '')}
              </li>`).join('')}
          </ul>
        </div>

        <div class="sidebar-section" style="margin-top:var(--gap)">
          <button class="btn btn-primary btn-full ${ready ? '' : 'disabled'}" id="sidebar-dl-pdf" ${ready ? '' : 'aria-disabled="true"'}>
            ${svgDownload()} PDF Report
          </button>
          <button class="btn btn-secondary btn-full mt-sm ${ready ? '' : 'disabled'}" id="sidebar-dl-json" ${ready ? '' : 'aria-disabled="true"'}>
            ${svgDownload()} JSON Report
          </button>
        </div>
      </div>
    </div>`;

  $('sidebar-dl-pdf')?.addEventListener('click', triggerPdf);
  $('sidebar-dl-json')?.addEventListener('click', triggerJson);
}

// ── REPORT TRIGGERS ───────────────────────────────────────────────

async function triggerPdf() {
  if (state.status !== 'ready') return;
  const statusEl = $('report-gen-status');
  if (statusEl) statusEl.innerHTML = '<span class="spin"></span> Generating PDF…';
  try {
    await downloadPdfReport(state);
    showToast('PDF report downloaded', 'ok');
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    showToast('PDF generation failed: ' + err.message, 'error', 5000);
    if (statusEl) statusEl.textContent = 'PDF generation failed: ' + err.message;
  }
}

function triggerJson() {
  if (state.status !== 'ready') return;
  try {
    downloadJsonReport(state);
    showToast('JSON report downloaded', 'ok');
  } catch (err) {
    showToast('JSON generation failed: ' + err.message, 'error', 5000);
  }
}

// ── SVG ICONS (inline) ────────────────────────────────────────────

function verdictIconOk() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`;
}
function verdictIconWarn() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
}
function verdictIconInfo() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--info)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}
function svgDownload() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}
function svgSearch() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-subtle)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
}

// ── FULL RE-RENDER ────────────────────────────────────────────────

export function renderAll() {
  renderEvidenceStrip();
  renderOverview();
  renderMetadata();
  renderElaTab();
  renderIntegrity();
  renderReportTab();
  renderSidebar();
}
