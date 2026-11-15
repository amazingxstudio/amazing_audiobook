// Gapless-ish chunk player: two <audio> elements ping-pong; the next chunk is loaded into the idle one
// while the current one plays. Chunk blobs come from IndexedDB.
import { PAUSE_MS } from './chunker.js';

export class ChunkPlayer {
  constructor({ getBlob, onState, onChunk, onTime, onError, onChapterEnd }) {
    Object.assign(this, { getBlob, onState, onChunk, onTime, onError, onChapterEnd });
    this.slots = [0, 1].map(() => ({ a: new Audio(), url: null, idx: -1 }));
    this.cur = 0; this.chunks = []; this.idx = 0; this.rate = 1;
    this.token = 0; this.timer = null; this.pendingAdvance = false; this.playing = false;
    this.slots.forEach((s, i) => {
      s.a.preload = 'auto';
      s.a.addEventListener('ended', () => i === this.cur && this.#ended());
      s.a.addEventListener('timeupdate', () => i === this.cur && this.onTime?.(s.a.currentTime, s.a.duration));
      s.a.addEventListener('error', () => i === this.cur && s.url && this.onError?.({ key: 'err_play', args: null, detail: s.a.error?.message || '' }));
    });
  }
  get position() { return { idx: this.idx, time: this.slots[this.cur].a.currentTime || 0 }; }

  /** Load a chapter's chunk list ([{key,pauseAfter,...}]) and optionally start playing at idx/time. */
  async load(chunks, idx = 0, time = 0, autoplay = false) {
    this.#stopAll(); this.chunks = chunks;
    this.idx = Math.min(Math.max(0, idx), Math.max(0, chunks.length - 1));
    this.resumeTime = time || 0;
    this.onChunk?.(this.idx);
    if (autoplay) await this.#start(this.idx, time); else this.#state(false);
  }
  async play() {
    if (!this.chunks.length) return;
    if (this.pendingAdvance) { this.pendingAdvance = false; return this.#start(this.idx + 1, 0); }
    const s = this.slots[this.cur];
    if (s.url && s.idx === this.idx && s.a.currentTime > 0 && !s.a.ended) { // resume a paused chunk
      try { await s.a.play(); this.#state(true); } catch (e) { this.onError?.({ key: 'err_play', detail: String(e.message || e) }); }
      return;
    }
    const t = this.resumeTime || 0; this.resumeTime = 0;
    return this.#start(this.idx, t);
  }
  pause() {
    clearTimeout(this.timer); this.timer = null;
    if (this.waiting) { this.pendingAdvance = true; this.waiting = false; } // paused during the gap between chunks
    this.slots.forEach((s) => s.a.pause());
    this.#state(false);
  }
  toggle() { return this.playing ? this.pause() : this.play(); }
  next() { return this.chunks.length && this.idx < this.chunks.length - 1 ? this.#start(this.idx + 1, 0) : undefined; }
  prev() {
    if (!this.chunks.length) return;
    const t = this.slots[this.cur].a.currentTime;
    return this.#start(t > 3 || this.idx === 0 ? this.idx : this.idx - 1, 0);
  }
  seek(idx) { return this.#start(idx, 0); }
  setRate(r) { this.rate = r; this.slots.forEach((s) => { s.a.defaultPlaybackRate = r; s.a.playbackRate = r; }); } // load() resets playbackRate, so set both
  destroy() { this.#stopAll(); }

  #state(p) { this.playing = p; this.onState?.(p); }
  #stopAll() {
    this.token++; clearTimeout(this.timer); this.waiting = false; this.pendingAdvance = false;
    this.slots.forEach((s) => { s.a.pause(); s.a.removeAttribute('src'); if (s.url) URL.revokeObjectURL(s.url); s.url = null; s.idx = -1; });
    this.#state(false);
  }
  async #prepare(slot, idx) {
    if (idx < 0 || idx >= this.chunks.length) return false;
    if (slot.idx === idx && slot.url) return true;
    const blob = await this.getBlob(this.chunks[idx].key);
    if (!blob) return false;
    if (slot.url) URL.revokeObjectURL(slot.url);
    slot.url = URL.createObjectURL(blob); slot.idx = idx;
    slot.a.src = slot.url; slot.a.defaultPlaybackRate = this.rate; slot.a.playbackRate = this.rate; slot.a.load();
    return true;
  }
  async #start(idx, time) {
    const my = ++this.token; clearTimeout(this.timer); this.waiting = false; this.pendingAdvance = false;
    if (idx >= this.chunks.length) return this.#finish();
    this.slots.forEach((s) => s.a.pause());
    // the idle slot may already hold this chunk (preloaded)
    let slotNo = this.slots.findIndex((s) => s.idx === idx && s.url);
    if (slotNo < 0) { slotNo = this.cur; if (!(await this.#prepare(this.slots[slotNo], idx)) || my !== this.token) return this.#missing(idx, my); }
    this.cur = slotNo; this.idx = idx; this.onChunk?.(idx);
    const a = this.slots[slotNo].a;
    try { a.currentTime = time || 0; await a.play(); } catch (e) {
      if (my === this.token) { this.#state(false); this.onError?.({ key: 'err_play', detail: String(e.message || e) }); }
      return;
    }
    if (my !== this.token) return;
    this.#state(true); this.#mediaSession();
    this.#prepare(this.slots[1 - slotNo], idx + 1); // preload next
  }
  #missing(idx, my) {
    if (my !== this.token) return;
    this.#state(false);
    this.onError?.({ key: 'err_chunk_missing', args: { n: idx + 1 } });
  }
  #ended() {
    const gap = PAUSE_MS[this.chunks[this.idx]?.pauseAfter] ?? 0;
    const go = () => { this.waiting = false; this.#start(this.idx + 1, 0); };
    if (this.idx + 1 >= this.chunks.length) return this.#finish();
    // sentence gaps are kept very short so listening feels continuous; paragraph gaps are longer
    if (gap > 0) { this.waiting = true; this.timer = setTimeout(go, gap); } else go();
  }
  #finish() { this.#state(false); this.onChapterEnd?.(); }
  #mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const h = { play: () => this.play(), pause: () => this.pause(), previoustrack: () => this.prev(), nexttrack: () => this.next() };
    for (const [k, f] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, f); } catch { /* unsupported action */ } }
  }
}
