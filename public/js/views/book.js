// Book screen (kept simple): 1) generate audio  2) voice  3) chapters  4) "more" (edit chapters, characters).
import { h, T, tAttr, clear, add } from '../dom.js';
import { t } from '../i18n.js';
import { getBook, saveBook } from '../store.js';
import { newVoice, NARRATOR_ID } from '../book-model.js';
import { createChapterEditor } from './chapter-editor.js';
import { voiceBox } from './voice-box.js';
import { ChapterJob, BookRun, getRun, isBusy } from '../generator.js';
import { downloadChapterWav } from '../chapter-audio.js';
import { slot, showIn, hintIn, confirmDialog, segBar, meter, panel, run } from '../ui.js';
import { ANALYZER_AVAILABLE } from '../analyzer.js';
import { ls } from '../settings.js';
import { deleteAudio } from '../store.js';
import { forgetRef, pruneBookAudio } from '../generator.js';

let root, ctx, book = null, rows = [], unsubs = [], topUpdate = () => {};
export function mount(el, c) { root = el; ctx = c; }

let saveTimer = null;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveBook(book).catch(() => {}), 400); };
const saveNow = () => { clearTimeout(saveTimer); return book ? saveBook(book) : Promise.resolve(); };
export function hide() { saveNow().catch(() => {}); }

export async function show(id) {
  await saveNow().catch(() => {});
  unsubs.forEach((f) => f()); unsubs = []; rows = [];
  clear(root);
  const loadErr = slot();
  try { book = await getBook(id); } catch (e) { root.append(panel({ titleKey: 'lib_books' }, loadErr)); showIn(loadErr, e); return; }
  if (!book) { root.append(panel({ titleKey: 'book_missing_title' }, T('book_missing', null, 'p'), h('a', { class: 'btn btn-primary', href: '#/library' }, T('back_library')))); return; }
  ls.set('ab.lastBook', book.id);

  const titleIn = h('input', { class: 'input title-input', type: 'text', value: book.title, maxlength: 200 });
  tAttr(titleIn, 'aria', 'imp_book_title'); titleIn.setAttribute('aria-label', t('imp_book_title'));
  titleIn.addEventListener('change', () => { book.title = titleIn.value.trim() || book.title; titleIn.value = book.title; saveSoon(); });

  const narrator = book.voices.find((v) => v.id === NARRATOR_ID) || book.voices[0];
  const chaptersHost = h('div', { class: 'stack' });
  const drawChapters = () => {
    unsubs.forEach((f) => f()); unsubs = []; rows = [];
    clear(chaptersHost);
    book.chapters.forEach((ch, i) => { const r = chapterRow(ch, i); rows.push(r); chaptersHost.append(r.el); });
    topUpdate();
  };

  root.append(
    h('a', { class: 'btn btn-quiet back', href: '#/library' }, T('back_library')),
    h('div', { class: 'view-head' }, titleIn),
    topPanel(),
    panel({ titleKey: 'voice_title', hintKey: 'voice_hint', icon: '♪' }, voiceBox(book, narrator, { onChanged: drawChapters, save: saveNow })),
    panel({ titleKey: 'chapters_title', hintKey: 'chapters_hint', icon: '#' }, chaptersHost),
    morePanel(drawChapters));
  drawChapters();
}

// ---------- 1. generate whole book ----------
function topPanel() {
  const err = slot(), chips = h('div', { class: 'chips' }), bar = h('div'), actions = h('div', { class: 'row wrap' });
  topUpdate = () => {
    const done = rows.reduce((n, r) => n + r.job.done, 0), total = rows.reduce((n, r) => n + r.job.plan.length, 0);
    const pct = total ? Math.floor((done / total) * 100) : 0;
    const bookRun = getRun(book.id);
    const cur = bookRun?.current;
    const running = bookRun && ['running', 'paused'].includes(bookRun.state);
    clear(chips); add(chips, T('book_chapters', { n: book.chapters.length }, 'span', { class: 'chip' }), T('book_generated', { p: pct }, 'span', { class: 'chip' }),
      T('gen_counts', { done, total }, 'span', { class: 'chip' }));
    clear(bar); bar.append(meter(pct));
    clear(actions);
    if (running) {
      if (cur?.state === 'paused') actions.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => bookRun.resume() }, T('gen_resume')));
      else actions.append(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => bookRun.pause() }, T('gen_pause')));
      actions.append(h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: () => bookRun.cancel() }, T('gen_cancel')));
    } else {
      actions.append(h('button', { class: 'btn btn-primary', type: 'button', disabled: total > 0 && done === total || isBusy(),
        onclick: run(err, async () => { const r = new BookRun(book); r.on(topUpdateAndError); r.start().catch((e) => showIn(err, e)); topUpdate(); }) },
        T(done ? 'gen_book_continue' : 'gen_book')));
    }
    if (done) actions.append(h('a', { class: 'btn btn-quiet', href: '#/player/' + book.id }, T('book_listen')));
    if (bookRun?.state === 'stopped' && bookRun.error) showIn(err, bookRun.error);
  };
  const topUpdateAndError = () => topUpdate();
  return panel({ titleKey: 'gen_title', hintKey: 'gen_hint', icon: '▶' }, chips, bar, actions, err);
}

// ---------- 3. chapter rows ----------
function chapterRow(ch, i) {
  const job = ChapterJob.for(book, ch);
  const err = slot();
  const counts = h('div', { class: 'chips' }), barHost = h('div'), msg = h('div', { class: 'stack-tight' }), actions = h('div', { class: 'row wrap' });
  const el = h('article', { class: 'item' }, h('h3', { class: 'ch-title' }, `${i + 1}. ${ch.title}`), counts, barHost, msg, actions, err);
  let merging = false, sig = '';
  const btn = (key, cls, fn, disabled = false) => h('button', { class: 'btn btn-sm ' + cls, type: 'button', disabled, onclick: run(err, fn) }, T(key));

  function update() {
    clear(counts);
    add(counts, T('gen_counts', { done: job.done, total: job.plan.length }, 'span', { class: 'chip' }),
      T('gen_state_' + job.state, null, 'span', { class: 'chip chip-state s-' + job.state }));
    clear(barHost); barHost.append(segBar(job.statuses));
    clear(msg);
    if (job.retryNote) msg.append(T('gen_retrying', { n: job.retryNote.n, secs: job.retryNote.secs }, 'p', { class: 'hint' }));
    if (job.autoPaused) msg.append(T('gen_auto_paused', null, 'p', { class: 'notice' }));
    if (job.warn) msg.append(T(job.warn.key, job.warn.args, 'p', { class: 'notice' }));
    if (job.lastError && (job.failed || job.state === 'incomplete')) add(msg, T(job.lastError.key, job.lastError.args, 'p', { class: 'notice' }), job.lastError.detail ? h('p', { class: 'msg-detail' }, String(job.lastError.detail).slice(0, 200)) : null);
    const busyElsewhere = isBusy() && job.state !== 'running' && job.state !== 'paused';
    const s = `${job.state}|${job.failed > 0}|${job.done > 0}|${job.done === job.plan.length}|${merging}|${busyElsewhere}`;
    if (s === sig) return; sig = s;
    clear(actions);
    const running = job.state === 'running', paused = job.state === 'paused';
    if (!running && !paused) {
      actions.append(btn(job.done ? 'gen_continue' : 'gen_start', 'btn-primary', () => job.start(), busyElsewhere || (job.plan.length > 0 && job.done === job.plan.length)));
      if (job.failed) actions.append(btn('gen_retry_failed', 'btn-quiet', () => job.start({ onlyFailed: true }), busyElsewhere));
    }
    if (running) actions.append(btn('gen_pause', 'btn-quiet', () => job.pause()));
    if (paused) actions.append(btn('gen_resume', 'btn-primary', () => job.resume()));
    if (running || paused) actions.append(btn('gen_cancel', 'btn-danger-quiet', () => job.cancel()));
    if (job.done > 0) actions.append(h('a', { class: 'btn btn-sm btn-quiet', href: '#/player/' + book.id + '/' + ch.id }, T('gen_play')));
    if (job.done > 0) actions.append(h('button', { class: 'btn btn-sm btn-quiet', type: 'button', disabled: merging || job.done < job.plan.length,
      onclick: run(err, async () => { merging = true; sig = ''; update(); try { await downloadChapterWav(book, ch); } finally { merging = false; sig = ''; update(); } }) }, T(merging ? 'gen_merging' : 'gen_download')));
  }
  const off = job.on(() => { if (el.isConnected) { update(); topUpdate(); } else off(); });
  unsubs.push(off);
  job.refresh().then(() => { update(); topUpdate(); }).catch((e) => showIn(err, e));
  update();
  return { el, job };
}

// ---------- 4. more: edit chapters, characters ----------
function morePanel(drawChapters) {
  const edErr = slot();
  const editorHost = h('div', { class: 'stack' });
  const charsHost = h('div', { class: 'stack' });
  const drawEditor = () => { clear(editorHost); editorHost.append(createChapterEditor({ chapters: book.chapters }, { getVoices: () => book.voices, onChange: () => { saveSoon(); } }).el); };
  const drawChars = () => {
    clear(charsHost);
    for (const v of book.voices.filter((x) => x.id !== NARRATOR_ID)) {
      const name = h('input', { class: 'input', type: 'text', value: v.name, maxlength: 60 });
      name.addEventListener('change', () => { v.name = name.value.trim(); saveSoon(); });
      const delErr = slot();
      charsHost.append(h('article', { class: 'item' },
        h('label', { class: 'field' }, T('voice_name', null, 'span', { class: 'field-label' }), name),
        voiceBox(book, v, { onChanged: drawChapters, save: saveNow }),
        h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: run(delErr, async () => {
          if (!(await confirmDialog({ msgKey: 'voice_delete_confirm', okKey: 'delete', danger: true }))) return;
          book.chapters.forEach((c) => c.paras.forEach((p) => { if (p.s === v.id) p.s = NARRATOR_ID; }));
          book.voices = book.voices.filter((x) => x.id !== v.id);
          await deleteAudio(`ref:${book.id}:${v.id}`).catch(() => {}); forgetRef(book.id, v.id);
          await saveNow(); await pruneBookAudio(book); drawChars(); drawEditor(); drawChapters();
        }) }, T('delete')), delErr));
    }
  };
  const det = h('details', { class: 'more' },
    h('summary', null, T('more_title')),
    h('div', { class: 'more-body' },
      T('more_hint', null, 'p', { class: 'muted' }),
      T('more_chapters', null, 'h3'), editorHost,
      T('more_chars', null, 'h3'), T('more_chars_hint', null, 'p', { class: 'muted' }), charsHost,
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { book.voices.push(newVoice({ name: t('voice_new_name', { n: book.voices.length }) })); saveSoon(); drawChars(); drawEditor(); } }, T('voice_add')),
      h('div', { class: 'item' }, T('voices_auto_title', null, 'h3'), T('voices_auto_body', null, 'p', { class: 'muted' }),
        h('button', { class: 'btn btn-quiet', type: 'button', disabled: !ANALYZER_AVAILABLE }, T('voices_auto_btn'))),
      edErr));
  det.addEventListener('toggle', () => { if (det.open) { drawEditor(); drawChars(); } });
  return h('section', { class: 'stack' }, det);
}
