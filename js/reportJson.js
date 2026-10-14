// reportJson.js — JSON report generation

import { reportFilename } from './utils.js';
import { downloadBlob } from './utils.js';

/** Generate and download a JSON report from the current state. */
export function downloadJsonReport(state) {
  const { file, image, metadata, hash, ela, overall, warnings } = state;
  const includeGps = state.options.includeGpsInReports;

  const metaTags = (metadata.tags || []).map(t => ({
    group: t.group, key: t.key, value: t.value,
  }));

  const report = {
    schemaVersion: '1.0',
    tool: { name: 'Digital Image Forensics Tool', version: '1.0.0' },
    generatedAt: new Date().toISOString(),
    file: file ? {
      name: file.name,
      detectedFormat: image?.format || null,
      mimeTypeReported: file.type || null,
      sizeBytes: file.size,
      lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    } : null,
    image: image ? {
      width: image.width,
      height: image.height,
      colorMode: image.colorMode,
      hasAlpha: image.hasAlpha,
    } : null,
    integrity: {
      sha256: hash.sha256 || null,
      computedOn: 'original uploaded file bytes',
      referenceHash: hash.reference ? {
        provided: true,
        normalized: hash.reference,
        match: hash.match,
      } : { provided: false },
    },
    metadata: {
      tagCount: metadata.count,
      tags: metaTags,
      gpsIncluded: includeGps && !!metadata.gps,
      gpsPresent: !!metadata.gps,
      ...(includeGps && metadata.gps ? {
        gps: { latitude: metadata.gps.lat, longitude: metadata.gps.lon },
      } : {}),
      error: metadata.error || null,
    },
    ela: ela.dataUrl ? {
      method: 'Canvas JPEG re-encode difference (browser encoder)',
      quality: ela.quality,
      amplification: ela.amplification,
      workingSize: ela.workingSize
        ? { width: ela.workingSize.w, height: ela.workingSize.h }
        : null,
      resized: ela.resized,
      sourceConvertedToJpeg: image?.format !== 'JPEG',
      note: ela.workingCopyNote || '',
      stats: ela.stats || null,
    } : null,
    overall: overall ? {
      level: overall.level,
      title: overall.title,
      summary: overall.summary,
      indicators: overall.indicators,
    } : null,
    warnings: warnings || [],
    limitations: overall?.limitations || [],
  };

  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = reportFilename(file?.name || 'image', 'json');
  downloadBlob(blob, filename);
}
