// Reference-voice helpers: decode any audio file, convert to 16 kHz mono WAV (what the Space needs), base64.
import { AppError } from './errors.js';

const REF_RATE = 16000;
const MAX_B64 = 3.2 * 1024 * 1024;

/** Decode an audio blob into an AudioBuffer resampled to `rate` (works for wav/mp3/m4a/ogg that Chrome can decode). */
export async function decodeAudio(blob, rate) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new AppError('err_decode_unsupported');
  const ctx = new Ctx(1, 1, rate);
  try { return await ctx.decodeAudioData(await blob.arrayBuffer()); }
  catch (e) { throw new AppError('err_decode', null, String(e?.message || e)); }
}

/** Float32 channel data -> 16-bit PCM WAV blob. channels: array of Float32Array (same length). */
export function floatsToWav(channels, rate) {
  const n = channels[0].length, nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * nc * 2, true);
  dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

export const mixToMono = (buf) => {
  const nc = buf.numberOfChannels, n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < nc; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / nc; }
  return out;
};

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Prepare a reference clip. opts.maxSec: cut the clip to this length (only safe when NO transcript is used,
 * because a transcript must match the whole audio). opts.skipSilence: drop leading silence.
 * Returns { blob, seconds, b64len }.
 */
export async function prepareRef(blob, { maxSec = 0, skipSilence = true } = {}) {
  const buf = await decodeAudio(blob, REF_RATE);
  let data = mixToMono(buf);
  if (skipSilence) { let i = 0; while (i < data.length && Math.abs(data[i]) < 0.01) i++; data = data.subarray(Math.max(0, i - 800)); }
  if (maxSec && data.length > maxSec * REF_RATE) data = data.subarray(0, Math.floor(maxSec * REF_RATE));
  if (data.length < REF_RATE * 1.5) throw new AppError('err_ref_short');
  const out = floatsToWav([data], REF_RATE);
  const b64len = Math.ceil(out.size / 3) * 4;
  if (b64len > MAX_B64) throw new AppError('err_ref_too_big');
  return { blob: out, seconds: data.length / REF_RATE, b64len };
}

/** Duration in seconds from file metadata (cheap; no full decode). null if unknown. */
export function blobDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio(), url = URL.createObjectURL(blob);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    a.src = url;
  });
}
