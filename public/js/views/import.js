// Import: PDF -> text (pdf.js) -> encoding check (Zawgyi) -> cleanup -> chapters -> review/edit -> save to library.
import { h, T, tAttr, clear, add } from '../dom.js';
import { setT, t } from '../i18n.js';
import { extractPdf } from '../pdf.js';
import { detectEncoding, convertZawgyi } from '../zawgyi.js';
import { cleanPages } from '../cleanup.js';
import { splitChapters } from '../splitter.js';
import { saveBook } from '../store.js';
import { newBook } from '../book-model.js';
import { AppError } from '../errors.js';
import { showError } from '../ui.js';
import { createChapterEditor } from './chapter-editor.js';

let root, go;
// Kept at module level so switching tabs does not lose an import in progress.
const S = { phase: 'idle', file: null, raw: null, enc: null, convert: true, unsupported: 0, result: null, title: '', editor: null, busy: false };

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
  S.file = file; S.phase = 'reading'; S.page = [0, 0]; S.title = file.name.replace(/\.pdf$/i, ''); render();
  try {
    S.raw = await extractPdf(file, { onProgress: (p, n) => { S.page = [p, n]; updateProgress(); } });
    const text = S.raw.pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
    const chars = text.replace(/\s/g, '').length;
    if (chars < 25 * S.raw.numPages) throw new AppError('err_scanned', { pages: S.raw.numPages, chars });
    S.enc = detectEncoding(text);
    S.convert = true;
    process();
    S.phase = 'review';
  } catch (e) { S.phase = 'idle'; showError(e); }
  render();
}

function updateProgress() {
  const el = root.querySelector('#imp-progress'); if (!el) return;
  const [p, n] = S.page;
  setT(el, 'imp_page_progress', { cur: p, total: n });
  const bar = root.querySelector('.meter-fill'); if (bar) bar.style.width = (n ? (p / n) * 100 : 0) + '%';
}

async function save() {
  if (S.busy) return;
  S.busy = true; render();
  try {
    const chapters = S.state.chapters;
    if (!chapters.length) throw new AppError('err_no_chapters');
    const book = newBook(S.title.trim() || t('untitled_book'), chapters, { pages: S.raw.numPages, encoding: S.enc.encoding, converted: S.enc.encoding === 'zawgyi' && S.convert });
    await saveBook(book);
    const id = book.id;
    reset();
    go('#/book/' + id);
  } catch (e) { showError(e); }
  S.busy = false; render();
}

function reset() { Object.assign(S, { phase: 'idle', file: null, raw: null, enc: null, result: null, editor: null, title: '' }); render(); }

function render() {
  if (!root) return;
  clear(root);
  root.append(T('imp_title', null, 'h1', { class: 'view-title' }));
  if (S.phase === 'idle') return idle();
  if (S.phase === 'reading') return reading();
  review();
}

function idle() {
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden', id: 'pdf-input' });
  input.addEventListener('change', () => onFile(input.files[0]));
  root.append(
    h('section', { class: 'card' },
      T('imp_hint', null, 'p'),
      h('label', { class: 'btn btn-primary', for: 'pdf-input', tabindex: '0',
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, T('imp_pick')),
      input),
    h('section', { class: 'card' },
      T('imp_sample_label', null, 'h2'),
      h('blockquote', { class: 'sample', lang: 'my' }, T('sample_paragraph')),
      T('imp_steps', null, 'p', { class: 'muted' })));
}

function reading() {
  root.append(h('section', { class: 'card' },
    h('p', { class: 'file-name' }, S.file?.name || ''),
    T('imp_page_progress', { cur: S.page[0], total: S.page[1] }, 'p', { id: 'imp-progress', role: 'status' }),
    h('div', { class: 'meter' }, h('span', { class: 'meter-fill', style: `width:${S.page[1] ? (S.page[0] / S.page[1]) * 100 : 0}%` }))));
}

function review() {
  const r = S.result;
  const chars = r.paragraphs.reduce((n, p) => n + p.length, 0);
  const titleIn = h('input', { class: 'input', type: 'text', value: S.title, maxlength: 200 });
  titleIn.addEventListener('input', () => { S.title = titleIn.value; });

  const encBox = h('section', { class: 'card' }, T('imp_encoding', null, 'h2'));
  if (S.enc.encoding === 'zawgyi') {
    const cb = h('input', { type: 'checkbox', checked: S.convert, id: 'zg-convert' });
    cb.addEventListener('change', () => { S.convert = cb.checked; process(); render(); });
    add(encBox,
      T('enc_zawgyi', null, 'p', { class: 'notice' }),
      h('label', { class: 'check', for: 'zg-convert' }, cb, T('enc_convert')),
      S.convert ? T('enc_zawgyi_warn', null, 'p', { class: 'muted' }) : null,
      S.convert && S.unsupported ? T('enc_unsupported', { n: S.unsupported }, 'p', { class: 'notice' }) : null);
  } else if (S.enc.encoding === 'unicode') encBox.append(T('enc_unicode', null, 'p'));
  else encBox.append(T('enc_unknown', null, 'p', { class: 'notice' }));

  const head = r.method === 'headings'
    ? T('imp_headings_found', { n: r.chapters.length }, 'p')
    : T('imp_fallback_parts', { n: r.chapters.length }, 'p', { class: 'notice' });

  root.append(
    h('section', { class: 'card' },
      h('label', { class: 'field' }, T('imp_book_title', null, 'span', { class: 'field-label' }), titleIn),
      h('div', { class: 'chips' },
        T('imp_stat_pages', { n: S.raw.numPages }, 'span', { class: 'chip' }),
        T('imp_stat_chars', { n: chars }, 'span', { class: 'chip' }),
        T('imp_stat_paras', { n: r.paragraphs.length }, 'span', { class: 'chip' }),
        r.stats.pageNumbers ? T('imp_stat_pagenums', { n: r.stats.pageNumbers }, 'span', { class: 'chip' }) : null,
        r.stats.headersFooters ? T('imp_stat_headers', { n: r.stats.headersFooters }, 'span', { class: 'chip' }) : null),
      r.skippedFront ? T('imp_front_skipped', { n: r.skippedFront }, 'p', { class: 'muted' }) : null),
    encBox,
    h('section', { class: 'card' },
      T('imp_preview', null, 'h2'),
      h('p', { class: 'preview', lang: 'my' }, (r.paragraphs.find((p) => p.length > 60) || r.paragraphs[0] || '').slice(0, 420))),
    h('section', { class: 'stack' }, T('imp_review', null, 'h2'), head, S.editor.el),
    h('div', { class: 'row wrap sticky-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy, onclick: save }, T('imp_save')),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: reset }, T('imp_start_over'))));
}
