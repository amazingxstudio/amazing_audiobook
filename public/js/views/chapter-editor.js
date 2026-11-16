// Chapter editor: rename, merge with next, split (before a chosen paragraph), delete, assign speaker per paragraph.
// state = { chapters: [...] } is mutated in place; onChange() is called after every edit (caller saves).
import { h, T, tAttr, clear } from '../dom.js';
import { setT, t } from '../i18n.js';
import { mergeWithNext, splitChapterAt, deleteChapter } from '../splitter.js';
import { confirmDialog, voiceLabel } from '../ui.js';

const PAGE = 40; // paragraphs rendered per step in the paragraph panel

export function createChapterEditor(state, { getVoices, onChange }) {
  const root = h('div', { class: 'stack' });
  const open = new Set(); // chapter ids whose paragraph panel is open

  function paraRow(ch, p, i) {
    const sel = h('select', { class: 'input', 'aria-label': '' });
    tAttr(sel, 'aria', 'para_speaker');
    sel.setAttribute('aria-label', t('para_speaker'));
    for (const v of getVoices()) {
      const o = h('option', { value: v.id }, v.name ? v.name : '');
      if (!v.name) setT(o, 'voice_narrator');
      sel.append(o);
    }
    sel.value = getVoices().some((v) => v.id === p.s) ? p.s : 'narrator';
    sel.addEventListener('change', () => { p.s = sel.value; onChange(); });
    const row = h('div', { class: 'para' },
      h('p', { class: 'para-text' }, h('span', { class: 'para-no' }, String(i + 1)), ' ', p.t),
      h('div', { class: 'row wrap' },
        h('label', { class: 'field grow' }, T('para_speaker', null, 'span', { class: 'field-label' }), sel),
        i > 0 ? h('button', { class: 'btn btn-quiet', type: 'button',
          onclick: () => { splitChapterAt(state.chapters, state.chapters.indexOf(ch), i, t('new_chapter_title')); onChange(); render(); } },
          T('split_here')) : null));
    return row;
  }

  function panel(ch) {
    const box = h('div', { class: 'paras' });
    let shown = 0;
    const more = h('button', { class: 'btn btn-quiet', type: 'button' }, T('show_more'));
    const step = () => {
      const end = Math.min(ch.paras.length, shown + PAGE);
      for (; shown < end; shown++) box.insertBefore(paraRow(ch, ch.paras[shown], shown), more);
      more.hidden = shown >= ch.paras.length;
    };
    more.addEventListener('click', step);
    box.append(more);
    step();
    return box;
  }

  function card(ch, idx) {
    const chars = ch.paras.reduce((n, p) => n + p.t.length, 0);
    const title = h('input', { class: 'input', type: 'text', value: ch.title, 'aria-label': t('chapter_title'), maxlength: 160 });
    tAttr(title, 'aria', 'chapter_title');
    title.addEventListener('change', () => { ch.title = title.value.trim() || ch.title; title.value = ch.title; onChange(); });
    const isOpen = open.has(ch.id);
    const toggle = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-expanded': String(isOpen),
      onclick: () => { isOpen ? open.delete(ch.id) : open.add(ch.id); render(); } },
      T(isOpen ? 'hide_paras' : 'show_paras'));
    return h('article', { class: 'item' },
      h('label', { class: 'field' }, T('chapter_title', null, 'span', { class: 'field-label' }), title),
      h('div', { class: 'chips' },
        T('ch_paras', { n: ch.paras.length }, 'span', { class: 'chip' }),
        T('ch_chars', { n: chars }, 'span', { class: 'chip' })),
      h('div', { class: 'row wrap' },
        toggle,
        h('button', { class: 'btn btn-quiet', type: 'button', disabled: idx >= state.chapters.length - 1,
          onclick: () => { mergeWithNext(state.chapters, idx); onChange(); render(); } }, T('merge_next')),
        h('button', { class: 'btn btn-danger-quiet', type: 'button',
          onclick: async () => {
            if (await confirmDialog({ msgKey: 'chapter_delete_confirm', args: { title: ch.title }, okKey: 'delete', danger: true })) {
              deleteChapter(state.chapters, idx); onChange(); render();
            }
          } }, T('delete'))),
      isOpen ? panel(ch) : null);
  }

  function render() {
    clear(root);
    if (!state.chapters.length) { root.append(T('no_chapters', null, 'p', { class: 'muted' })); return; }
    state.chapters.forEach((ch, i) => root.append(card(ch, i)));
  }
  render();
  return { el: root, render };
}
