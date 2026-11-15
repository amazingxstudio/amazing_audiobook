// Player: chapter list, play/pause, previous/next chunk, speed, remembers position per book, WAV download per chapter.
import { h, T, tAttr, clear } from '../dom.js';
import { t, setT } from '../i18n.js';
import { listBooks, getBook, audioKeys, getAudioBlob } from '../store.js';
import { planChapter } from '../chunker.js';
import { ChunkPlayer } from '../player.js';
import { getSettings, saveSettings, ls } from '../settings.js';
import { showError, showNotice, segBar } from '../ui.js';
import { downloadChapterWav } from '../chapter-audio.js';

let root, ctx;
const P = { book: null, books: [], chIdx: 0, plan: [], have: new Set(), idx: 0, playing: false, savedAt: 0 };
let player = null;
const posKey = (id) => 'ab.pos.' + id;

export function mount(el, c) { root = el; ctx = c; }

function getPlayer() {
  if (player) return player;
  player = new ChunkPlayer({
    getBlob: (key) => getAudioBlob(key),
    onState: (p) => { P.playing = p; updatePlayBtn(); if (!p) savePos(true); },
    onChunk: (i) => { P.idx = i; updateNow(); savePos(true); mediaMeta(); },
    onTime: () => savePos(false),
    onError: (e) => showError(Object.assign(new Error(e.key), { key: e.key, args: e.args, detail: e.detail || '' })),
    onChapterEnd: () => nextChapter(),
  });
  player.setRate(getSettings().rate);
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(true); });
  return player;
}

function savePos(force) {
  if (!P.book || !P.plan.length) return;
  const now = Date.now();
  if (!force && now - P.savedAt < 2000) return;
  P.savedAt = now;
  const pos = player ? player.position : { idx: P.idx, time: 0 };
  ls.set(posKey(P.book.id), JSON.stringify({ chapterId: P.book.chapters[P.chIdx].id, idx: pos.idx, time: pos.time }));
}
function mediaMeta() {
  if ('mediaSession' in navigator && P.book && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: P.book.chapters[P.chIdx]?.title || '', artist: P.book.title });
  }
}

async function loadChapter(chIdx, idx = 0, time = 0, autoplay = false) {
  const ch = P.book.chapters[chIdx];
  if (!ch) return;
  const { chunkSize, cfg } = getSettings();
  P.chIdx = chIdx; P.plan = planChapter(P.book, ch, { chunkSize, cfg });
  P.have = await audioKeys(P.book.id);
  P.idx = idx;
  render();
  await getPlayer().load(P.plan, idx, time, autoplay);
}
async function nextChapter() {
  const n = P.chIdx + 1;
  if (n >= P.book.chapters.length) { showNotice('pl_book_end'); return; }
  const nextPlan = planChapter(P.book, P.book.chapters[n], getSettings());
  P.have = await audioKeys(P.book.id);
  if (!nextPlan.length || !P.have.has(nextPlan[0].key)) { showNotice('pl_next_missing', { n: n + 1 }); return; }
  await loadChapter(n, 0, 0, true);
}

export async function show(bookId, chapterId) {
  try { P.books = await listBooks(); } catch (e) { showError(e); return; }
  const id = bookId || (P.book && P.book.id) || ls.get('ab.lastBook') || (P.books[0] && P.books[0].id);
  if (!id) { P.book = null; render(); return; }
  if (!P.book || P.book.id !== id || chapterId) {
    let b; try { b = await getBook(id); } catch (e) { showError(e); return; }
    if (!b) { P.book = null; render(); return; }
    if (player) player.pause();
    P.book = b; ls.set('ab.lastBook', id);
    let pos = null; try { pos = JSON.parse(ls.get(posKey(id), 'null')); } catch { /* ignore */ }
    let ci = 0, idx = 0, time = 0;
    if (chapterId) ci = Math.max(0, b.chapters.findIndex((c) => c.id === chapterId));
    else if (pos) { ci = Math.max(0, b.chapters.findIndex((c) => c.id === pos.chapterId)); idx = pos.idx || 0; time = pos.time || 0; }
    await loadChapter(ci, idx, time, false);
  } else { P.have = await audioKeys(P.book.id); render(); }
}

// ---------- UI ----------
let nowHost, playBtn;
function statuses() { return P.plan.map((c) => (P.have.has(c.key) ? 'done' : 'pending')); }

function updatePlayBtn() { if (playBtn) { setT(playBtn.querySelector('.lbl'), P.playing ? 'pl_pause' : 'pl_play'); playBtn.setAttribute('aria-pressed', String(P.playing)); } }
function updateNow() {
  if (!nowHost) return;
  clear(nowHost);
  const c = P.plan[P.idx];
  nowHost.append(
    T('pl_chunk_of', { n: P.plan.length ? P.idx + 1 : 0, total: P.plan.length }, 'p', { class: 'muted' }),
    h('p', { class: 'now-text', lang: 'my' }, c ? c.text : ''),
    segBar(statuses(), { current: P.idx, labelKey: 'seg_label_play' }));
}

function render() {
  clear(root);
  root.append(T('pl_title', null, 'h1', { class: 'view-title' }));
  if (!P.book) {
    root.append(h('section', { class: 'card' }, T('pl_empty', null, 'p'), h('a', { class: 'btn btn-primary', href: '#/library' }, T('back_library'))));
    return;
  }
  const sel = h('select', { class: 'input' });
  for (const b of P.books) sel.append(h('option', { value: b.id }, b.title));
  sel.value = P.book.id;
  sel.addEventListener('change', () => ctx.go('#/player/' + sel.value));
  const ch = P.book.chapters[P.chIdx];

  nowHost = h('div', { class: 'stack-tight' });
  playBtn = h('button', { class: 'btn btn-primary btn-big', type: 'button', 'aria-pressed': String(P.playing), onclick: () => guard(() => getPlayer().toggle()) },
    h('span', { class: 'lbl' }, ''));
  setT(playBtn.querySelector('.lbl'), P.playing ? 'pl_pause' : 'pl_play');

  const rates = [0.75, 1, 1.25, 1.5, 2];
  const cur = getSettings().rate;
  const rateRow = h('div', { class: 'seg-group', role: 'group' });
  tAttr(rateRow, 'aria', 'pl_speed'); rateRow.setAttribute('aria-label', t('pl_speed'));
  for (const r of rates) rateRow.append(h('button', { class: 'btn btn-quiet rate', type: 'button', 'aria-pressed': String(r === cur),
    onclick: () => { saveSettings({ rate: r }); getPlayer().setRate(r); rateRow.querySelectorAll('.rate').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === r + '×'))); } }, r + '×'));

  root.append(
    h('label', { class: 'field' }, T('pl_book', null, 'span', { class: 'field-label' }), sel),
    h('section', { class: 'card now' },
      h('h2', { class: 'ch-title' }, ch.title),
      nowHost,
      h('div', { class: 'row wrap controls' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => guard(() => getPlayer().prev()) }, T('pl_prev')),
        playBtn,
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => guard(() => getPlayer().next()) }, T('pl_next'))),
      h('div', { class: 'field' }, T('pl_speed', null, 'span', { class: 'field-label' }), rateRow)),
    T('pl_chapters', null, 'h2'),
    chapterList());
  updateNow();
}

function guard(fn) { try { const r = fn(); if (r && r.catch) r.catch(showError); } catch (e) { showError(e); } }

function chapterList() {
  const { chunkSize, cfg } = getSettings();
  const list = h('div', { class: 'stack' });
  P.book.chapters.forEach((ch, i) => {
    const plan = i === P.chIdx ? P.plan : planChapter(P.book, ch, { chunkSize, cfg });
    const ready = plan.filter((c) => P.have.has(c.key)).length;
    list.append(h('article', { class: 'card' + (i === P.chIdx ? ' card-current' : '') },
      h('h3', { class: 'ch-title' }, ch.title),
      h('div', { class: 'chips' }, T('pl_ready', { n: ready, total: plan.length }, 'span', { class: 'chip' })),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', disabled: !ready, onclick: () => guard(() => loadChapter(i, 0, 0, true)) }, T('pl_play_chapter')),
        h('button', { class: 'btn btn-quiet', type: 'button', disabled: !ready,
          onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { await downloadChapterWav(P.book, ch); } catch (err) { showError(err); }
            b.disabled = false;
          } }, T('gen_download')))));
  });
  return list;
}
