// Import: PDF -> text (pdf.js) -> encoding check (Zawgyi) -> cleanup -> chapters -> review/edit -> save.
import { h, T, clear, add } from '../dom.js';
import { setT, t } from '../i18n.js';
import { extractPdf } from '../pdf.js';
import { detectEncoding, convertZawgyi } from '../zawgyi.js';
import { cleanPages } from '../cleanup.js';
import { splitChapters } from '../splitter.js';
import { saveBook } from '../store.js';
import { newBook } from '../book-model.js';
import { AppError } from '../errors.js';
import { slot, showIn, panel, meter } from '../ui.js';
import { createChapterEditor } from './chapter-editor.js';

let root, go;
// Kept at module level so switching tabs does not lose an import in progress.
const S = { phase: 'idle', file: null, raw: null, enc: null, convert: true, unsupported: 0, result: null, title: '', editor: null, state: null, busy: false, pickError: null, page: [0, 0] };

export function mount(el, ctx) { root = el; go = ctx.go; render(); }
export function show() { /* state is kept; nothing to reload */ }

const titleFn = (kind, n) => (kind === 'front' ? t('front_matter_title') : t('part_title', { n }));

/** Run everything after extraction. Called again when the Zawgyi toggle changes. */
function process() {
  let pages = S.raw.pages;
  S.unsupported = 0;
  if (S.enc.encoding === 'zawgyi' && S.convert) {
    pages = pages.map((p) => ({ lines: p.lines.map((l) => { const r = convertZawgyi(l.text); S.unsupported += r.unsupported; return { ...l, text: r.text }; }) }));
  }
  const { paragraphs, stats } = cleanPages(pages);
  const split = splitChapters(paragraphs, { titleFn });
  S.result = { paragraphs, stats, ...split };
  S.state = { chapters: split.chapters }; // the editor mutates this object (rename / merge / split / delete)
  S.editor = createChapterEditor(S.state, { getVoices: () => [{ id: 'narrator', name: '' }], onChange: () => {} });
}

async function onFile(file) {
  if (!file) return;
  S.file = file; S.phase = 'reading'; S.page = [0, 0]; S.pickError = null; S.title = file.name.replace(/\.pdf$/i, ''); render();
  try {
    S.raw = await extractPdf(file, { onProgress: (p, n) => { S.page = [p, n]; updateProgress(); } });
    const text = S.raw.pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
    const chars = text.replace(/\s/g, '').length;
    if (chars < 25 * S.raw.numPages) throw new AppError('err_scanned', { pages: S.raw.numPages, chars });
    S.enc = detectEncoding(text);
    S.convert = true;
    process();
    S.phase = 'review';
  } catch (e) { S.phase = 'idle'; S.pickError = e; }
  render();
}

function updateProgress() {
  const el = root.querySelector('#imp-progress'); if (!el) return;
  const [p, n] = S.page;
  setT(el, 'imp_page_progress', { cur: p, total: n });
  const bar = root.querySelector('.meter-fill'); if (bar) bar.style.width = (n ? (p / n) * 100 : 0) + '%';
}

function reset() { Object.assign(S, { phase: 'idle', file: null, raw: null, enc: null, result: null, editor: null, state: null, title: '', pickError: null }); render(); }

function render() {
  if (!root) return;
  clear(root);
  root.append(h('div', { class: 'view-head' }, T('imp_title', null, 'h1', { class: 'view-title' }), T('imp_sub', null, 'p', { class: 'view-sub' })));
  if (S.phase === 'idle') return idle();
  if (S.phase === 'reading') return reading();
  review();
}

function idle() {
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden', id: 'pdf-input' });
  input.addEventListener('change', () => onFile(input.files[0]));
  const err = slot();
  root.append(
    panel({ titleKey: 'imp_step1', hintKey: 'imp_hint', icon: '1' },
      h('label', { class: 'btn btn-primary', for: 'pdf-input', tabindex: '0',
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, T('imp_pick')),
      input, err),
    panel({ titleKey: 'imp_sample_label', icon: 'Aa' },
      h('blockquote', { class: 'sample', lang: 'my' }, T('sample_paragraph')),
      T('imp_steps', null, 'p', { class: 'muted' })));
  if (S.pickError) showIn(err, S.pickError);
}

function reading() {
  root.append(panel({ titleKey: 'imp_reading', icon: '1' },
    h('p', { class: 'file-name' }, S.file?.name || ''),
    T('imp_page_progress', { cur: S.page[0], total: S.page[1] }, 'p', { id: 'imp-progress', role: 'status' }),
    meter(S.page[1] ? Math.round((S.page[0] / S.page[1]) * 100) : 0)));
}

function review() {
  const r = S.result;
  const chars = r.paragraphs.reduce((n, p) => n + p.length, 0);
  const titleIn = h('input', { class: 'input', type: 'text', value: S.title, maxlength: 200 });
  titleIn.addEventListener('input', () => { S.title = titleIn.value; });

  // text check panel
  const encBody = [];
  if (S.enc.encoding === 'zawgyi') {
    const cb = h('input', { type: 'checkbox', checked: S.convert, id: 'zg-convert' });
    cb.addEventListener('change', () => { S.convert = cb.checked; process(); render(); });
    encBody.push(T('enc_zawgyi', null, 'p', { class: 'notice' }), h('label', { class: 'check', for: 'zg-convert' }, cb, T('enc_convert')));
    if (S.convert) encBody.push(T('enc_zawgyi_warn', null, 'p', { class: 'muted' }));
    if (S.convert && S.unsupported) encBody.push(T('enc_unsupported', { n: S.unsupported }, 'p', { class: 'notice' }));
  } else encBody.push(T(S.enc.encoding === 'unicode' ? 'enc_unicode' : 'enc_unknown', null, 'p', S.enc.encoding === 'unicode' ? {} : { class: 'notice' }));
  encBody.push(h('p', { class: 'preview', lang: 'my' }, (r.paragraphs.find((p) => p.length > 60) || r.paragraphs[0] || '').slice(0, 300)));

  const saveErr = slot();
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy }, T('imp_save'));
  saveBtn.addEventListener('click', async () => {
    if (S.busy) return;
    S.busy = true; saveBtn.disabled = true;
    try {
      const chapters = S.state.chapters;
      if (!chapters.length) throw new AppError('err_no_chapters');
      const book = newBook(S.title.trim() || t('untitled_book'), chapters, { pages: S.raw.numPages, encoding: S.enc.encoding, converted: S.enc.encoding === 'zawgyi' && S.convert });
      await saveBook(book);
      const id = book.id; S.busy = false; reset(); go('#/book/' + id);
    } catch (e) { S.busy = false; saveBtn.disabled = false; showIn(saveErr, e); }
  });

  root.append(
    panel({ titleKey: 'imp_step2', icon: '1' },
      h('label', { class: 'field' }, T('imp_book_title', null, 'span', { class: 'field-label' }), titleIn),
      h('div', { class: 'chips' },
        T('imp_stat_pages', { n: S.raw.numPages }, 'span', { class: 'chip' }),
        T('imp_stat_chars', { n: chars }, 'span', { class: 'chip' }),
        T('imp_stat_paras', { n: r.paragraphs.length }, 'span', { class: 'chip' }),
        r.stats.pageNumbers ? T('imp_stat_pagenums', { n: r.stats.pageNumbers }, 'span', { class: 'chip' }) : null,
        r.stats.headersFooters ? T('imp_stat_headers', { n: r.stats.headersFooters }, 'span', { class: 'chip' }) : null),
      r.skippedFront ? T('imp_front_skipped', { n: r.skippedFront }, 'p', { class: 'muted' }) : null),
    panel({ titleKey: 'imp_encoding', icon: 'Aa' }, ...encBody),
    panel({ titleKey: 'imp_review', hintKey: r.method === 'headings' ? 'imp_headings_hint' : 'imp_fallback_hint', icon: '2' },
      r.method === 'headings' ? T('imp_headings_found', { n: r.chapters.length }, 'p') : T('imp_fallback_parts', { n: r.chapters.length }, 'p', { class: 'notice' }),
      S.editor.el),
    panel({ titleKey: 'imp_step3', icon: '3' },
      h('div', { class: 'row wrap' }, saveBtn, h('button', { class: 'btn btn-quiet', type: 'button', onclick: reset }, T('imp_start_over'))),
      saveErr));
}
