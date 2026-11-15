// Shared UI pieces: alerts (errors), confirm dialog, segmented progress bar, voice labels.
import { h, T, clear } from './dom.js';
import { setAria } from './i18n.js';
import { toAppError } from './errors.js';

let alertsEl, dlg;
export function initUI() {
  alertsEl = document.getElementById('alerts');
  dlg = document.getElementById('confirm-dialog');
}

/** Show an error: what failed (translated message) + technical detail. Replaces an identical earlier alert. */
export function showError(err) {
  const e = toAppError(err);
  const id = e.key + JSON.stringify(e.args || {});
  alertsEl.querySelector(`[data-alert-id="${CSS.escape(id)}"]`)?.remove();
  const box = h('div', { class: 'alert', role: 'alert', dataset: { alertId: id } },
    T(e.key, e.args, 'p', { class: 'alert-msg' }),
    e.detail ? h('p', { class: 'alert-detail' }, String(e.detail).slice(0, 300)) : null,
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => box.remove() }, T('close')));
  alertsEl.prepend(box);
  while (alertsEl.children.length > 3) alertsEl.lastElementChild.remove();
  console.error(e);
}
export function showNotice(key, args) {
  const box = h('div', { class: 'alert alert-info', role: 'status' }, T(key, args, 'p', { class: 'alert-msg' }),
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => box.remove() }, T('close')));
  alertsEl.prepend(box);
  setTimeout(() => box.remove(), 6000);
}
export const clearErrors = () => clear(alertsEl);

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
    const slice = statuses.slice(i, i + group);
    let st = 'pending';
    if (slice.includes('failed')) st = 'failed';
    else if (slice.includes('active')) st = 'active';
    else if (slice.every((s) => s === 'done')) st = 'done';
    else if (slice.includes('done')) st = 'part';
    const cls = 'seg-i s-' + st + (current >= i && current < i + group ? ' s-now' : '');
    bar.append(h('span', { class: cls }));
  }
  if (!n) bar.append(h('span', { class: 'seg-i s-pending' }));
  return bar;
}

/** Label for a voice profile: the built-in narrator shows a translated name unless the user renamed it. */
export function voiceLabel(v, tag = 'span') {
  return v.name ? h(tag, null, v.name) : T('voice_narrator', null, tag);
}
