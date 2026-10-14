// verdict.js — neutral rule-based overall result from analysis indicators

/**
 * Compute the overall result from the current state.
 * All thresholds are heuristics, not scientific cutoffs (documented in README).
 *
 * Thresholds:
 *   review-suggested if:
 *     - regionRatio >= 2.5 AND hotRegion.mean >= 8  (localised high-response region)
 *     - OR pctAboveThreshold >= 20                  (widespread high-response)
 *     - OR reference hash provided AND mismatched
 *
 * @param {object} state  - full app state
 * @returns {{ level, title, summary, indicators, limitations }}
 */
export function computeVerdict(state) {
  const { image, metadata, hash, ela } = state;

  // ── Check completeness ──────────────────────────────────────
  const hashFailed = !hash.sha256 && state.errors.some(e => e.includes('SHA-256') || e.includes('hash'));
  const elaFailed  = !ela.dataUrl && state.errors.some(e => e.includes('ELA') || e.includes('ela'));
  const incomplete = hashFailed || elaFailed;

  if (incomplete) {
    return {
      level: 'incomplete',
      title: 'Analysis incomplete',
      summary: 'One or more analysis steps could not be completed. Review the errors and try again.',
      indicators: buildIndicators(state, true),
      limitations: LIMITATIONS,
    };
  }

  // ── Determine level ─────────────────────────────────────────
  let reviewSuggested = false;
  const reasons = [];

  if (ela.stats) {
    const { pctAboveThreshold, hotRegion } = ela.stats;

    // Localised high-response region (heuristic threshold)
    if (hotRegion.ratioToGlobalMean >= 2.5 && hotRegion.mean >= 8) {
      reviewSuggested = true;
      reasons.push(`ELA: highest-response region is row ${hotRegion.row}, col ${hotRegion.col} (${hotRegion.ratioToGlobalMean}× the image average, mean=${hotRegion.mean.toFixed(1)})`);
    }

    // Widespread high-response pixels
    if (pctAboveThreshold >= 20) {
      reviewSuggested = true;
      reasons.push(`ELA: ${pctAboveThreshold.toFixed(1)}% of pixels have difference ≥ ${ela.stats.threshold} (threshold for review: 20%)`);
    }
  }

  // Reference hash mismatch
  if (hash.reference && hash.match === false) {
    reviewSuggested = true;
    reasons.push('Reference hash provided and does not match — file differs from the recorded baseline.');
  }

  const level = reviewSuggested ? 'review-suggested' : 'no-notable-indicators';

  const titles = {
    'no-notable-indicators': 'No notable ELA or integrity indicators detected',
    'review-suggested':      'Some indicators suggest further examination',
  };
  const summaries = {
    'no-notable-indicators':
      'The ELA response is within typical ranges and no integrity anomalies were found. ' +
      'This does not confirm authenticity — see limitations below.',
    'review-suggested':
      'One or more indicators warrant closer examination. ' +
      'This does not confirm manipulation — see limitations below.',
  };

  return {
    level,
    title: titles[level],
    summary: summaries[level],
    indicators: buildIndicators(state, false),
    limitations: LIMITATIONS,
  };
}

/** Build the indicator list from current state. */
function buildIndicators(state, incomplete) {
  const { image, metadata, hash, ela } = state;
  const indicators = [];

  // ── File ────────────────────────────────────────────────────
  if (image) {
    indicators.push({
      label: 'Format',
      detail: `${image.format}, ${image.width}×${image.height} px, ${image.colorMode}`,
      tone: 'info',
    });
  }

  // ── Metadata ────────────────────────────────────────────────
  if (metadata.count > 0) {
    indicators.push({
      label: 'EXIF metadata',
      detail: `${metadata.count} tag${metadata.count !== 1 ? 's' : ''} found`,
      tone: 'info',
    });
    if (metadata.gps) {
      indicators.push({
        label: 'GPS data',
        detail: 'Location coordinates present in EXIF',
        tone: 'warn',
      });
    }
  } else {
    indicators.push({
      label: 'EXIF metadata',
      detail: 'None found — common for screenshots, web images, and re-saved files. Not an indicator of tampering.',
      tone: 'info',
    });
  }
  if (metadata.error) {
    indicators.push({ label: 'EXIF read error', detail: metadata.error, tone: 'warn' });
  }

  // ── Hash ────────────────────────────────────────────────────
  if (hash.sha256) {
    indicators.push({
      label: 'SHA-256',
      detail: `Computed: ${hash.sha256.slice(0, 12)}…`,
      tone: 'ok',
    });
    if (hash.reference) {
      if (hash.match === true) {
        indicators.push({ label: 'Reference hash', detail: 'Matches — file is byte-identical to the recorded baseline.', tone: 'ok' });
      } else if (hash.match === false) {
        indicators.push({ label: 'Reference hash', detail: 'Does not match — the file differs from the recorded baseline.', tone: 'warn' });
      }
    } else {
      indicators.push({ label: 'Reference hash', detail: 'Not provided.', tone: 'info' });
    }
  } else if (!incomplete) {
    indicators.push({ label: 'SHA-256', detail: 'Not computed.', tone: 'info' });
  }

  // ── ELA ─────────────────────────────────────────────────────
  if (ela.dataUrl && ela.stats) {
    const { mean, p95, pctAboveThreshold, hotRegion, threshold } = ela.stats;
    indicators.push({
      label: 'ELA mean difference',
      detail: `${mean} / 255 per pixel (95th percentile: ${p95})`,
      tone: 'info',
    });
    indicators.push({
      label: 'ELA high-response pixels',
      detail: `${pctAboveThreshold.toFixed(1)}% above threshold (≥${threshold})`,
      tone: pctAboveThreshold >= 20 ? 'warn' : 'info',
    });
    indicators.push({
      label: 'ELA hottest region',
      detail: `Row ${hotRegion.row}, col ${hotRegion.col} — ${hotRegion.ratioToGlobalMean}× the image average`,
      tone: (hotRegion.ratioToGlobalMean >= 2.5 && hotRegion.mean >= 8) ? 'warn' : 'info',
    });
    if (ela.resized) {
      indicators.push({ label: 'ELA working copy', detail: `Downscaled to ${ela.workingSize.w}×${ela.workingSize.h} for analysis.`, tone: 'info' });
    }
    if (ela.workingCopyNote && ela.workingCopyNote.includes('PNG') || ela.workingCopyNote?.includes('WEBP')) {
      indicators.push({ label: 'ELA source conversion', detail: 'Non-JPEG source converted to JPEG for ELA.', tone: 'info' });
    }
  } else if (!incomplete) {
    indicators.push({ label: 'ELA', detail: 'Not computed.', tone: 'info' });
  }

  // ── Warnings ────────────────────────────────────────────────
  for (const w of (state.warnings || [])) {
    indicators.push({ label: 'Warning', detail: w, tone: 'warn' });
  }

  return indicators;
}

/** Limitations always shown at the bottom of the verdict. */
const LIMITATIONS = [
  'ELA and metadata are investigative indicators, not proof of manipulation or authenticity.',
  'ELA differences can have innocent causes: prior compression, resizing, re-saving, or texture.',
  'SHA-256 verifies byte-level consistency against a known baseline only.',
  'Missing metadata is common and is not evidence of tampering.',
  'ELA values differ between browser engines and tools such as Pillow — compare regions within the same image.',
  'Verdict thresholds are heuristics, not scientifically validated cutoffs.',
];
