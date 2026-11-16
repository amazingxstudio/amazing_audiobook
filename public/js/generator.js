// Generation: per-chapter jobs + a whole-book runner.
// One request at a time, 3 attempts per chunk, pause / resume / cancel, retry failed chunks only,
// finished chunks are skipped. VOICE LOCK: the first generated chunk of a voice (or the user's sample) is kept as a
// reference clip and sent with every later request, so the same voice speaks every chunk.
import { planChapter } from './chunker.js';
import { SequentialQueue, withRetry } from './queue.js';
import { putAudio, audioKeys, getAudioBlob, saveBook } from './store.js';
import { fetchAudioBlob } from './audio.js';
import { prepareRef, blobToBase64 } from './refaudio.js';
import { AppError, CancelError, toAppError } from './errors.js';
import { getSettings } from './settings.js';
import { uid } from './store.js';

const jobs = new Map();   // "<bookId>:<chapterId>" -> ChapterJob
const runs = new Map();   // bookId -> BookRun
let active = null;        // only one job may run at a time (the Space handles one request at a time)
const STOP_AFTER_FAILS = 3;

export const getJob = (bookId, chapterId) => jobs.get(`${bookId}:${chapterId}`);
export const getRun = (bookId) => runs.get(bookId);
export const isBusy = () => !!active && ['running', 'paused'].includes(active.state);

/** Call the endpoint. POST /api/tts {text, control, cfg, ref?: {b64, text?}} -> {url}. `space` is an optional override. */
export async function requestTts({ text, control, cfg, ref }, signal) {
  const space = getSettings().space.trim();
  let r;
  try {
    r = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ text, control, cfg, ...(space ? { space } : {}), ...(ref ? { ref } : {}) }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new CancelError();
    throw new AppError('err_network', null, String(e?.message || e));
  }
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON body (e.g. a Vercel timeout page) */ }
  if (!r.ok) {
    const msg = String(data.error || '');
    const e = new AppError(r.status === 404 ? 'err_tts_404' : r.status === 504 || r.status === 408 ? 'err_tts_timeout' : r.status === 413 ? 'err_ref_too_big' : 'err_tts_http', { status: r.status }, msg);
    if (r.status === 429 || /rate|quota|queue|too many|exceeded/i.test(msg)) { e.key = 'err_tts_rate'; e.rateLimited = true; }
    if (r.status === 400 || r.status === 413) e.fatal = true;
    throw e;
  }
  if (!data.url) throw new AppError('err_tts_nourl', null, JSON.stringify(data).slice(0, 200));
  return data.url;
}

// ---- voice reference (clone / lock) ----
const refCache = new Map();
export const refKey = (bookId, voiceId) => `ref:${bookId}:${voiceId}`;
export function forgetRef(bookId, voiceId) { refCache.delete(refKey(bookId, voiceId)); }

/** The reference clip to send for a voice: { b64, text? } or null when the voice has none yet. */
export async function loadRef(book, voice) {
  if (!voice.hasRef) return null;
  const k = refKey(book.id, voice.id);
  const hit = refCache.get(k);
  if (hit && hit.refId === voice.refId && hit.text === voice.refText) return hit.ref;
  const blob = await getAudioBlob(k);
  if (!blob) return null;
  const ref = { b64: await blobToBase64(blob), ...(voice.refText ? { text: voice.refText } : {}) };
  refCache.set(k, { refId: voice.refId, text: voice.refText, ref });
  return ref;
}

/**
 * Make `audioBlob` the locked voice of `voice` (used for: first generated chunk, "keep this voice", user sample).
 * `text` must be the exact words spoken in the audio (empty for a sample without transcript).
 * newId=true starts a new voice identity (chunks made with another voice are no longer reused).
 */
export async function setVoiceRef(book, voice, audioBlob, text, source, { newId = false, maxSec = 0 } = {}) {
  const prep = await prepareRef(audioBlob, { maxSec, skipSilence: !text });
  if (text && prep.seconds > 40) throw new AppError('err_ref_long', { s: Math.round(prep.seconds) });
  await putAudio({ key: refKey(book.id, voice.id), bookId: book.id, kind: 'ref', blob: prep.blob });
  forgetRef(book.id, voice.id);
  Object.assign(voice, { hasRef: true, refSource: source, refText: text || '', refSeconds: Math.round(prep.seconds) });
  if (newId) voice.refId = uid();
  await saveBook(book);
  document.dispatchEvent(new CustomEvent('voicechange', { detail: { bookId: book.id, voiceId: voice.id } })); // lets open voice boxes redraw
  return prep;
}
export async function clearVoiceRef(book, voice) {
  const { deleteAudio } = await import('./store.js');
  await deleteAudio(refKey(book.id, voice.id)).catch(() => {});
  forgetRef(book.id, voice.id);
  Object.assign(voice, { hasRef: false, refSource: '', refText: '', refName: '', refSeconds: 0, refId: uid() });
  await saveBook(book);
  document.dispatchEvent(new CustomEvent('voicechange', { detail: { bookId: book.id, voiceId: voice.id } }));
}
/** Delete stored chunk audio of this book that no chapter needs any more (e.g. made with a replaced voice). */
export async function pruneBookAudio(book) {
  const { chunkSize, cfg } = getSettings();
  const valid = new Set();
  for (const ch of book.chapters) for (const c of planChapter(book, ch, { chunkSize, cfg })) valid.add(c.key);
  const { deleteAudio } = await import('./store.js');
  let n = 0;
  for (const k of await audioKeys(book.id)) if (!k.startsWith('ref:') && !valid.has(k)) { await deleteAudio(k); n++; }
  return n;
}

export class ChapterJob {
  constructor(book, chapter) {
    this.book = book; this.chapter = chapter;
    this.state = 'idle';        // idle | running | paused | complete | incomplete | canceled
    this.plan = []; this.statuses = []; this.lastError = null; this.retryNote = null; this.autoPaused = false;
    this.listeners = new Set(); this.queue = null;
    jobs.set(`${book.id}:${chapter.id}`, this);
  }
  /** The one job object per chapter (so every screen listens to the same job). */
  static for(book, chapter) {
    const ex = jobs.get(`${book.id}:${chapter.id}`);
    if (ex) { if (ex.state !== 'running' && ex.state !== 'paused') { ex.book = book; ex.chapter = chapter; } return ex; }
    return new ChapterJob(book, chapter);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => f(this)); }
  get done() { return this.statuses.filter((s) => s === 'done').length; }
  get failed() { return this.statuses.filter((s) => s === 'failed').length; }

  /** (Re)compute the plan and mark chunks whose audio is already stored. */
  async refresh() {
    if (this.state === 'running' || this.state === 'paused') return;
    const { chunkSize, cfg } = getSettings();
    this.plan = planChapter(this.book, this.chapter, { chunkSize, cfg });
    const have = await audioKeys(this.book.id);
    this.statuses = this.plan.map((c) => (have.has(c.key) ? 'done' : 'pending'));
    this.state = this.plan.length && this.done === this.plan.length ? 'complete' : this.done ? 'incomplete' : 'idle';
    this.emit();
  }

  async start({ onlyFailed = false } = {}) {
    if (active && active !== this && ['running', 'paused'].includes(active.state)) throw new AppError('err_busy');
    if (this.state === 'running' || this.state === 'paused') return;
    if (!onlyFailed) await this.refresh();
    if (!this.plan.length) throw new AppError('err_empty_chapter');
    active = this; this.state = 'running'; this.lastError = null; this.emit();
    const q = this.queue = new SequentialQueue();
    const { cfg } = getSettings();
    let streak = 0;
    const tasks = [];
    this.plan.forEach((c, i) => {
      const st = this.statuses[i];
      if (st === 'done' || (onlyFailed && st !== 'failed')) return;
      if (st === 'failed') this.statuses[i] = 'pending';
      tasks.push(q.add(async (signal) => {
        this.statuses[i] = 'active'; this.retryNote = null; this.emit();
        try {
          await withRetry(async () => {
            const voice = this.book.voices.find((v) => v.id === c.speaker) || this.book.voices[0];
            const ref = await loadRef(this.book, voice);
            const url = await requestTts({ text: c.text, control: c.control, cfg, ref }, signal);
            const { blob } = await fetchAudioBlob(url, { signal });
            await putAudio({ key: c.key, bookId: this.book.id, kind: 'chunk', blob });
            if (!voice.hasRef) { // first chunk of this voice: lock it so every later chunk sounds the same
              try { await setVoiceRef(this.book, voice, blob, c.text, 'auto'); }
              catch (e) { const ae = toAppError(e); if (ae.key !== 'err_ref_short') this.warn = ae; } // a too-short chunk is simply not used as the voice; the next one is tried
            }
          }, {
            signal, attempts: 3, shouldRetry: (e) => !e.fatal && e.key !== 'err_storage' && e.key !== 'err_audio_too_big',
            onRetry: (n, wait, e) => { this.retryNote = { n: n + 1, secs: Math.round(wait / 1000), e }; this.emit(); },
          });
          this.statuses[i] = 'done'; streak = 0;
        } catch (e) {
          if (e instanceof CancelError) { this.statuses[i] = 'pending'; throw e; }
          this.statuses[i] = 'failed'; this.lastError = toAppError(e); streak++;
          if (streak >= STOP_AFTER_FAILS && !q.paused) { q.pause(); this.state = 'paused'; this.autoPaused = true; }
        }
        this.retryNote = null; this.emit();
      }).catch((e) => { if (!(e instanceof CancelError)) throw e; }));
    });
    await Promise.all(tasks);
    if (this.state !== 'canceled') this.state = this.done === this.plan.length ? 'complete' : 'incomplete';
    if (active === this) active = null;
    this.emit();
  }
  pause() { if (this.state === 'running') { this.queue.pause(); this.state = 'paused'; this.emit(); } }
  resume() { if (this.state === 'paused') { this.autoPaused = false; this.state = 'running'; this.queue.resume(); this.emit(); } }
  cancel() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.state = 'canceled'; this.queue.cancel();
    this.statuses = this.statuses.map((s) => (s === 'active' ? 'pending' : s));
    if (active === this) active = null;
    this.emit();
    setTimeout(() => this.refresh(), 0);
  }
}

/** Generate the whole book chapter by chapter (stops at the first chapter that ends incomplete). */
export class BookRun {
  constructor(book) { this.book = book; this.state = 'idle'; this.current = null; this.listeners = new Set(); this.error = null; runs.set(book.id, this); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => f(this)); }
  job(ch) { return ChapterJob.for(this.book, ch); }
  async start() {
    if (isBusy()) throw new AppError('err_busy');
    this.state = 'running'; this.error = null; this.emit();
    for (const ch of this.book.chapters) {
      if (this.state === 'canceled') break;
      const job = this.job(ch);
      await job.refresh();
      if (job.state === 'complete' || !job.plan.length) continue;
      this.current = job; this.emit();
      const off = job.on(() => this.emit());
      try { await job.start(); } catch (e) { this.error = toAppError(e); this.state = 'stopped'; off(); break; }
      off();
      if (this.state === 'canceled') break;
      if (job.state !== 'complete') { this.error = job.lastError; this.state = 'stopped'; break; }
    }
    if (this.state === 'running') this.state = 'done';
    this.current = null; this.emit();
  }
  pause() { if (this.current?.state === 'running') { this.current.pause(); this.state = 'paused'; this.emit(); } }
  resume() { if (this.current?.state === 'paused') { this.state = 'running'; this.current.resume(); this.emit(); } }
  cancel() { if (['running', 'paused'].includes(this.state)) { this.state = 'canceled'; this.current?.cancel(); this.emit(); } }
}
