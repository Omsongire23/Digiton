// hash.js — SHA-256 computation using Web Crypto API

/** Precomputed hex lookup table for fast hex conversion. */
const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Compute SHA-256 of the original File bytes or ArrayBuffer. Returns lowercase hex. */
export async function computeSha256(fileOrBuffer) {
  if (!window.isSecureContext || !crypto?.subtle) {
    throw new Error(
      'SHA-256 requires a secure context (HTTPS or localhost). ' +
      'Web Crypto API is not available in this context.'
    );
  }

  const buffer = fileOrBuffer instanceof ArrayBuffer
    ? fileOrBuffer
    : await fileOrBuffer.arrayBuffer();

  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return bufToHex(hashBuf);
}

/** Convert an ArrayBuffer to a lowercase hex string using precomputed lookup. */
function bufToHex(buf) {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX_TABLE[bytes[i]];
  }
  return hex;
}

/** Normalize a user-supplied reference hash string:
 *  - Strip leading/trailing whitespace
 *  - Strip all internal whitespace
 *  - Strip optional "sha256:" prefix
 *  - Lowercase
 */
export function normalizeHash(raw) {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/^sha256:/i, '')
    .toLowerCase();
}

/** Validate that a string is exactly 64 lowercase hex characters. */
export function isValidHash(hex) {
  return /^[0-9a-f]{64}$/.test(hex);
}

/** Compare computed hash against a reference input.
 *  Returns { match: boolean, normalizedRef: string } or { error: string } if invalid.
 */
export function compareHash(computed, rawReference) {
  const ref = normalizeHash(rawReference);
  if (!isValidHash(ref)) {
    return { error: 'Reference hash must be exactly 64 hexadecimal characters.' };
  }
  return { match: computed === ref, normalizedRef: ref };
}
