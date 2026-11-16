// Audio EDIT tool: join many short audio files into one long file. Nothing is generated here.
import { h, T, clear, add } from '../dom.js';
import { t } from '../i18n.js';
import { listBooks, getBook } from '../store.js';
import { chapterWavBlob } from '../chapter-audio.js';
import { mergeAudioFiles } from '../merger.js';
import { saveBlob } from '../audio.js';
import { blobDuration } from '../refaudio.js';
import { slot, showIn, hintIn, panel, meter, run } from '../ui.js';
import { AppError } from '../errors.js';

let root;
// kept at module level so the list survives switching tabs
const S = { items: [], gap: 300, name: '', result: null, resultUrl: null, busy: false, progress: [0, 0], nextId: 1, error: null };

export function mount(el) { root = el; render(); }
export function show() { render(); }

const fmtDur = (s) => { if (!Number.isFinite(s)) return '?'; const m = Math.floor(s / 60), x = Math.round(s % 60); return m ? `${m}:${String(x).padStart(2, '0')}` : `${x} s`; };
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

async function addBlobs(list) {
  for (const { blob, name } of list) {
    const item = { id: S.nextId++, blob, name, dur: null };
    S.items.push(item);
    blobDuration(blob).then((d) => { item.dur = d; render(); });
  }
  S.result = null; S.error = null; render();
}

function render() {
  if (!root) return;
  clear(root);
  const addErr = slot(), mergeErr = slot();

  // ---- 1. choose ----
  const input = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac', multiple: true, class: 'visually-hidden', id: 'merge-input' });
  input.addEventListener('change', async () => { const fs = [...input.files]; input.value = ''; await addBlobs(fs.map((f) => ({ blob: f, name: f.name }))); });
  const bookHost = h('div', { class: 'stack' });
  const bookBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, T('merge_add_chapters'));
  bookBtn.addEventListener('click', run(addErr, async () => {
    const books = await listBooks();
    clear(bookHost);
    if (!books.length) throw new AppError('err_merge_no_books');
    const sel = h('select', { class: 'input' }); books.forEach((b) => sel.append(h('option', { value: b.id }, b.title)));
    const list = h('div', { class: 'stack-tight' });
    const draw = async () => {
      clear(list); const b = await getBook(sel.value);
      b.chapters.forEach((ch, i) => list.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', value: String(i) }), h('span', null, `${i + 1}. ${ch.title}`))));
    };
    sel.addEventListener('change', draw); await draw();
    const go = h('button', { class: 'btn btn-primary', type: 'button' }, T('merge_add_selected'));
    const err2 = slot();
    go.addEventListener('click', run(err2, async () => {
      const b = await getBook(sel.value);
      const idxs = [...list.querySelectorAll('input:checked')].map((x) => Number(x.value));
      if (!idxs.length) throw new AppError('err_merge_pick_chapter');
      const out = [];
      for (const i of idxs) out.push({ blob: await chapterWavBlob(b, b.chapters[i]), name: `${b.title} - ${b.chapters[i].title}` });
      await addBlobs(out); clear(bookHost);
    }, go));
    add(bookHost, h('label', { class: 'field' }, T('pl_book', null, 'span', { class: 'field-label' }), sel), list, go, err2);
  }, bookBtn));

  root.append(
    h('div', { class: 'view-head' }, T('merge_title', null, 'h1', { class: 'view-title' }), T('merge_sub', null, 'p', { class: 'view-sub' })),
    panel({ titleKey: 'merge_step1', hintKey: 'merge_step1_hint', icon: '1' },
      h('div', { class: 'row wrap' }, h('label', { class: 'btn btn-primary', for: 'merge-input', tabindex: '0',
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, T('merge_add_files')), input, bookBtn),
      addErr, bookHost));

  // ---- 2. order ----
  const list = h('ul', { class: 'mlist' });
  S.items.forEach((it, i) => {
    const move = (d) => { const j = i + d; if (j < 0 || j >= S.items.length) return; [S.items[i], S.items[j]] = [S.items[j], S.items[i]]; S.result = null; render(); };
    list.append(h('li', { class: 'mitem' },
      h('div', { class: 'mname' }, `${i + 1}. ${it.name}`),
      h('div', { class: 'chips' }, h('span', { class: 'chip' }, fmtDur(it.dur)), h('span', { class: 'chip' }, fmtSize(it.blob.size))),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-sm btn-quiet', type: 'button', disabled: i === 0, onclick: () => move(-1) }, T('merge_up')),
        h('button', { class: 'btn btn-sm btn-quiet', type: 'button', disabled: i === S.items.length - 1, onclick: () => move(1) }, T('merge_down')),
        h('button', { class: 'btn btn-sm btn-danger-quiet', type: 'button', onclick: () => { S.items.splice(i, 1); S.result = null; render(); } }, T('merge_remove')))));
  });
  const total = S.items.reduce((n, i) => n + (i.dur || 0), 0);
  root.append(panel({ titleKey: 'merge_step2', hintKey: 'merge_step2_hint', icon: '2' },
    S.items.length ? list : T('merge_empty', null, 'p', { class: 'muted' }),
    S.items.length ? h('div', { class: 'chips' }, T('merge_count', { n: S.items.length }, 'span', { class: 'chip' }), T('merge_total', { d: fmtDur(total) }, 'span', { class: 'chip' })) : null,
    S.items.length ? h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: () => { S.items = []; S.result = null; render(); } }, T('merge_clear')) : null));

  // ---- 3. options ----
  const gapSel = h('select', { class: 'input' });
  for (const g of [0, 300, 800, 1500]) { const o = h('option', { value: String(g) }, g ? `${g} ms` : ''); if (!g) o.dataset.i18n = 'merge_gap_none'; gapSel.append(o); }
  gapSel.value = String(S.gap);
  gapSel.addEventListener('change', () => { S.gap = Number(gapSel.value); S.result = null; });
  const nameIn = h('input', { class: 'input', type: 'text', value: S.name, maxlength: 80 });
  nameIn.placeholder = 'merged-audio';
  nameIn.addEventListener('input', () => { S.name = nameIn.value; });
  root.append(panel({ titleKey: 'merge_step3', icon: '3' },
    h('label', { class: 'field' }, T('merge_gap', null, 'span', { class: 'field-label' }), gapSel),
    h('label', { class: 'field' }, T('merge_name', null, 'span', { class: 'field-label' }), nameIn)));
  // translate the "no gap" option
  const o0 = gapSel.querySelector('option[data-i18n]'); if (o0) o0.textContent = t('merge_gap_none');

  // ---- 4. create ----
  const prog = h('div', { class: 'stack-tight' });
  const mergeBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy || S.items.length < 2 }, T(S.busy ? 'merge_working' : 'merge_go'));
  mergeBtn.addEventListener('click', async () => {
    if (S.busy) return;
    S.busy = true; S.result = null; S.error = null; mergeBtn.disabled = true; clear(mergeErr);
    try {
      const r = await mergeAudioFiles(S.items.map((i) => ({ blob: i.blob, name: i.name })), {
        gapMs: S.gap,
        onProgress: (d, n) => { clear(prog); add(prog, T('merge_progress', { d, n }, 'p', { role: 'status' }), meter(Math.round((d / n) * 100))); },
      });
      S.result = r;
    } catch (e) { S.busy = false; S.error = e; render(); return; }
    S.busy = false; render();
  });
  if (S.error) showIn(mergeErr, S.error); // kept in state so a re-render (e.g. a duration finishing loading) does not hide it
  const resultBox = S.result ? (() => {
    if (S.resultUrl) URL.revokeObjectURL(S.resultUrl);
    S.resultUrl = URL.createObjectURL(S.result.blob);
    const dlErr = slot();
    return h('div', { class: 'stack' },
      h('div', { class: 'msg msg-ok' }, T('merge_done', null, 'p', { class: 'msg-text' })),
      h('div', { class: 'chips' }, h('span', { class: 'chip' }, fmtDur(S.result.seconds)), h('span', { class: 'chip' }, fmtSize(S.result.blob.size)), h('span', { class: 'chip' }, 'WAV')),
      h('audio', { controls: true, src: S.resultUrl }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: run(dlErr, async () => { saveBlob(S.result.blob, (S.name.trim() || 'merged-audio').replace(/[\\/:*?"<>|\r\n]+/g, ' ') + '.wav'); }) }, T('merge_download')), dlErr);
  })() : null;
  root.append(panel({ titleKey: 'merge_step4', hintKey: 'merge_step4_hint', icon: '4' }, mergeBtn, prog, mergeErr, resultBox));
}
