// Downloading the temporary Space audio URL, and merging WAV chunks in the browser.
import { AppError, CancelError } from './errors.js';
import { ls, getSettings } from './settings.js';
import { PAUSE_MS } from './chunker.js';

const MAX_PROXY_BYTES = 4.4 * 1024 * 1024; // Vercel function responses are limited to ~4.5 MB
const PATH_KEY = 'ab.audioPath'; // 'direct' | 'proxy' | (unset = not tested yet)

export const getAudioPath = () => ls.get(PATH_KEY, '');
export const resetAudioPath = () => ls.del(PATH_KEY);

const isAbort = (e) => e?.name === 'AbortError';

async function viaDirect(url, signal) {
  const r = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new AppError('err_audio_http', { status: r.status }, url);
  return r.blob();
}
async function viaProxy(url, signal) {
  const space = getSettings().space.trim();
  const r = await fetch('/api/audio?u=' + encodeURIComponent(url) + (space ? '&s=' + encodeURIComponent(space) : ''), { signal });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 413) throw new AppError('err_audio_too_big', null, j.error || '');
    if (r.status === 404) throw new AppError('err_proxy_missing', null, 'HTTP 404');
    throw new AppError('err_audio_http', { status: r.status }, j.error || '');
  }
  return r.blob();
}

/**
 * Download the audio behind the Space URL.
 * - first run: try the browser directly; if that is blocked (CORS shows up as a TypeError), use /api/audio.
 * - the working path is remembered in localStorage so later chunks skip the failed attempt.
 * Returns { blob, path }.
 */
export async function fetchAudioBlob(url, { signal } = {}) {
  const pref = getAudioPath();
  let blob, path;
  try {
    if (pref === 'proxy') { blob = await viaProxy(url, signal); path = 'proxy'; }
    else {
      try { blob = await viaDirect(url, signal); path = 'direct'; }
      catch (e) {
        if (isAbort(e)) throw e;
        if (e instanceof AppError) throw e;      // server answered with an error: the proxy would not help
        blob = await viaProxy(url, signal); path = 'proxy'; // TypeError = blocked by CORS or offline
      }
    }
  } catch (e) {
    if (isAbort(e)) throw new CancelError();
    if (e instanceof AppError) throw e;
    throw new AppError('err_network', null, String(e?.message || e));
  }
  if (!blob.size) throw new AppError('err_audio_empty');
  ls.set(PATH_KEY, path);
  return { blob, path };
}

// ---------- WAV ----------
const u32 = (dv, o) => dv.getUint32(o, true);
const u16 = (dv, o) => dv.getUint16(o, true);
const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/** Read the header of a WAV blob without loading the audio data. */
export async function parseWav(blob) {
  const buf = await blob.slice(0, 65536).arrayBuffer();
  const dv = new DataView(buf);
  if (buf.byteLength < 44 || tag(dv, 0) !== 'RIFF' || tag(dv, 8) !== 'WAVE') throw new AppError('err_not_wav');
  let o = 12, fmt = null;
  while (o + 8 <= buf.byteLength) {
    const id = tag(dv, o); let size = u32(dv, o + 4);
    if (id === 'fmt ') {
      fmt = {
        bytes: new Uint8Array(buf.slice(o + 8, o + 8 + size)),
        format: u16(dv, o + 8), channels: u16(dv, o + 10), sampleRate: u32(dv, o + 12),
        blockAlign: u16(dv, o + 20), bits: u16(dv, o + 22),
      };
    } else if (id === 'data') {
      if (!fmt) throw new AppError('err_not_wav');
      const start = o + 8;
      if (size === 0 || size === 0xffffffff || start + size > blob.size) size = blob.size - start; // streamed/odd headers
      return { ...fmt, dataOffset: start, dataSize: size - (size % fmt.blockAlign) };
    }
    o += 8 + size + (size % 2);
  }
  throw new AppError('err_not_wav');
}

/** Merge WAV blobs into one WAV. pauseAfter[i] is 'para' | 'sentence' (silence inserted after chunk i). */
export function mergeWav(blobs, pauseAfter = []) {
  return mergeWavParts(blobs, pauseAfter.map((p) => PAUSE_MS[p] ?? 0));
}

/** Same, with explicit silence in milliseconds after each blob (gapsMs[i] goes between blob i and i+1). */
export async function mergeWavParts(blobs, gapsMs = []) {
  const infos = [];
  for (let i = 0; i < blobs.length; i++) {
    try { infos.push(await parseWav(blobs[i])); } catch (e) { throw e instanceof AppError ? new AppError(e.key, { n: i + 1 }) : e; }
  }
  const f = infos[0];
  infos.forEach((x, i) => {
    if (x.format !== f.format || x.channels !== f.channels || x.sampleRate !== f.sampleRate || x.bits !== f.bits)
      throw new AppError('err_wav_mismatch', { n: i + 1 });
  });
  const parts = [];
  let total = 0;
  const bytesPerSec = f.sampleRate * f.blockAlign;
  blobs.forEach((b, i) => {
    const x = infos[i];
    parts.push(b.slice(x.dataOffset, x.dataOffset + x.dataSize)); // lazy slice: does not copy into memory
    total += x.dataSize;
    if (i < blobs.length - 1) {
      const n = Math.round(((gapsMs[i] ?? 0) / 1000) * bytesPerSec / f.blockAlign) * f.blockAlign;
      if (n > 0) { parts.push(new Uint8Array(n)); total += n; } // zeros = silence for int PCM and float
    }
  });
  return { blob: finishWav(f.bytes, parts, total), seconds: total / bytesPerSec, info: f };
}

/** Build the final WAV blob: header (copying the fmt chunk bytes) + data parts. */
export function finishWav(fmtBytes, parts, total) {
  const fmtLen = fmtBytes.length;
  const head = new ArrayBuffer(12 + 8 + fmtLen + (fmtLen % 2) + 8);
  const dv = new DataView(head);
  const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  const riff = head.byteLength - 8 + total;
  if (riff > 0xffffffff) throw new AppError('err_wav_too_big');
  w(0, 'RIFF'); dv.setUint32(4, riff, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, fmtLen, true);
  new Uint8Array(head, 20, fmtLen).set(fmtBytes);
  const dataHdr = 20 + fmtLen + (fmtLen % 2);
  w(dataHdr, 'data'); dv.setUint32(dataHdr + 4, total, true);
  return new Blob([head, ...parts], { type: 'audio/wav' });
}

/** Trigger a browser download of a blob. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export { MAX_PROXY_BYTES };
