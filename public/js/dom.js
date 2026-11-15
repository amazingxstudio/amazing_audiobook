// Tiny DOM helpers. All visible text goes through T()/setT() so it follows the language switch.
import { setT } from './i18n.js';

const PROP = new Set(['value', 'disabled', 'hidden', 'checked', 'selected', 'multiple', 'required', 'readOnly', 'open']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROP.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : String(k));
  }
  return el;
}
/** Like el.append(...) but skips null/false (native append would print the word "null"). */
export const add = (el, ...kids) => append(el, kids);
/** Element whose text is a translation key (re-translated automatically on language switch). */
export function T(key, args, tag = 'span', props) {
  const el = h(tag, props);
  setT(el, key, args);
  return el;
}
/** Set an attribute from a translation key: kind = 'aria' | 'placeholder' | 'title'. */
export function tAttr(el, kind, key) {
  el.dataset['i18n' + kind[0].toUpperCase() + kind.slice(1)] = key;
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };
