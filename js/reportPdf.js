// reportPdf.js — PDF report generation using jsPDF

import { reportFilename, downloadBlob, formatBytes, truncate } from './utils.js';

/** Generate and download a PDF report from the current state. */
export async function downloadPdfReport(state) {
  if (typeof window.jspdf === 'undefined') {
    throw new Error('jsPDF library not loaded.');
  }

  const { jsPDF } = window.jspdf;
  const { file, image, metadata, hash, ela, overall, warnings } = state;
  const includeGps = state.options.includeGpsInReports;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210; // A4 width mm
  const PH = 297; // A4 height mm
  const ML = 18, MR = 18, MT = 16, MB = 16;
  const CW = PW - ML - MR; // content width
  let y = MT;
  let pageNum = 1;
  const pages = []; // track pages for footer

  // ── Helpers ──────────────────────────────────────────────────────

  function addPage() {
    doc.addPage();
    pageNum++;
    y = MT;
  }

  function checkY(needed = 10) {
    if (y + needed > PH - MB - 8) addPage();
  }

  function setFont(style = 'normal', size = 10, font = 'helvetica') {
    doc.setFont(font, style);
    doc.setFontSize(size);
  }

  function text(str, x, ty, opts) {
    doc.text(str, x, ty, opts);
  }

  function wrapText(str, maxW, size = 10, font = 'helvetica', style = 'normal') {
    setFont(style, size, font);
    return doc.splitTextToSize(String(str), maxW);
  }

  function drawWrapped(str, x, ty, maxW, size = 10, font = 'helvetica', style = 'normal', color = [230, 236, 248]) {
    setFont(style, size, font);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str), maxW);
    checkY(lines.length * (size * 0.35278) + 2);
    doc.text(lines, x, ty);
    return lines.length * (size * 0.35278 + 1);
  }

  function sectionHeading(title) {
    checkY(14);
    y += 4;
    setFont('bold', 12);
    doc.setTextColor(56, 189, 248);
    text(title, ML, y);
    y += 1;
    doc.setDrawColor(56, 189, 248);
    doc.setLineWidth(0.3);
    doc.line(ML, y + 1, ML + CW, y + 1);
    y += 5;
    doc.setTextColor(230, 236, 248);
  }

  function keyVal(key, val, indent = 0) {
    const lines = wrapText(String(val), CW - 44 - indent, 9);
    checkY(lines.length * 4 + 2);
    setFont('bold', 9);
    doc.setTextColor(154, 168, 196);
    text(key + ':', ML + indent, y);
    setFont('normal', 9, 'courier');
    doc.setTextColor(230, 236, 248);
    doc.text(lines, ML + 44 + indent, y);
    y += Math.max(5, lines.length * 4);
  }

  function toneTag(tone) {
    if (tone === 'ok')   return '[OK]   ';
    if (tone === 'warn') return '[WARN] ';
    return '[INFO] ';
  }

  // ── 1. Title block ────────────────────────────────────────────────
  setFont('bold', 18);
  doc.setTextColor(56, 189, 248);
  text('Digital Image Forensics Report', ML, y);
  y += 9;

  setFont('normal', 10);
  doc.setTextColor(154, 168, 196);
  const now = new Date();
  text(`Generated: ${now.toISOString()}  (local: ${now.toLocaleString()})`, ML, y);
  y += 5;
  text('Tool: Digital Image Forensics Tool v1.0.0  |  Analysis performed entirely in-browser', ML, y);
  y += 8;

  doc.setDrawColor(36, 50, 79);
  doc.setLineWidth(0.5);
  doc.line(ML, y, ML + CW, y);
  y += 6;

  // ── 2. Overall result ─────────────────────────────────────────────
  sectionHeading('2. Overall Result');
  if (overall) {
    setFont('bold', 11);
    doc.setTextColor(230, 236, 248);
    text(overall.title, ML, y);
    y += 6;
    const sumLines = wrapText(overall.summary, CW, 9);
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    doc.text(sumLines, ML, y);
    y += sumLines.length * 4 + 4;

    for (const ind of (overall.indicators || [])) {
      checkY(6);
      setFont('bold', 9);
      doc.setTextColor(154, 168, 196);
      text(`${toneTag(ind.tone)}${ind.label}:`, ML + 2, y);
      const dLines = wrapText(ind.detail, CW - 50, 9);
      setFont('normal', 9);
      doc.setTextColor(230, 236, 248);
      doc.text(dLines, ML + 52, y);
      y += Math.max(5, dLines.length * 4);
    }
  } else {
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    text('Overall result not computed.', ML, y);
    y += 5;
  }

  // ── 3. Evidence details ───────────────────────────────────────────
  sectionHeading('3. Evidence Details');
  if (file) {
    keyVal('Filename',       file.name);
    keyVal('Detected format', image?.format || 'Not available');
    keyVal('MIME reported',  file.type || 'Not available');
    keyVal('Dimensions',     image ? `${image.width} × ${image.height} px` : 'Not available');
    keyVal('Color mode',     image?.colorMode || 'Not available');
    keyVal('File size',      `${file.size} bytes (${formatBytes(file.size)})`);
    keyVal('Last modified',  file.lastModified ? new Date(file.lastModified).toLocaleString() : 'Not available');
  }

  // ── 4. Integrity (SHA-256) ────────────────────────────────────────
  sectionHeading('4. Integrity — SHA-256');
  setFont('normal', 9);
  doc.setTextColor(154, 168, 196);
  checkY(8);
  text('Hash computed from the exact bytes of the uploaded file.', ML, y);
  y += 5;

  if (hash.sha256) {
    const hashLines = wrapText(hash.sha256, CW, 9, 'courier');
    setFont('normal', 9, 'courier');
    doc.setTextColor(56, 189, 248);
    checkY(hashLines.length * 4 + 2);
    doc.text(hashLines, ML, y);
    y += hashLines.length * 4 + 3;

    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    if (hash.computedAt) {
      text(`Computed at: ${new Date(hash.computedAt).toLocaleString()}`, ML, y);
      y += 5;
    }

    if (hash.reference) {
      checkY(10);
      setFont('bold', 9);
      doc.setTextColor(154, 168, 196);
      text('Reference hash:', ML, y);
      setFont('normal', 9, 'courier');
      doc.setTextColor(230, 236, 248);
      const refLines = wrapText(hash.reference, CW - 44, 9, 'courier');
      doc.text(refLines, ML + 44, y);
      y += refLines.length * 4 + 2;

      checkY(8);
      const matchLabel = hash.match ? 'MATCH — File is byte-identical to the recorded baseline.' : 'MISMATCH — File differs from the recorded baseline.';
      setFont('bold', 9);
      doc.setTextColor(hash.match ? 34 : 245, hash.match ? 197 : 165, hash.match ? 94 : 36);
      text(matchLabel, ML, y);
      y += 6;
    }

    setFont('normal', 8);
    doc.setTextColor(107, 127, 160);
    const scope = wrapText('SHA-256 can establish byte-for-byte consistency when compared with a previously recorded hash. It cannot prove who created the image or whether it was altered before the first hash was recorded.', CW, 8);
    doc.text(scope, ML, y);
    y += scope.length * 3.5 + 3;
  } else {
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    text('Not available.', ML, y);
    y += 5;
  }

  // ── 5. Original image thumbnail ────────────────────────────────────
  if (state.originalUrl) {
    sectionHeading('5. Original Image');
    try {
      checkY(50);
      const maxW = 174, maxH = 90;
      const imgData = await loadImageAsBase64(state.originalUrl);
      const ratio = image ? image.width / image.height : 1;
      let iW = maxW, iH = maxW / ratio;
      if (iH > maxH) { iH = maxH; iW = maxH * ratio; }
      doc.addImage(imgData, 'JPEG', ML, y, iW, iH);
      y += iH + 4;
    } catch {
      setFont('normal', 9);
      doc.setTextColor(154, 168, 196);
      text('Image thumbnail not available.', ML, y);
      y += 5;
    }
  }

  // ── 6. EXIF metadata ─────────────────────────────────────────────
  sectionHeading('6. EXIF Metadata');
  if (metadata.tags && metadata.tags.length > 0) {
    let currentGroup = '';
    for (const tag of metadata.tags) {
      // Skip GPS if not opted in
      if (!includeGps && tag.group === 'GPS') continue;

      checkY(7);
      if (tag.group !== currentGroup) {
        currentGroup = tag.group;
        y += 2;
        setFont('bold', 8);
        doc.setTextColor(107, 127, 160);
        text(`── ${currentGroup}`, ML, y);
        y += 4;
      }
      const valLines = wrapText(truncate(tag.value, 300), CW - 60, 8, 'courier');
      checkY(valLines.length * 3.5 + 2);
      setFont('normal', 8);
      doc.setTextColor(154, 168, 196);
      text(truncate(tag.key, 30), ML + 2, y);
      setFont('normal', 8, 'courier');
      doc.setTextColor(230, 236, 248);
      doc.text(valLines, ML + 62, y);
      y += Math.max(4, valLines.length * 3.5);
    }

    if (metadata.gps && !includeGps) {
      checkY(7);
      setFont('italic', 8);
      doc.setTextColor(107, 127, 160);
      text('GPS data present but excluded from this report (GPS reporting disabled by user).', ML, y);
      y += 5;
    }
  } else {
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    checkY(6);
    text(metadata.error || 'No EXIF metadata found.', ML, y);
    y += 5;
  }

  // ── 7. ELA ────────────────────────────────────────────────────────
  sectionHeading('7. Error Level Analysis (ELA)');
  if (ela.dataUrl && ela.stats) {
    keyVal('Quality',       `${ela.quality}/100`);
    keyVal('Amplification', `${ela.amplification}×`);
    keyVal('Working size',  ela.workingSize ? `${ela.workingSize.w}×${ela.workingSize.h} px${ela.resized ? ' (downscaled)' : ''}` : 'Not available');

    if (ela.workingCopyNote) {
      checkY(10);
      const noteLines = wrapText(ela.workingCopyNote, CW, 8);
      setFont('italic', 8);
      doc.setTextColor(107, 127, 160);
      doc.text(noteLines, ML, y);
      y += noteLines.length * 3.5 + 3;
    }

    // ELA image
    try {
      checkY(60);
      const maxW = 174, maxH = 90;
      const ratio = ela.workingSize ? ela.workingSize.w / ela.workingSize.h : 1;
      let eW = maxW, eH = maxW / ratio;
      if (eH > maxH) { eH = maxH; eW = maxH * ratio; }
      doc.addImage(ela.dataUrl, 'PNG', ML, y, eW, eH);
      y += eH + 4;
    } catch {
      setFont('normal', 9);
      doc.setTextColor(154, 168, 196);
      text('ELA image could not be embedded.', ML, y);
      y += 5;
    }

    // ELA stats
    const s = ela.stats;
    checkY(30);
    y += 2;
    setFont('bold', 9);
    doc.setTextColor(154, 168, 196);
    text('ELA Statistics:', ML, y);
    y += 5;
    keyVal('Mean difference',     `${s.mean} / 255`);
    keyVal('95th percentile',     `${s.p95} / 255`);
    keyVal('Max difference',      `${s.max} / 255`);
    keyVal(`Above threshold (≥${s.threshold})`, `${s.pctAboveThreshold.toFixed(2)}%`);
    keyVal('Hottest region',      `Row ${s.hotRegion.row}, Col ${s.hotRegion.col} — mean ${s.hotRegion.mean}, ${s.hotRegion.ratioToGlobalMean}× global mean`);
  } else {
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    text('ELA not computed.', ML, y);
    y += 5;
  }

  // ── 8. Findings and warnings ──────────────────────────────────────
  if (warnings && warnings.length > 0) {
    sectionHeading('8. Findings and Warnings');
    for (const w of warnings) {
      checkY(6);
      setFont('normal', 9);
      doc.setTextColor(245, 165, 36);
      const wLines = wrapText(`• ${w}`, CW, 9);
      doc.text(wLines, ML, y);
      y += wLines.length * 4 + 1;
    }
  }

  // ── 9. Methodology ───────────────────────────────────────────────
  sectionHeading('9. Methodology');
  const methodLines = wrapText(
    'Metadata was extracted using exifr (v7.1.3) entirely in the browser. ' +
    'SHA-256 was computed using the Web Crypto API (crypto.subtle.digest) on the exact bytes of the uploaded file — ' +
    'not a converted or recompressed copy. ' +
    'ELA was generated by drawing the image onto an OffscreenCanvas, re-encoding it as JPEG at the selected quality, ' +
    'decoding the result, and computing per-pixel channel differences amplified by the selected factor. ' +
    'No image data was sent to any server.',
    CW, 9
  );
  setFont('normal', 9);
  doc.setTextColor(154, 168, 196);
  checkY(methodLines.length * 4);
  doc.text(methodLines, ML, y);
  y += methodLines.length * 4 + 4;

  // ── 10. Limitations ──────────────────────────────────────────────
  sectionHeading('10. Limitations');
  const lims = overall?.limitations || [
    'ELA and metadata are investigative indicators, not proof of manipulation or authenticity.',
    'ELA differences can have innocent causes: compression, resizing, re-saving, texture.',
    'SHA-256 verifies byte-level consistency against a known baseline only.',
    'Missing metadata is common and is not evidence of tampering.',
    'ELA values differ between browser engines — compare regions within the same image.',
    'Verdict thresholds are heuristics, not scientifically validated cutoffs.',
  ];
  for (const lim of lims) {
    checkY(6);
    const limLines = wrapText(`• ${lim}`, CW, 9);
    setFont('normal', 9);
    doc.setTextColor(154, 168, 196);
    doc.text(limLines, ML, y);
    y += limLines.length * 4 + 1;
  }

  // ── 11. Conclusion ───────────────────────────────────────────────
  sectionHeading('11. Conclusion');
  const conclusion = overall
    ? `${overall.title}. ${overall.summary} Treat all findings as investigative leads for further expert examination, not standalone proof.`
    : 'Analysis could not be completed. No conclusion can be drawn.';
  const concLines = wrapText(conclusion, CW, 9);
  setFont('normal', 9);
  doc.setTextColor(154, 168, 196);
  checkY(concLines.length * 4);
  doc.text(concLines, ML, y);

  // ── Page footers ──────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setFont('normal', 7);
    doc.setTextColor(107, 127, 160);
    text(`Digital Image Forensics Tool  —  Page ${p} of ${totalPages}`, ML, PH - MB + 4);
    text('All analysis performed locally in-browser. No data sent to any server.', ML + CW - 90, PH - MB + 4);
  }

  // ── Download ─────────────────────────────────────────────────────
  const filename = reportFilename(file?.name || 'image', 'pdf');
  const blob = doc.output('blob');
  downloadBlob(blob, filename);
}

/** Load an image URL and return a base64 JPEG data string for jsPDF. */
function loadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}
