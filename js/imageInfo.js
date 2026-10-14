// imageInfo.js — format, dimensions, color mode, size

/** Extract basic image information from a decoded ImageBitmap + File. */
export async function getImageInfo(file, bitmap, detectedFormat) {
  const width  = bitmap.naturalWidth  || bitmap.width;
  const height = bitmap.naturalHeight || bitmap.height;

  // Detect alpha by drawing a small canvas and sampling
  let hasAlpha = false;
  if (detectedFormat === 'PNG' || detectedFormat === 'WEBP') {
    hasAlpha = await detectAlpha(bitmap);
  }

  const colorMode = detectedFormat === 'JPEG'
    ? 'RGB'
    : hasAlpha
      ? 'RGB (alpha present)'
      : 'RGB';

  return {
    format: detectedFormat,
    width,
    height,
    colorMode,
    sizeBytes: file.size,
    hasAlpha,
    lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
  };
}

/** Sample a small canvas to check if any pixel has alpha < 255. */
async function detectAlpha(bitmap) {
  const SAMPLE = 64; // sample at most 64×64
  const w = Math.min(bitmap.width,  SAMPLE);
  const h = Math.min(bitmap.height, SAMPLE);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}
