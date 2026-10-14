// state.js — single app-state object + subscribe/dispatch helpers

const _listeners = [];

export const state = {
  status: 'idle',        // 'idle' | 'validating' | 'processing' | 'ready' | 'error'
  runId: 0,
  file: null,            // { name, type, size, lastModified }
  originalUrl: null,
  image: null,           // { format, width, height, colorMode, sizeBytes, hasAlpha }
  metadata: { tags: [], count: 0, gps: null, error: null },
  hash: { sha256: null, computedAt: null, reference: '', match: null },
  ela: {
    quality: 90,
    amplification: 15,
    workingCopyNote: '',
    resized: false,
    workingSize: null,
    dataUrl: null,
    stats: null,
  },
  overall: null,
  view: { tab: 'overview', compare: 'split', showOriginalInToggle: true },
  options: { includeGpsInReports: false },
  errors: [],
  warnings: [],
};

/**
 * Update state with a partial patch and notify all listeners.
 * Deep-merges one level (e.g. patch can be { ela: { quality: 85 } }).
 */
export function setState(patch) {
  for (const key of Object.keys(patch)) {
    if (
      patch[key] !== null &&
      typeof patch[key] === 'object' &&
      !Array.isArray(patch[key]) &&
      state[key] !== null &&
      typeof state[key] === 'object' &&
      !Array.isArray(state[key])
    ) {
      state[key] = { ...state[key], ...patch[key] };
    } else {
      state[key] = patch[key];
    }
  }
  _listeners.forEach(fn => fn(state));
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

/** Convenience: increment runId and return the new value. */
export function newRun() {
  state.runId += 1;
  return state.runId;
}
