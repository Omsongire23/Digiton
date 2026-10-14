// upload.js — file input, drag-and-drop, validation (magic bytes)

import { state, setState, newRun } from './state.js';
import { formatBytes } from './utils.js';

const MAX_SIZE = 20 * 1024 * 1024; // 20 MiB

/** Magic byte signatures for supported formats */
const MAGIC = {
  JPEG: [[0xFF, 0xD8, 0xFF]],
  PNG:  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  WEBP: null, // Special: 'RIFF' at 0 + 'WEBP' at 8
};

/** Detect format from the first bytes of an ArrayBuffer. */
export function detectFormat(buffer) {
  const bytes = new Uint8Array(buffer);

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'JPEG';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
  ) return 'PNG';

  // WebP: "RIFF" (bytes 0-3) + "WEBP" (bytes 8-11)
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'WEBP';

  return null;
}

/** MIME type → expected format */
function mimeToExpectedFormat(mime) {
  if (mime === 'image/jpeg') return 'JPEG';
  if (mime === 'image/png') return 'PNG';
  if (mime === 'image/webp') return 'WEBP';
  return null;
}

/** Validate a File object. Returns { ok, error, detectedFormat, mimeWarning }. */
export async function validateFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };
  if (file.size === 0) return { ok: false, error: 'The file is empty.' };
  if (file.size > MAX_SIZE) {
    return { ok: false, error: `File is too large (${formatBytes(file.size)}). Maximum is 20 MB.` };
  }

  // Read first 12 bytes for magic detection
  const head = await file.slice(0, 12).arrayBuffer();
  const detectedFormat = detectFormat(head);

  if (!detectedFormat) {
    return {
      ok: false,
      error: 'Unsupported file type. Please upload a JPEG, PNG, or WebP image.',
    };
  }

  // Extension / MIME mismatch warning
  const expectedByMime = mimeToExpectedFormat(file.type);
  const mimeWarning = expectedByMime && expectedByMime !== detectedFormat
    ? `File extension/type does not match its actual format (detected: ${detectedFormat}).`
    : null;

  // Decode check
  try {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    bmp.close();
  } catch (err) {
    return { ok: false, error: `This image could not be decoded. The file may be corrupt. (${err.message})` };
  }

  return { ok: true, detectedFormat, mimeWarning };
}

/** Wire up the upload zone and return a callback setter. */
export function initUpload({ dropzone, dropzoneCompact, fileInput, browseBtn,
                              replaceBtn, resetBtn, statusEl, onFile, onReset }) {
  function setStatus(msg, type = '') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'dropzone-status' + (type ? ` ${type}` : '');
  }

  function showFull() {
    dropzone.classList.remove('hidden');
    dropzoneCompact.classList.add('hidden');
  }
  function showCompact(name, size) {
    dropzone.classList.add('hidden');
    dropzoneCompact.classList.remove('hidden');
    const nameEl = dropzoneCompact.querySelector('.dropzone-compact-name');
    const sizeEl = dropzoneCompact.querySelector('.dropzone-compact-size');
    if (nameEl) nameEl.textContent = name;
    if (sizeEl) sizeEl.textContent = formatBytes(size);
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus('Validating…', 'info');
    setState({ status: 'validating' });
    newRun();

    const result = await validateFile(file);

    if (!result.ok) {
      setStatus(result.error, 'error');
      setState({ status: 'error', errors: [result.error] });
      showFull();
      return;
    }

    if (result.mimeWarning) {
      setStatus(result.mimeWarning, 'error');
      // But still proceed — it's a warning
    } else {
      setStatus(`Loaded: ${file.name}`, 'ok');
    }

    showCompact(file.name, file.size);
    onFile(file, result.detectedFormat, result.mimeWarning);
  }

  // File input
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // Reset immediately so same file can be re-selected
    if (file) handleFile(file);
  });

  // Browse button
  browseBtn.addEventListener('click', () => fileInput.click());
  browseBtn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  // Replace
  if (replaceBtn) {
    replaceBtn.addEventListener('click', () => {
      showFull();
      setStatus('');
      fileInput.click();
    });
  }

  // Reset
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      showFull();
      setStatus('Workspace cleared.', 'info');
      setTimeout(() => setStatus(''), 2000);
      onReset();
      browseBtn.focus();
    });
  }

  // Drag and drop on dropzone
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  // Allow clicking on the dropzone itself
  dropzone.addEventListener('click', e => {
    if (e.target === browseBtn || browseBtn.contains(e.target)) return;
    fileInput.click();
  });

  return { setStatus, showFull, showCompact };
}
