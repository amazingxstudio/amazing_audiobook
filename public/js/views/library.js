// Home / Library: add a book, list saved books (chapters + generation progress), open, listen, delete.
import { h, T, clear } from '../dom.js';
import { listBooks, deleteBook, saveBook, audioKeys } from '../store.js';
import { planChapter } from '../chunker.js';
import { getSettings, ls } from '../settings.js';
import { slot, showIn, confirmDialog, panel, meter, run } from '../ui.js';
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
  const addErr = slot();
  root.append(
    h('div', { class: 'view-head' }, T('lib_title', null, 'h1', { class: 'view-title' }), T('lib_sub', null, 'p', { class: 'view-sub' })),
    panel({ titleKey: 'lib_add_title', hintKey: 'lib_add_hint', icon: '+' },
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn btn-primary', href: '#/import' }, T('lib_add')),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: run(addErr, addSample) }, T('lib_add_sample'))),
      addErr));
  const listErr = slot();
  const holder = h('div', { class: 'stack' });
  root.append(holder);
  let books = [];
  try { books = await listBooks(); } catch (e) { holder.append(panel({ titleKey: 'lib_books' }, listErr)); showIn(listErr, e); return; }
  if (!books.length) {
    holder.append(panel({ titleKey: 'lib_empty_title', hintKey: 'lib_empty_body', icon: '?' },
      h('blockquote', { class: 'sample', lang: 'my' }, T('sample_paragraph'))));
    return;
  }
  const items = h('div', { class: 'stack' });
  holder.append(panel({ titleKey: 'lib_books', icon: '#' }, items));
  for (const b of books) items.append(await card(b));
}

async function addSample() {
  await saveBook(newBook(t('sample_title'), sampleChapters(newId)));
  await show();
}

async function card(book) {
  const prog = await bookProgress(book).catch(() => ({ total: 0, done: 0, pct: 0 }));
  let pos = null; try { pos = JSON.parse(ls.get('ab.pos.' + book.id, 'null')); } catch { /* ignore */ }
  const chIdx = pos ? book.chapters.findIndex((c) => c.id === pos.chapterId) : -1;
  const err = slot();
  return h('article', { class: 'item' },
    h('h3', { class: 'book-title' }, book.title),
    h('div', { class: 'chips' },
      T('book_chapters', { n: book.chapters.length }, 'span', { class: 'chip' }),
      T('book_generated', { p: prog.pct }, 'span', { class: 'chip' }),
      chIdx >= 0 ? T('book_listening', { n: chIdx + 1 }, 'span', { class: 'chip' }) : null),
    meter(prog.pct),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn btn-primary', href: '#/book/' + book.id }, T('book_open')),
      h('a', { class: 'btn btn-quiet', href: '#/player/' + book.id }, T('book_listen')),
      h('button', { class: 'btn btn-danger-quiet', type: 'button',
        onclick: run(err, async () => {
          if (!(await confirmDialog({ msgKey: 'book_delete_confirm', args: { title: book.title }, okKey: 'delete', danger: true }))) return;
          await deleteBook(book.id); ls.del('ab.pos.' + book.id); await show();
        }) }, T('delete'))),
    err);
}
