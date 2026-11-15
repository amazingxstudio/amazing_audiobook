// Settings live in localStorage (small, synchronous). Everything else (books, audio) is in IndexedDB.
const KEY = 'ab.settings';
export const DEFAULTS = { chunkSize: 250, cfg: 2.0, space: '', rate: 1 };
export const LIMITS = { chunkSize: [60, 700], cfg: [0.5, 5] };

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: keep going with in-memory defaults */ }
  return s;
}
// small localStorage helpers that never throw
export const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
