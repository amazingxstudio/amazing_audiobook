// Library: saved books with chapter count and generation progress; add (via Import) and delete.
import { h, T, clear } from '../dom.js';
import { listBooks, deleteBook, saveBook, audioKeys } from '../store.js';
import { planChapter } from '../chunker.js';
import { getSettings, ls } from '../settings.js';
import { showError, confirmDialog } from '../ui.js';
import { newId } from '../splitter.js';
import { sampleChapters } from '../sample.js';
import { newBook } from '../book-model.js';
import { t } from '../i18n.js';

let root;
export function mount(el) { root = el; }

/** Generation progress of a whole book: share of chunks that already have audio. */
export async function bookProgress(book) {
  const { chunkSize, cfg } = getSettings();
  const have = await audioKeys(book.id);
  let total = 0, done = 0;
  for (const ch of book.chapters) for (const c of planChapter(book, ch, { chunkSize, cfg })) { total++; if (have.has(c.key)) done++; }
  return { total, done, pct: total ? Math.floor((done / total) * 100) : 0 };
}

export async function show() {
  clear(root);
  root.append(
    h('div', { class: 'row wrap between' },
      T('lib_title', null, 'h1', { class: 'view-title' }),
      h('a', { class: 'btn btn-primary', href: '#/import' }, T('lib_add'))));
  let books;
  try { books = await listBooks(); } catch (e) { showError(e); return; }
  if (!books.length) { root.append(emptyState()); return; }
  const list = h('div', { class: 'stack' });
  root.append(list);
  for (const b of books) list.append(await card(b, list));
}

function emptyState() {
  return h('section', { class: 'card empty' },
    T('lib_empty_title', null, 'h2'),
    T('lib_empty_body', null, 'p'),
    h('blockquote', { class: 'sample', lang: 'my' }, T('sample_paragraph')),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn btn-primary', href: '#/import' }, T('lib_add')),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: addSample }, T('lib_add_sample'))));
}

async function addSample() {
  try {
    const b = newBook(t('sample_title'), sampleChapters(newId));
    await saveBook(b);
    await show();
  } catch (e) { showError(e); }
}

async function card(book, list) {
  const prog = await bookProgress(book).catch(() => ({ total: 0, done: 0, pct: 0 }));
  const pos = (() => { try { return JSON.parse(ls.get('ab.pos.' + book.id, 'null')); } catch { return null; } })();
  const chIdx = pos ? book.chapters.findIndex((c) => c.id === pos.chapterId) : -1;
  const bar = h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(prog.pct) },
    h('span', { class: 'meter-fill', style: `width:${prog.pct}%` }));
  return h('article', { class: 'card' },
    h('h2', { class: 'book-title' }, book.title),
    h('div', { class: 'chips' },
      T('book_chapters', { n: book.chapters.length }, 'span', { class: 'chip' }),
      T('book_generated', { p: prog.pct }, 'span', { class: 'chip' }),
      chIdx >= 0 ? T('book_listening', { n: chIdx + 1 }, 'span', { class: 'chip' }) : null),
    bar,
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn btn-primary', href: '#/book/' + book.id }, T('book_open')),
      h('a', { class: 'btn btn-quiet', href: '#/player/' + book.id }, T('book_listen')),
      h('button', { class: 'btn btn-danger-quiet', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog({ msgKey: 'book_delete_confirm', args: { title: book.title }, okKey: 'delete', danger: true }))) return;
          try { await deleteBook(book.id); ls.del('ab.pos.' + book.id); await show(); } catch (e) { showError(e); }
        } }, T('delete'))));
}
