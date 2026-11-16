// Shared UI pieces. Errors are shown INLINE, in a slot placed right next to the thing that failed
// (never in a separate area at the top of the app).
import { h, T, clear } from './dom.js';
import { setAria } from './i18n.js';
import { toAppError } from './errors.js';

let dlg;
export function initUI() { dlg = document.getElementById('confirm-dialog'); }

/** An empty place where messages for one control/panel are shown. Put it right under the control. */
export const slot = () => h('div', { class: 'slot', 'aria-live': 'polite' });

/** Show an error inside `el`: what failed + what to do (translated), plus technical detail. */
export function showIn(el, err, { action } = {}) {
  const e = toAppError(err);
  clear(el);
  el.append(h('div', { class: 'msg msg-err', role: 'alert' },
    T(e.key, e.args, 'p', { class: 'msg-text' }),
    e.detail ? h('p', { class: 'msg-detail' }, String(e.detail).slice(0, 240)) : null,
    action || null,
    h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => clear(el) }, T('close'))));
  console.error(e);
}
/** Small success/info message inside `el` (disappears by itself). */
export function hintIn(el, key, args, ms = 4500) {
  clear(el);
  const box = h('div', { class: 'msg msg-ok', role: 'status' }, T(key, args, 'p', { class: 'msg-text' }));
  el.append(box);
  if (ms) setTimeout(() => { if (box.parentNode === el) box.remove(); }, ms);
}
export const clearIn = (el) => clear(el);

/** Wrap an async click handler: errors go to `el`, the button is disabled while it runs. */
export function run(el, fn, btn) {
  return async (ev) => {
    const b = btn || ev?.currentTarget;
    try { if (b) b.disabled = true; clear(el); await fn(ev); }
    catch (e) { showIn(el, e); }
    finally { if (b) b.disabled = false; }
  };
}

/** Promise<boolean> confirm dialog. msgKey/args are translation keys. */
export function confirmDialog({ titleKey = 'confirm_title', msgKey, args, okKey = 'confirm_ok', danger = false }) {
  return new Promise((resolve) => {
    const body = dlg.querySelector('.dlg-body');
    clear(body);
    body.append(T(titleKey, null, 'h2', { class: 'dlg-title' }), T(msgKey, args, 'p'));
    const row = h('div', { class: 'row end' });
    const done = (v) => { dlg.close(); resolve(v); };
    row.append(
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => done(false) }, T('cancel')),
      h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => done(true) }, T(okKey)));
    body.append(row);
    dlg.addEventListener('close', () => resolve(false), { once: true });
    dlg.showModal();
  });
}

/** A titled glass panel. `hintKey` is a one-line explanation under the title. */
export function panel({ titleKey, hintKey, icon, extra }, ...content) {
  return h('section', { class: 'panel' },
    h('header', { class: 'panel-head' },
      h('div', { class: 'panel-title' }, icon ? h('span', { class: 'panel-ico', 'aria-hidden': 'true' }, icon) : null, T(titleKey, null, 'h2')),
      hintKey ? T(hintKey, null, 'p', { class: 'panel-hint' }) : null,
      extra || null),
    h('div', { class: 'panel-body' }, ...content));
}

/**
 * Segmented progress bar: one segment per chunk (grouped when there are many).
 * statuses: array of 'done' | 'pending' | 'active' | 'failed'. `current` highlights a playing chunk.
 */
export function segBar(statuses, { current = -1, labelKey = 'seg_label' } = {}) {
  const n = statuses.length;
  const group = Math.max(1, Math.ceil(n / 160));
  const bar = h('div', { class: 'seg', role: 'img' });
  const done = statuses.filter((s) => s === 'done').length;
  setAria(bar, labelKey, { done, total: n });
  for (let i = 0; i < n; i += group) {
    const sl = statuses.slice(i, i + group);
    let st = 'pending';
    if (sl.includes('failed')) st = 'failed';
    else if (sl.includes('active')) st = 'active';
    else if (sl.every((s) => s === 'done')) st = 'done';
    else if (sl.includes('done')) st = 'part';
    bar.append(h('span', { class: 'seg-i s-' + st + (current >= i && current < i + group ? ' s-now' : '') }));
  }
  if (!n) bar.append(h('span', { class: 'seg-i s-pending' }));
  return bar;
}

/** Plain percentage meter. */
export function meter(pct) {
  return h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
    h('span', { class: 'meter-fill', style: `width:${pct}%` }));
}

/** Label for a voice profile: the built-in narrator shows a translated name unless the user renamed it. */
export function voiceLabel(v, tag = 'span') { return v.name ? h(tag, null, v.name) : T('voice_narrator', null, tag); }
