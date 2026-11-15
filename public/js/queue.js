// Sequential queue (one task at a time) with pause / resume / cancel, and a retry helper with backoff.
import { CancelError } from './errors.js';

export class SequentialQueue {
  #items = []; #running = false; #paused = false; #cancelled = false;
  constructor() { this.controller = new AbortController(); }
  get signal() { return this.controller.signal; }
  get paused() { return this.#paused; }
  /** fn(signal) runs when it is this task's turn. Returns a promise for its result. */
  add(fn) {
    return new Promise((resolve, reject) => {
      if (this.#cancelled) return reject(new CancelError());
      this.#items.push({ fn, resolve, reject });
      this.#pump();
    });
  }
  pause() { this.#paused = true; }              // the running task finishes; the next one waits
  resume() { this.#paused = false; this.#pump(); }
  cancel() {
    this.#cancelled = true;
    this.controller.abort();
    for (const it of this.#items.splice(0)) it.reject(new CancelError());
  }
  async #pump() {
    if (this.#running) return;
    this.#running = true;
    while (this.#items.length && !this.#paused && !this.#cancelled) {
      const it = this.#items.shift();
      try { it.resolve(await it.fn(this.signal)); } catch (e) { it.reject(e); }
    }
    this.#running = false;
  }
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(new CancelError());
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); res(); }, ms);
  const onAbort = () => { clearTimeout(t); rej(new CancelError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/**
 * Run fn() up to `attempts` times. Waits delays[n] (+ jitter) between attempts; rate-limit errors wait longer.
 * Never retries cancellation or errors where shouldRetry(e) is false (e.g. a bad request).
 */
export async function withRetry(fn, { attempts = 3, delays = [2000, 6000], rateDelay = 15000, signal, onRetry, shouldRetry = () => true } = {}) {
  let last;
  for (let n = 1; n <= attempts; n++) {
    try { return await fn(n); } catch (e) {
      if (e instanceof CancelError || e?.name === 'AbortError' || signal?.aborted) throw new CancelError();
      last = e;
      if (n === attempts || !shouldRetry(e)) break;
      const base = e?.rateLimited ? rateDelay : (delays[n - 1] ?? delays[delays.length - 1]);
      const wait = base + Math.floor(Math.random() * 500);
      onRetry?.(n, wait, e);
      await sleep(wait, signal);
    }
  }
  throw last;
}
