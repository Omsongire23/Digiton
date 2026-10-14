// main.js — bootstrap, wires all modules together

import { state, setState, newRun } from './state.js';
import { initUpload } from './upload.js';
import { getImageInfo } from './imageInfo.js';
import { extractMetadata } from './metadata.js';
import { computeSha256, compareHash } from './hash.js';
import { runEla, clearElaCache } from './ela.js';
import { computeVerdict } from './verdict.js';
import {
  initTabs, renderAll, renderEvidenceStrip,
  renderOverview, renderMetadata, renderElaTab,
  renderIntegrity, renderReportTab, renderSidebar,
  showToast, announce, setElaBitmap,
} from './ui.js';
import { subscribe } from './state.js';

// ── Boot ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  renderAll();
  wireUpload();
});

// ── Upload wiring ────────────────────────────────────────────────

function wireUpload() {
  const dropzone        = document.getElementById('dropzone');
  const dropzoneCompact = document.getElementById('dropzone-compact');
  const fileInput       = document.getElementById('file-input');
  const browseBtn       = document.getElementById('browse-btn');
  const replaceBtn      = document.getElementById('replace-btn');
  const resetBtn        = document.getElementById('reset-btn');
  const statusEl        = document.getElementById('dropzone-status');

  initUpload({
    dropzone, dropzoneCompact, fileInput, browseBtn, replaceBtn, resetBtn,
    statusEl,
    onFile: handleNewFile,
    onReset: handleReset,
  });
}

// ── Main analysis pipeline ────────────────────────────────────────

async function handleNewFile(file, detectedFormat, mimeWarning) {
  // Clear previous state & revoke old URL
  if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
  clearElaCache();

  const run = newRun();
  const warnings = mimeWarning ? [mimeWarning] : [];

  // Create preview URL immediately so the image shows right away
  const objUrl = URL.createObjectURL(file);

  setState({
    status: 'processing',
    file: { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified },
    originalUrl: objUrl,
    image: null,
    metadata: { tags: [], count: 0, gps: null, error: null },
    hash: { sha256: null, computedAt: null, reference: state.hash.reference || '', match: null },
    ela: { ...state.ela, dataUrl: null, stats: null, workingCopyNote: '', resized: false, workingSize: null },
    overall: null,
    errors: [],
    warnings,
  });

  announce('Image loaded. Analysis in progress.');
  renderAll();

  // 1. Read arrayBuffer once (shared by SHA-256 and EXIF)
  const arrayBufferPromise = file.arrayBuffer();

  // 2. Decode image directly from File in parallel (browser native decoder)
  const bitmapPromise = createImageBitmap(file, { imageOrientation: 'from-image' });

  // 3. SHA-256 concurrent pipeline
  const hashPromise = arrayBufferPromise.then(async (buf) => {
    if (state.runId !== run) return null;
    const sha256 = await computeSha256(buf);
    if (state.runId !== run) return null;
    const now = new Date().toISOString();
    let match = null;
    if (state.hash.reference) {
      const result = compareHash(sha256, state.hash.reference);
      if (!result.error) match = result.match;
    }
    setState({ hash: { ...state.hash, sha256, computedAt: now, match } });
    renderIntegrity();
    renderEvidenceStrip();
    return sha256;
  }).catch((err) => {
    if (state.runId !== run) return;
    setState({ errors: [...state.errors, `SHA-256: ${err.message}`] });
    showToast('SHA-256 computation failed: ' + err.message, 'error', 5000);
  });

  // 4. EXIF Metadata concurrent pipeline
  const metaPromise = arrayBufferPromise.then(async (buf) => {
    if (state.runId !== run) return null;
    const meta = await extractMetadata(buf);
    if (state.runId !== run) return null;
    setState({ metadata: meta });
    if (meta.error) {
      setState({ warnings: [...state.warnings, `EXIF: ${meta.error}`] });
    }
    renderMetadata();
    renderEvidenceStrip();
    updateMetaBadge(meta.count);
    return meta;
  }).catch((err) => {
    if (state.runId !== run) return;
    setState({ warnings: [...state.warnings, `EXIF: ${err.message}`] });
  });

  // 5. Await bitmap decode & compute image info
  let bitmap;
  try {
    bitmap = await bitmapPromise;
  } catch (err) {
    if (state.runId !== run) return;
    setState({ status: 'error', errors: [`Decoding failed: ${err.message}`] });
    renderAll();
    return;
  }
  if (state.runId !== run) { bitmap.close(); return; }

  const imageInfo = await getImageInfo(file, bitmap, detectedFormat);
  if (state.runId !== run) { bitmap.close(); return; }
  setState({ image: imageInfo });
  renderEvidenceStrip();
  renderOverview();

  // 6. ELA Pipeline (runs immediately as bitmap is ready, concurrently with remaining hash/meta)
  setElaBitmap(bitmap, detectedFormat);
  const elaPromise = runEla(bitmap, detectedFormat, state.ela.quality, state.ela.amplification, () => state.runId)
    .then((elaResult) => {
      if (state.runId !== run || !elaResult) return;
      setState({
        ela: {
          ...state.ela,
          dataUrl: elaResult.dataUrl,
          stats: elaResult.stats,
          workingCopyNote: elaResult.note,
          resized: elaResult.resized,
          workingSize: elaResult.workingSize,
        },
      });
      renderElaTab();
      renderEvidenceStrip();
    })
    .catch((err) => {
      if (state.runId !== run) return;
      setState({ errors: [...state.errors, `ELA: ${err.message}`] });
      showToast('ELA failed: ' + err.message, 'error', 5000);
    });

  // Wait for all concurrent pipelines to finish
  await Promise.all([hashPromise, metaPromise, elaPromise]);

  if (state.runId !== run) return;

  // 7. Overall Verdict calculation
  const verdict = computeVerdict(state);
  setState({ overall: verdict, status: 'ready' });

  renderAll();
  announce(`Analysis complete. Overall result: ${verdict.title}`);
}

// ── Reset ────────────────────────────────────────────────────────

function handleReset() {
  const oldUrl = state.originalUrl;
  newRun(); // cancels any in-flight work
  clearElaCache();

  setState({
    status: 'idle',
    file: null,
    originalUrl: null,
    image: null,
    metadata: { tags: [], count: 0, gps: null, error: null },
    hash: { sha256: null, computedAt: null, reference: '', match: null },
    ela: { quality: 90, amplification: 15, workingCopyNote: '', resized: false, workingSize: null, dataUrl: null, stats: null },
    overall: null,
    errors: [],
    warnings: [],
  });

  setElaBitmap(null, null);
  if (oldUrl) URL.revokeObjectURL(oldUrl);

  updateMetaBadge(0);
  renderAll();
  announce('Workspace cleared.');
}

// ── Utility: update metadata tab badge ──────────────────────────

function updateMetaBadge(count) {
  const badge = document.querySelector('[data-tab="metadata"] .tab-count');
  if (badge) badge.textContent = count > 0 ? count : '';
}
