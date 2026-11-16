// App shell: language toggle, hash router, bottom navigation, long-press/selection blocking.
import { initLang, setLang, getLang } from './i18n.js';
import { initUI, showIn, slot } from './ui.js';
import * as library from './views/library.js';
import * as imp from './views/import.js';
import * as book from './views/book.js';
import * as player from './views/player.js';
import * as merge from './views/merge.js';
import * as settings from './views/settings.js';

const VIEWS = { library, import: imp, book, player, merge, settings };
const NAV_OF = { library: 'library', book: 'library', import: 'library', player: 'player', merge: 'merge', settings: 'settings' };
const scrollPos = {};
let current = null;

// ---- Block browser text/photo selection (long-press menu, selection handles, image drag) ----
// Inputs, textareas and selects stay selectable so typing and editing still work.
const EDITABLE = 'input, textarea, select, [contenteditable="true"]';
const elOf = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);
document.addEventListener('contextmenu', (e) => { if (!elOf(e.target)?.closest(EDITABLE)) e.preventDefault(); });
document.addEventListener('selectstart', (e) => { if (!elOf(e.target)?.closest(EDITABLE)) e.preventDefault(); });
document.addEventListener('dragstart', (e) => e.preventDefault());

/** Last resort for unexpected errors: shown at the top of the screen the user is on. */
function fallbackError(e) {
  const view = document.getElementById('view-' + (current || 'library'));
  let s = view.querySelector(':scope > .slot.fallback');
  if (!s) { s = slot(); s.classList.add('fallback'); view.prepend(s); }
  showIn(s, e);
}

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  const [name = 'library', ...args] = (location.hash.replace(/^#\/?/, '') || 'library').split('/');
  const view = VIEWS[name] ? name : 'library';
  if (current) scrollPos[current] = window.scrollY;
  current?.startsWith('book') && book.hide?.();
  for (const [id, mod] of Object.entries(VIEWS)) document.getElementById('view-' + id).hidden = id !== view;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.nav === NAV_OF[view]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  current = view;
  try { await VIEWS[view].show(...args); } catch (e) { fallbackError(e); }
  window.scrollTo(0, scrollPos[view] || 0);
}

function boot() {
  initLang();
  initUI();
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  for (const [id, mod] of Object.entries(VIEWS)) mod.mount?.(document.getElementById('view-' + id), { go });
  window.addEventListener('hashchange', route);
  window.addEventListener('unhandledrejection', (e) => { fallbackError(e.reason); e.preventDefault(); });
  // keep content clear of the floating header / nav whatever their height (wrapped titles, long Burmese labels)
  const setBars = () => {
    const r = document.documentElement.style;
    r.setProperty('--header-h', document.getElementById('top').offsetHeight + 'px');
    r.setProperty('--nav-h', document.getElementById('nav').offsetHeight + 'px');
  };
  new ResizeObserver(setBars).observe(document.getElementById('top'));
  new ResizeObserver(setBars).observe(document.getElementById('nav'));
  setBars();
  route();
}
boot();
