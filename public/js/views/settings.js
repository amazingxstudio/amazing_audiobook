// Settings: chunk size, cfg, Space override, storage usage, clear audio, download-path test.
import { h, T, tAttr, clear } from '../dom.js';
import { t, setT } from '../i18n.js';
import { getSettings, saveSettings, LIMITS, DEFAULTS } from '../settings.js';
import { audioUsage, storageEstimate, clearChunkAudio } from '../store.js';
import { requestTts, isBusy } from '../generator.js';
import { fetchAudioBlob, getAudioPath, resetAudioPath } from '../audio.js';
import { showError, showNotice, confirmDialog } from '../ui.js';
import { AppError } from '../errors.js';

let root, ctx;
export function mount(el, c) { root = el; ctx = c; }

const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(0, Math.round(n / 1024)) + ' KB');

export async function show() {
  clear(root);
  const s = getSettings();
  const num = (key, hintKey, name, step, onSave) => {
    const [lo, hi] = LIMITS[name];
    const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step, min: lo, max: hi, value: s[name] });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < lo || v > hi) { showError(new AppError('err_setting_range', { lo, hi })); input.value = getSettings()[name]; return; }
      saveSettings({ [name]: v }); showNotice('settings_saved');
    });
    return h('label', { class: 'field' }, T(key, null, 'span', { class: 'field-label' }), input, T(hintKey, { lo, hi, def: DEFAULTS[name] }, 'span', { class: 'hint' }));
  };
  const space = h('input', { class: 'input', type: 'text', value: s.space, autocapitalize: 'none', spellcheck: 'false' });
  space.placeholder = 'openbmb/VoxCPM-Demo';
  space.addEventListener('change', () => {
    const v = space.value.trim();
    if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) { showError(new AppError('err_space_format')); space.value = getSettings().space; return; }
    saveSettings({ space: v }); showNotice('settings_saved');
  });

  const usage = h('div', { class: 'stack-tight' });
  const refreshUsage = async () => {
    clear(usage);
    try {
      const [u, e] = await Promise.all([audioUsage(), storageEstimate()]);
      usage.append(T('usage_audio', { size: fmtBytes(u.bytes), n: u.count }, 'p'));
      if (e) usage.append(T('usage_total', { used: fmtBytes(e.usage), quota: fmtBytes(e.quota) }, 'p', { class: 'muted' }));
    } catch (err) { showError(err); }
  };

  const pathBox = h('div', { class: 'stack-tight' });
  const drawPath = () => {
    clear(pathBox);
    const p = getAudioPath();
    pathBox.append(T(p === 'direct' ? 'path_direct' : p === 'proxy' ? 'path_proxy' : 'path_unknown', null, 'p'));
  };
  drawPath();
  const testOut = h('div', { class: 'stack-tight', 'aria-live': 'polite' });
  const testBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, T('test_btn'));
  testBtn.addEventListener('click', async () => {
    if (isBusy()) return showError(new AppError('err_busy'));
    testBtn.disabled = true; clear(testOut); testOut.append(T('test_running', null, 'p'));
    try {
      resetAudioPath(); // force a fresh CORS check
      const url = await requestTts({ text: t('test_text'), control: '', cfg: getSettings().cfg });
      const { blob, path } = await fetchAudioBlob(url);
      clear(testOut); testOut.append(T(path === 'direct' ? 'test_ok_direct' : 'test_ok_proxy', { size: fmtBytes(blob.size) }, 'p', { class: 'ok' }));
    } catch (e) { clear(testOut); showError(e); }
    drawPath(); testBtn.disabled = false;
  });

  root.append(
    T('set_title', null, 'h1', { class: 'view-title' }),
    h('section', { class: 'card stack' },
      T('set_generation', null, 'h2'),
      num('set_chunk', 'set_chunk_hint', 'chunkSize', '10'),
      T('set_chunk_warn', null, 'p', { class: 'notice' }),
      num('set_cfg', 'set_cfg_hint', 'cfg', '0.1'),
      h('label', { class: 'field' }, T('set_space', null, 'span', { class: 'field-label' }), space, T('set_space_hint', null, 'span', { class: 'hint' }))),
    h('section', { class: 'card stack' },
      T('set_storage', null, 'h2'), usage,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: refreshUsage }, T('usage_refresh')),
        h('button', { class: 'btn btn-danger-quiet', type: 'button',
          onclick: async () => {
            if (!(await confirmDialog({ msgKey: 'clear_confirm', okKey: 'clear_audio', danger: true }))) return;
            try { await clearChunkAudio(); showNotice('clear_done'); refreshUsage(); } catch (e) { showError(e); }
          } }, T('clear_audio')))),
    h('section', { class: 'card stack' },
      T('set_audio_path', null, 'h2'), pathBox,
      T('set_audio_path_hint', null, 'p', { class: 'muted' }),
      testBtn, testOut));
  refreshUsage();
}
