// Per-chapter generation job: skips chunks already stored, one request at a time, 3 attempts per chunk,
// pause / resume / cancel, retry of failed chunks only.
import { planChapter } from './chunker.js';
import { SequentialQueue, withRetry } from './queue.js';
import { putAudio, audioKeys } from './store.js';
import { fetchAudioBlob } from './audio.js';
import { AppError, CancelError, toAppError } from './errors.js';
import { getSettings } from './settings.js';

const jobs = new Map();   // "<bookId>:<chapterId>" -> ChapterJob (kept so the UI can come back to a running job)
let active = null;        // only one job may run at a time (the Space handles one request at a time)
const STOP_AFTER_FAILS = 3; // auto-pause after this many chunks in a row fail (Space is probably down / rate limited)

export const getJob = (bookId, chapterId) => jobs.get(`${bookId}:${chapterId}`);
export const isBusy = () => !!active && ['running', 'paused'].includes(active.state);
export const activeJob = () => active;

/** Call the existing endpoint. Contract unchanged: POST /api/tts {text, control, cfg} -> {url}. `space` is optional (override). */
export async function requestTts({ text, control, cfg }, signal) {
  const space = getSettings().space.trim();
  let r;
  try {
    r = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ text, control, cfg, ...(space ? { space } : {}) }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new CancelError();
    throw new AppError('err_network', null, String(e?.message || e));
  }
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON body (e.g. a Vercel timeout page) */ }
  if (!r.ok) {
    const msg = String(data.error || '');
    const e = new AppError(r.status === 404 ? 'err_tts_404' : r.status === 504 || r.status === 408 ? 'err_tts_timeout' : 'err_tts_http', { status: r.status }, msg);
    if (r.status === 429 || /rate|quota|queue|too many|exceeded/i.test(msg)) { e.key = 'err_tts_rate'; e.rateLimited = true; }
    if (r.status === 400) e.fatal = true;
    throw e;
  }
  if (!data.url) throw new AppError('err_tts_nourl', null, JSON.stringify(data).slice(0, 200));
  return data.url;
}

export class ChapterJob {
  constructor(book, chapter) {
    this.book = book; this.chapter = chapter;
    this.state = 'idle';        // idle | running | paused | complete | incomplete | canceled
    this.plan = []; this.statuses = []; this.lastError = null; this.retryNote = null;
    this.listeners = new Set();
    this.queue = null;
    jobs.set(`${book.id}:${chapter.id}`, this);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => f(this)); }
  get done() { return this.statuses.filter((s) => s === 'done').length; }
  get failed() { return this.statuses.filter((s) => s === 'failed').length; }

  /** (Re)compute the plan and mark chunks whose audio is already stored. Safe to call when not running. */
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
    if (!onlyFailed) await this.refresh(); // pick up what is stored (skips finished chunks)
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
            const url = await requestTts({ text: c.text, control: c.control, cfg }, signal);
            const { blob } = await fetchAudioBlob(url, { signal });
            await putAudio({ key: c.key, bookId: this.book.id, kind: 'chunk', blob });
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
