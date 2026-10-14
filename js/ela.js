// ela.js — Error Level Analysis using HTML Canvas (High-Performance Engine)

import { yieldToUI } from './utils.js';

const MAX_SIDE = 2048; // Downscale working copy if longest side > this

// Recompression cache: avoids re-encoding and re-decoding JPEG when only amplification changes
let _cachedRecomp = null; // { bitmap, format, quality, wW, wH, origData, recompData }

/** Clear the ELA recompression cache (called on image change or reset). */
export function clearElaCache() {
  _cachedRecomp = null;
}

/**
 * Run ELA on a decoded ImageBitmap.
 *
 * @param {ImageBitmap} bitmap   - EXIF-orientation-applied decoded image
 * @param {string}      format   - detected format ('JPEG'|'PNG'|'WEBP')
 * @param {number}      quality  - JPEG re-encode quality (50-100)
 * @param {number}      amp      - amplification factor (1-40)
 * @param {function}    getRunId - () => current state.runId
 * @returns {Promise<{dataUrl, stats, workingSize, resized, note}|null>}
 */
export async function runEla(bitmap, format, quality, amp, getRunId) {
  const currentRunId = getRunId ? getRunId() : null;

  const origW = bitmap.width;
  const origH = bitmap.height;

  // 1. Working copy size (downscale if longest side > 2048)
  let wW = origW, wH = origH;
  let resized = false;
  const maxSide = Math.max(origW, origH);
  if (maxSide > MAX_SIDE) {
    const scale = MAX_SIDE / maxSide;
    wW = Math.round(origW * scale);
    wH = Math.round(origH * scale);
    resized = true;
  }

  const total = wW * wH;

  // Check if we can reuse the cached recompressed pixel buffers
  let origData, recompData;
  const canReuse = _cachedRecomp &&
    _cachedRecomp.bitmap === bitmap &&
    _cachedRecomp.format === format &&
    _cachedRecomp.quality === quality &&
    _cachedRecomp.wW === wW &&
    _cachedRecomp.wH === wH;

  if (canReuse) {
    origData = _cachedRecomp.origData;
    recompData = _cachedRecomp.recompData;
  } else {
    // 2. Draw working copy onto canvas (white background for alpha sources)
    const origCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(wW, wH)
      : document.createElement('canvas');
    origCanvas.width = wW;
    origCanvas.height = wH;
    const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });

    if (format === 'PNG' || format === 'WEBP') {
      origCtx.fillStyle = '#ffffff';
      origCtx.fillRect(0, 0, wW, wH);
    }
    origCtx.drawImage(bitmap, 0, 0, wW, wH);

    if (getRunId && getRunId() !== currentRunId) return null;

    // 3. Re-encode to JPEG at the given quality, then decode
    let blob;
    if (origCanvas.convertToBlob) {
      blob = await origCanvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    } else {
      blob = await new Promise(res => origCanvas.toBlob(res, 'image/jpeg', quality / 100));
    }

    if (getRunId && getRunId() !== currentRunId) return null;

    const recompBitmap = await createImageBitmap(blob);

    if (getRunId && getRunId() !== currentRunId) {
      recompBitmap.close();
      return null;
    }

    // 4. Draw recompressed image
    const recompCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(wW, wH)
      : document.createElement('canvas');
    recompCanvas.width = wW;
    recompCanvas.height = wH;
    const recompCtx = recompCanvas.getContext('2d', { willReadFrequently: true });
    recompCtx.drawImage(recompBitmap, 0, 0);
    recompBitmap.close();

    origData = origCtx.getImageData(0, 0, wW, wH).data;
    recompData = recompCtx.getImageData(0, 0, wW, wH).data;

    _cachedRecomp = {
      bitmap, format, quality, wW, wH,
      origData, recompData,
    };
  }

  if (getRunId && getRunId() !== currentRunId) return null;

  // 5. Compute difference & amplification into output canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width = wW;
  outCanvas.height = wH;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  const outImg = outCtx.createImageData(wW, wH);
  const outData = outImg.data;
  const rawDiffs = new Uint8Array(total);

  // Precomputed clamp table for amplification factor
  const clamp = new Uint8Array(256);
  for (let c = 0; c < 256; c++) {
    const v = c * amp;
    clamp[c] = v > 255 ? 255 : v;
  }

  // Adaptive row-band processing: keeps UI responsive without excessive setTimeout overhead
  const BAND_ROWS = 256;
  let lastYield = performance.now();

  for (let y = 0; y < wH; y += BAND_ROWS) {
    const yEnd = Math.min(y + BAND_ROWS, wH);
    let p = y * wW;
    let i = p * 4;
    const endP = yEnd * wW;

    while (p < endP) {
      let dR = origData[i] - recompData[i];
      if (dR < 0) dR = -dR;
      let dG = origData[i + 1] - recompData[i + 1];
      if (dG < 0) dG = -dG;
      let dB = origData[i + 2] - recompData[i + 2];
      if (dB < 0) dB = -dB;

      let dpx = dR;
      if (dG > dpx) dpx = dG;
      if (dB > dpx) dpx = dB;

      rawDiffs[p] = dpx;

      outData[i]     = clamp[dR];
      outData[i + 1] = clamp[dG];
      outData[i + 2] = clamp[dB];
      outData[i + 3] = 255;

      p++;
      i += 4;
    }

    if (getRunId && getRunId() !== currentRunId) return null;

    // Only yield if processing took longer than 35ms (avoids 4ms HTML5 timer clamps)
    if (performance.now() - lastYield > 35) {
      await yieldToUI();
      lastYield = performance.now();
    }
  }

  outCtx.putImageData(outImg, 0, 0);

  // 6. Compute statistics from rawDiffs
  const stats = computeStats(rawDiffs, wW, wH);

  // 7. Fast native PNG data URL generation
  const dataUrl = outCanvas.toDataURL('image/png');

  // Build notes per spec
  const sourceNote = format !== 'JPEG'
    ? `Source was ${format}; re-encoded as JPEG for ELA (results are less interpretable than for a JPEG-native workflow).`
    : 'Source is JPEG; ELA compares the supplied image with a re-encoded JPEG copy.';
  const resizeNote = resized
    ? ` Working copy downscaled to ${wW}×${wH} (original: ${origW}×${origH}).`
    : '';
  const alphaNote = (format === 'PNG' || format === 'WEBP')
    ? ' Alpha channel composited over white background.'
    : '';

  return {
    dataUrl,
    stats,
    workingSize: { w: wW, h: wH },
    resized,
    note: sourceNote + resizeNote + alphaNote,
  };
}

/** Compute ELA statistics from an array of per-pixel max-channel differences. */
function computeStats(rawDiffs, w, h) {
  const total = w * h;

  // 256-bin histogram, mean, max, and threshold counts
  const hist = new Int32Array(256);
  let sum = 0, maxVal = 0;
  const THRESHOLD = 12;
  let aboveThreshold = 0;

  for (let p = 0; p < total; p++) {
    const d = rawDiffs[p];
    hist[d]++;
    sum += d;
    if (d > maxVal) maxVal = d;
    if (d >= THRESHOLD) aboveThreshold++;
  }

  const mean = sum / total;

  // p95 from cumulative histogram
  const target95 = Math.floor(total * 0.95);
  let cumul = 0, p95 = 0;
  for (let v = 0; v < 256; v++) {
    cumul += hist[v];
    if (cumul >= target95) { p95 = v; break; }
  }

  const pctAboveThreshold = (aboveThreshold / total) * 100;

  // Hot region: divide into 8×8 grid
  const gRows = 8, gCols = 8;
  const cellW = Math.floor(w / gCols);
  const cellH = Math.floor(h / gRows);
  let bestCell = { row: 1, col: 1, mean: 0 };

  for (let gr = 0; gr < gRows; gr++) {
    const y0 = gr * cellH;
    const y1 = Math.min(y0 + cellH, h);
    for (let gc = 0; gc < gCols; gc++) {
      const x0 = gc * cellW;
      const x1 = Math.min(x0 + cellW, w);
      let cellSum = 0;
      let cellCount = 0;

      for (let cy = y0; cy < y1; cy++) {
        const rowOffset = cy * w;
        for (let cx = x0; cx < x1; cx++) {
          cellSum += rawDiffs[rowOffset + cx];
          cellCount++;
        }
      }
      const cellMean = cellCount > 0 ? cellSum / cellCount : 0;
      if (cellMean > bestCell.mean) {
        bestCell = { row: gr + 1, col: gc + 1, mean: cellMean };
      }
    }
  }

  const regionRatio = mean > 0 ? bestCell.mean / mean : 0;

  return {
    mean: parseFloat(mean.toFixed(2)),
    p95,
    max: maxVal,
    pctAboveThreshold: parseFloat(pctAboveThreshold.toFixed(2)),
    threshold: THRESHOLD,
    hotRegion: {
      row: bestCell.row,
      col: bestCell.col,
      mean: parseFloat(bestCell.mean.toFixed(2)),
      ratioToGlobalMean: parseFloat(regionRatio.toFixed(2)),
    },
  };
}
