// Book screen with three tabs: Chapters (editor), Voices (profiles + speaker assignment), Generate (per chapter).
import { h, T, tAttr, clear, add } from '../dom.js';
import { setT, t } from '../i18n.js';
import { getBook, saveBook, putAudio, deleteAudio, getAudioBlob } from '../store.js';
import { newVoice, NARRATOR_ID } from '../book-model.js';
import { createChapterEditor } from './chapter-editor.js';
import { ChapterJob, getJob, isBusy } from '../generator.js';
import { downloadChapterWav } from '../chapter-audio.js';
import { showError, confirmDialog, segBar, voiceLabel } from '../ui.js';
import { ANALYZER_AVAILABLE } from '../analyzer.js';
import { AppError } from '../errors.js';
import { ls } from '../settings.js';

let root, ctx, book = null, tab = 'chapters', body, tabsEl, genRows = [];
export function mount(el, c) { root = el; ctx = c; }

let saveTimer = null;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveBook(book).catch(showError), 400); };
const flush = () => { clearTimeout(saveTimer); return book ? saveBook(book).catch(showError) : Promise.resolve(); };

export async function show(id) {
  await flush();
  try { book = await getBook(id); } catch (e) { showError(e); return; }
  clear(root);
  if (!book) { root.append(T('book_missing', null, 'p', { class: 'notice' }), h('a', { class: 'btn btn-primary', href: '#/library' }, T('back_library'))); return; }
  ls.set('ab.lastBook', book.id);
  const titleIn = h('input', { class: 'input title-input', type: 'text', value: book.title, maxlength: 200 });
  tAttr(titleIn, 'aria', 'imp_book_title'); titleIn.setAttribute('aria-label', t('imp_book_title'));
  titleIn.addEventListener('change', () => { book.title = titleIn.value.trim() || book.title; titleIn.value = book.title; saveSoon(); });
  tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  body = h('div', { class: 'stack' });
  root.append(
    h('a', { class: 'btn btn-quiet back', href: '#/library' }, T('back_library')),
    titleIn, tabsEl, body);
  drawTabs(); drawTab();
}
export function hide() { flush(); }

function drawTabs() {
  clear(tabsEl);
  for (const [id, key] of [['chapters', 'tab_chapters'], ['voices', 'tab_voices'], ['generate', 'tab_generate']]) {
    tabsEl.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === id),
      onclick: () => { tab = id; drawTabs(); drawTab(); } }, T(key)));
  }
}
function drawTab() {
  clear(body); genRows = [];
  if (tab === 'chapters') body.append(createChapterEditor({ chapters: book.chapters }, { getVoices: () => book.voices, onChange: saveSoon }).el);
  else if (tab === 'voices') voicesTab();
  else generateTab();
}

// ---------------- Voices ----------------
function voicesTab() {
  body.append(T('voices_intro', null, 'p', { class: 'muted' }));
  const list = h('div', { class: 'stack' });
  body.append(list);
  const draw = () => {
    clear(list);
    for (const v of book.voices) list.append(voiceCard(v, draw));
  };
  draw();
  body.append(
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { book.voices.push(newVoice({ name: t('voice_new_name', { n: book.voices.length }) })); saveSoon(); draw(); } }, T('voice_add')),
    // Hook for the later automatic dialogue/emotion analysis step (not implemented)
    h('section', { class: 'card' },
      T('voices_auto_title', null, 'h2'),
      T('voices_auto_body', null, 'p', { class: 'muted' }),
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: !ANALYZER_AVAILABLE }, T('voices_auto_btn'))));
}

function voiceCard(v, redraw) {
  const nameIn = h('input', { class: 'input', type: 'text', value: v.name, maxlength: 60 });
  if (v.builtin && !v.name) { tAttr(nameIn, 'placeholder', 'voice_narrator'); nameIn.placeholder = t('voice_narrator'); }
  nameIn.addEventListener('change', () => { v.name = nameIn.value.trim(); saveSoon(); });
  const control = h('textarea', { class: 'input', rows: '3', maxlength: 400 }, v.control);
  tAttr(control, 'placeholder', 'voice_control_ph'); control.placeholder = t('voice_control_ph');
  control.addEventListener('change', () => { v.control = control.value.trim(); saveSoon(); });
  const note = h('input', { class: 'input', type: 'text', value: v.speedNote, maxlength: 120 });
  note.addEventListener('change', () => { v.speedNote = note.value.trim(); saveSoon(); });

  const refKey = `ref:${book.id}:${v.id}`;
  const refInfo = h('p', { class: 'muted' });
  const showRef = () => { v.refName ? (refInfo.replaceChildren(h('span', null, v.refName)), refInfo.removeAttribute('data-i18n')) : setT(refInfo, 'voice_ref_none'); };
  showRef();
  const file = h('input', { type: 'file', accept: 'audio/*', class: 'visually-hidden', id: 'ref-' + v.id });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) return showError(new AppError('err_ref_big'));
    try { await putAudio({ key: refKey, bookId: book.id, kind: 'ref', blob: f }); v.refName = f.name; saveSoon(); showRef(); } catch (e) { showError(e); }
  });

  return h('article', { class: 'card' },
    h('label', { class: 'field' }, T('voice_name', null, 'span', { class: 'field-label' }), nameIn),
    h('label', { class: 'field' }, T('voice_control', null, 'span', { class: 'field-label' }), control),
    h('label', { class: 'field' }, T('voice_speed_note', null, 'span', { class: 'field-label' }), note),
    h('div', { class: 'field' }, T('voice_ref', null, 'span', { class: 'field-label' }), refInfo,
      h('div', { class: 'row wrap' },
        h('label', { class: 'btn btn-quiet', for: 'ref-' + v.id, tabindex: '0',
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, T('voice_ref_pick')),
        file,
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => { if (v.refName) { await deleteAudio(refKey).catch(showError); v.refName = ''; saveSoon(); showRef(); } } }, T('voice_ref_clear'))),
      T('voice_ref_later', null, 'p', { class: 'muted' })),
    v.builtin ? null : h('button', { class: 'btn btn-danger-quiet', type: 'button',
      onclick: async () => {
        if (!(await confirmDialog({ msgKey: 'voice_delete_confirm', okKey: 'delete', danger: true }))) return;
        book.chapters.forEach((c) => c.paras.forEach((p) => { if (p.s === v.id) p.s = NARRATOR_ID; })); // assignments fall back to the narrator
        book.voices = book.voices.filter((x) => x.id !== v.id);
        await deleteAudio(refKey).catch(() => {});
        saveSoon(); redraw();
      } }, T('delete')));
}

// ---------------- Generate ----------------
function generateTab() {
  body.append(T('gen_intro', null, 'p', { class: 'muted' }));
  const list = h('div', { class: 'stack' });
  body.append(list);
  book.chapters.forEach((ch) => { const row = genRow(ch); genRows.push(row); list.append(row.el); });
}

function genRow(ch) {
  const ex = getJob(book.id, ch.id); // keep a running/paused job so the UI can reattach after leaving the screen
  const job = ex && (ex.state === 'running' || ex.state === 'paused') ? ex : new ChapterJob(book, ch);
  const head = h('h3', { class: 'ch-title' }, ch.title);
  const counts = h('div', { class: 'chips' });
  const barHost = h('div');
  const msg = h('div', { class: 'stack-tight' });
  const actions = h('div', { class: 'row wrap' });
  const el = h('article', { class: 'card' }, head, counts, barHost, msg, actions);
  let merging = false, sig = '';

  const btn = (key, cls, fn, disabled = false) => h('button', { class: 'btn ' + cls, type: 'button', disabled, onclick: fn }, T(key));
  const guard = (fn) => async () => { try { await fn(); } catch (e) { showError(e); } };

  function update() {
    // counts + bar every time
    clear(counts);
    add(counts,
      T('gen_counts', { done: job.done, total: job.plan.length }, 'span', { class: 'chip' }),
      T('gen_state_' + job.state, null, 'span', { class: 'chip chip-state s-' + job.state }),
      job.plan.some((c) => c.forced) ? T('gen_forced', { n: job.plan.filter((c) => c.forced).length }, 'span', { class: 'chip' }) : null);
    clear(barHost); barHost.append(segBar(job.statuses));
    clear(msg);
    if (job.retryNote) msg.append(T('gen_retrying', { n: job.retryNote.n, secs: job.retryNote.secs }, 'p', { class: 'muted' }));
    if (job.autoPaused) msg.append(T('gen_auto_paused', null, 'p', { class: 'notice' }));
    if (job.lastError && (job.failed || job.state === 'incomplete')) {
      add(msg, T(job.lastError.key, job.lastError.args, 'p', { class: 'notice' }), job.lastError.detail ? h('p', { class: 'alert-detail' }, String(job.lastError.detail).slice(0, 200)) : null);
    }
    const s = `${job.state}|${job.failed > 0}|${job.done > 0}|${job.done === job.plan.length}|${merging}`;
    if (s === sig) return; sig = s;
    clear(actions);
    const running = job.state === 'running', paused = job.state === 'paused';
    if (!running && !paused) {
      actions.append(btn(job.done ? 'gen_continue' : 'gen_start', 'btn-primary', guard(() => job.start())));
      if (job.failed) actions.append(btn('gen_retry_failed', 'btn-quiet', guard(() => job.start({ onlyFailed: true }))));
    }
    if (running) actions.append(btn('gen_pause', 'btn-quiet', () => job.pause()));
    if (paused) actions.append(btn('gen_resume', 'btn-primary', () => job.resume()));
    if (running || paused) {
      actions.append(btn('gen_cancel', 'btn-danger-quiet', () => job.cancel()));
    }
    if (job.done > 0) actions.append(h('a', { class: 'btn btn-quiet', href: '#/player/' + book.id + '/' + ch.id }, T('gen_play')));
    if (job.done > 0) actions.append(h('button', { class: 'btn btn-quiet', type: 'button', disabled: merging,
      onclick: guard(async () => { merging = true; sig = ''; update(); try { await downloadChapterWav(book, ch); } finally { merging = false; sig = ''; update(); } }) }, T(merging ? 'gen_merging' : 'gen_download')));
  }
  const off = job.on(() => { if (el.isConnected) update(); else off(); });
  job.refresh().then(update).catch(showError);
  update();
  return { el, job };
}
