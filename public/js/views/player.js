// Player: big play button, chapter list, previous/next chunk, speed, remembers position per book, WAV download per chapter.
import { h, T, tAttr, clear, add } from '../dom.js';
import { t, setT } from '../i18n.js';
import { listBooks, getBook, audioKeys, getAudioBlob } from '../store.js';
import { planChapter } from '../chunker.js';
import { ChunkPlayer } from '../player.js';
import { getSettings, saveSettings, ls } from '../settings.js';
import { slot, showIn, hintIn, segBar, panel, run } from '../ui.js';
import { downloadChapterWav } from '../chapter-audio.js';

let root, ctx;
const P = { book: null, books: [], chIdx: 0, plan: [], have: new Set(), idx: 0, playing: false, savedAt: 0 };
let player = null, errSlot = null;
const posKey = (id) => 'ab.pos.' + id;

export function mount(el, c) { root = el; ctx = c; }

function getPlayer() {
  if (player) return player;
  player = new ChunkPlayer({
    getBlob: (key) => getAudioBlob(key),
    onState: (p) => { P.playing = p; updatePlayBtn(); if (!p) savePos(true); },
    onChunk: (i) => { P.idx = i; updateNow(); savePos(true); mediaMeta(); },
    onTime: () => savePos(false),
    onError: (e) => errSlot && showIn(errSlot, Object.assign(new Error(e.key), { key: e.key, args: e.args, detail: e.detail || '' })),
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
  if (n >= P.book.chapters.length) { errSlot && hintIn(errSlot, 'pl_book_end', null, 0); return; }
  const nextPlan = planChapter(P.book, P.book.chapters[n], getSettings());
  P.have = await audioKeys(P.book.id);
  if (!nextPlan.length || !P.have.has(nextPlan[0].key)) { errSlot && hintIn(errSlot, 'pl_next_missing', { n: n + 1 }, 0); return; }
  await loadChapter(n, 0, 0, true);
}

export async function show(bookId, chapterId) {
  try { P.books = await listBooks(); } catch (e) { render(); showIn(errSlot, e); return; }
  const id = bookId || (P.book && P.book.id) || ls.get('ab.lastBook') || (P.books[0] && P.books[0].id);
  if (!id) { P.book = null; render(); return; }
  if (!P.book || P.book.id !== id || chapterId) {
    let b;
    try { b = await getBook(id); } catch (e) { render(); showIn(errSlot, e); return; }
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
const statuses = () => P.plan.map((c) => (P.have.has(c.key) ? 'done' : 'pending'));
function updatePlayBtn() { if (playBtn) { setT(playBtn.querySelector('.lbl'), P.playing ? 'pl_pause' : 'pl_play'); playBtn.setAttribute('aria-pressed', String(P.playing)); } }
function updateNow() {
  if (!nowHost) return;
  clear(nowHost);
  const c = P.plan[P.idx];
  add(nowHost, T('pl_chunk_of', { n: P.plan.length ? P.idx + 1 : 0, total: P.plan.length }, 'p', { class: 'muted' }),
    h('p', { class: 'now-text', lang: 'my' }, c ? c.text : ''),
    segBar(statuses(), { current: P.idx, labelKey: 'seg_label_play' }));
}
const guard = (fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => showIn(errSlot, e)); } catch (e) { showIn(errSlot, e); } };

function render() {
  clear(root);
  errSlot = slot();
  root.append(h('div', { class: 'view-head' }, T('pl_title', null, 'h1', { class: 'view-title' })));
  if (!P.book) {
    root.append(panel({ titleKey: 'pl_empty_title', hintKey: 'pl_empty', icon: '▶' }, h('a', { class: 'btn btn-primary', href: '#/library' }, T('back_library')), errSlot));
    return;
  }
  const sel = h('select', { class: 'input' });
  for (const b of P.books) sel.append(h('option', { value: b.id }, b.title));
  sel.value = P.book.id;
  sel.addEventListener('change', () => ctx.go('#/player/' + sel.value));
  const ch = P.book.chapters[P.chIdx];

  nowHost = h('div', { class: 'stack-tight' });
  playBtn = h('button', { class: 'btn btn-primary btn-big', type: 'button', 'aria-pressed': String(P.playing), onclick: () => guard(() => getPlayer().toggle()) }, h('span', { class: 'lbl' }, ''));
  setT(playBtn.querySelector('.lbl'), P.playing ? 'pl_pause' : 'pl_play');

  const cur = getSettings().rate;
  const rateRow = h('div', { class: 'seg-group', role: 'group' });
  tAttr(rateRow, 'aria', 'pl_speed'); rateRow.setAttribute('aria-label', t('pl_speed'));
  for (const r of [0.75, 1, 1.25, 1.5, 2]) rateRow.append(h('button', { class: 'btn btn-quiet btn-sm rate', type: 'button', 'aria-pressed': String(r === cur),
    onclick: () => { saveSettings({ rate: r }); getPlayer().setRate(r); rateRow.querySelectorAll('.rate').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === r + '×'))); } }, r + '×'));

  root.append(
    panel({ titleKey: 'pl_now', icon: '▶' },
      P.books.length > 1 ? h('label', { class: 'field' }, T('pl_book', null, 'span', { class: 'field-label' }), sel) : h('p', { class: 'file-name' }, P.book.title),
      h('h3', { class: 'ch-title' }, ch.title),
      nowHost,
      h('div', { class: 'row wrap controls' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => guard(() => getPlayer().prev()) }, T('pl_prev')),
        playBtn,
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => guard(() => getPlayer().next()) }, T('pl_next'))),
      errSlot,
      h('div', { class: 'field' }, T('pl_speed', null, 'span', { class: 'field-label' }), rateRow)),
    panel({ titleKey: 'pl_chapters', icon: '#' }, chapterList()));
  updateNow();
}

function chapterList() {
  const { chunkSize, cfg } = getSettings();
  const list = h('div', { class: 'stack' });
  P.book.chapters.forEach((ch, i) => {
    const plan = i === P.chIdx ? P.plan : planChapter(P.book, ch, { chunkSize, cfg });
    const ready = plan.filter((c) => P.have.has(c.key)).length;
    const err = slot();
    list.append(h('article', { class: 'item' + (i === P.chIdx ? ' item-current' : '') },
      h('h3', { class: 'ch-title' }, `${i + 1}. ${ch.title}`),
      h('div', { class: 'chips' }, T('pl_ready', { n: ready, total: plan.length }, 'span', { class: 'chip' })),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: !ready, onclick: () => guard(() => loadChapter(i, 0, 0, true)) }, T('pl_play_chapter')),
        h('button', { class: 'btn btn-sm btn-quiet', type: 'button', disabled: !ready || ready < plan.length, onclick: run(err, () => downloadChapterWav(P.book, ch)) }, T('gen_download'))),
      err));
  });
  return list;
}
