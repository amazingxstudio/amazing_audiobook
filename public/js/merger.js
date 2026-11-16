// Audio EDIT tool: join many audio files (wav / mp3 / m4a / ogg ...) into one long WAV file. No generation involved.
// Fast path: all inputs are 16-bit PCM WAV with the same rate/channels -> lazy concatenation (no decoding, low memory).
// General path: every file is decoded (Chrome), resampled to one rate, converted to 16-bit PCM and appended.
import { parseWav, mergeWavParts, finishWav } from './audio.js';
import { decodeAudio } from './refaudio.js';
import { AppError, CancelError } from './errors.js';

const MAX_BYTES = 0xffffffff - 1024; // WAV size limit (4 GB)

/** items: [{ blob, name }]; gapMs: silence between files. onProgress(done, total). Returns { blob, seconds }. */
export async function mergeAudioFiles(items, { gapMs = 300, onProgress, signal } = {}) {
  if (items.length < 2) throw new AppError('err_merge_need_two');
  const gaps = items.slice(1).map(() => gapMs);
  const check = () => { if (signal?.aborted) throw new CancelError(); };

  // --- fast path ---
  const infos = [];
  for (const it of items) { try { infos.push(await parseWav(it.blob)); } catch { infos.length = 0; break; } }
  const f = infos[0];
  if (infos.length === items.length && infos.every((x) => x.format === 1 && x.bits === 16 && x.sampleRate === f.sampleRate && x.channels === f.channels)) {
    const r = await mergeWavParts(items.map((i) => i.blob), gaps);
    onProgress?.(items.length, items.length);
    return { blob: r.blob, seconds: r.seconds };
  }

  // --- general path ---
  const rate = infos.length ? Math.max(...infos.map((x) => x.sampleRate)) : 44100;
  const targetRate = Math.min(48000, rate);
  let channels = 0;
  const parts = [];
  let total = 0, frames = 0;
  for (let i = 0; i < items.length; i++) {
    check();
    let buf;
    try { buf = await decodeAudio(items[i].blob, targetRate); }
    catch (e) { throw new AppError('err_merge_decode', { name: items[i].name }, e.detail || e.message); }
    if (!channels) channels = buf.numberOfChannels >= 2 ? 2 : 1;   // first file decides mono / stereo
    const n = buf.length, pcm = new Int16Array(n * channels);
    const chData = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < channels; c++) {
        let v;
        if (channels === 1) { v = 0; for (const d of chData) v += d[k]; v /= chData.length; }
        else v = chData[Math.min(c, chData.length - 1)][k];
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        pcm[k * channels + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }
    parts.push(pcm); total += pcm.byteLength; frames += n;
    if (i < items.length - 1 && gapMs > 0) { const g = new Int16Array(Math.round(targetRate * gapMs / 1000) * channels); parts.push(g); total += g.byteLength; frames += g.length / channels; }
    if (total > MAX_BYTES) throw new AppError('err_wav_too_big');
    onProgress?.(i + 1, items.length);
    await new Promise((r) => setTimeout(r)); // keep the page responsive
  }
  const fmt = new Uint8Array(16), dv = new DataView(fmt.buffer);
  dv.setUint16(0, 1, true); dv.setUint16(2, channels, true); dv.setUint32(4, targetRate, true);
  dv.setUint32(8, targetRate * channels * 2, true); dv.setUint16(12, channels * 2, true); dv.setUint16(14, 16, true);
  return { blob: finishWav(fmt, parts, total), seconds: frames / targetRate };
}
