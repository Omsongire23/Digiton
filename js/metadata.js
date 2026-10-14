// metadata.js — EXIF extraction, normalization, GPS handling

/** Extract and normalize EXIF metadata using the vendored exifr library.
 *  Returns { tags: [{group, key, value}], count, gps, error }
 */
export async function extractMetadata(fileOrBuffer) {
  if (typeof window.exifr === 'undefined') {
    return { tags: [], count: 0, gps: null, error: 'EXIF library not loaded.' };
  }

  try {
    const raw = await window.exifr.parse(fileOrBuffer, {
      tiff: true, exif: true, gps: true, ifd1: false,
      xmp: false, iptc: false,
      translateValues: true, reviveValues: true, mergeOutput: false,
    });

    if (!raw) return { tags: [], count: 0, gps: null, error: null };

    const tags = [];
    let gps = null;

    for (const [groupName, groupData] of Object.entries(raw)) {
      if (!groupData || typeof groupData !== 'object') continue;

      // Map exifr group names to readable names
      const group = mapGroupName(groupName);

      for (const [key, value] of Object.entries(groupData)) {
        if (value === undefined || value === null) continue;

        const normalized = normalizeValue(value);
        if (normalized === null) continue;

        tags.push({ group, key: humanKey(key), value: normalized });
      }
    }

    // Extract GPS if present in the already-parsed GPS block
    try {
      if (raw.gps && typeof raw.gps === 'object') {
        const lat = raw.gps.latitude;
        const lon = raw.gps.longitude;
        if (typeof lat === 'number' && !isNaN(lat) && typeof lon === 'number' && !isNaN(lon)) {
          gps = {
            lat,
            lon,
            raw: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
          };
        }
      }
    } catch {
      // GPS extraction failed silently — not critical
    }

    return { tags, count: tags.length, gps, error: null };
  } catch (err) {
    return { tags: [], count: 0, gps: null, error: `Could not read EXIF: ${err.message}` };
  }
}

/** Normalize an EXIF value to a displayable string. */
function normalizeValue(value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    return `[binary, ${bytes.length} bytes]`;
  }
  if (value instanceof Date) {
    try { return value.toLocaleString(); } catch { return value.toString(); }
  }
  if (Array.isArray(value)) {
    if (value.length > 20) return `[array, ${value.length} items]`;
    return value.map(v => normalizeValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    // Rational number from exifr: { numerator, denominator }
    if ('numerator' in value && 'denominator' in value) {
      const d = value.denominator;
      return d === 1 ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
    }
    try { return JSON.stringify(value).slice(0, 200); } catch { return String(value); }
  }
  const str = String(value);
  return str.length > 500 ? str.slice(0, 500) + '…' : str;
}

/** Map exifr internal group names to human-readable names. */
function mapGroupName(name) {
  const map = {
    ifd0: 'Image', ifd1: 'Thumbnail', exif: 'Camera / Exposure',
    gps: 'GPS', interop: 'Interoperability',
    makernote: 'Maker Note', xmp: 'XMP', iptc: 'IPTC',
  };
  return map[name.toLowerCase()] || name;
}

/** Convert camelCase / PascalCase EXIF keys to a human-readable label. */
function humanKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}
