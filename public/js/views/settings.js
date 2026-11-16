// Settings: generation, Hugging Face Space (with a cloning check), storage, download path test, about / developer contact.
import { h, T, clear, add } from '../dom.js';
import { t } from '../i18n.js';
import { getSettings, saveSettings, LIMITS, DEFAULTS } from '../settings.js';
import { audioUsage, storageEstimate, clearChunkAudio } from '../store.js';
import { requestTts, isBusy } from '../generator.js';
import { fetchAudioBlob, getAudioPath, resetAudioPath } from '../audio.js';
import { slot, showIn, hintIn, confirmDialog, panel, run } from '../ui.js';
import { AppError } from '../errors.js';

let root;
export function mount(el) { root = el; }
const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(0, Math.round(n / 1024)) + ' KB');

export async function show() {
  clear(root);
  const s = getSettings();

  const numField = (key, hintKey, name, step) => {
    const [lo, hi] = LIMITS[name];
    const err = slot();
    const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step, min: lo, max: hi, value: s[name] });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < lo || v > hi) { showIn(err, new AppError('err_setting_range', { lo, hi })); input.value = getSettings()[name]; return; }
      saveSettings({ [name]: v }); hintIn(err, 'settings_saved');
    });
    return h('div', { class: 'stack-tight' }, h('label', { class: 'field' }, T(key, null, 'span', { class: 'field-label' }), input, T(hintKey, { lo, hi, def: DEFAULTS[name] }, 'span', { class: 'hint' })), err);
  };

  // --- Space + cloning check ---
  const spaceErr = slot();
  const space = h('input', { class: 'input', type: 'text', value: s.space, autocapitalize: 'none', spellcheck: 'false' });
  space.placeholder = 'openbmb/VoxCPM-Demo';
  space.addEventListener('change', () => {
    const v = space.value.trim();
    if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) { showIn(spaceErr, new AppError('err_space_format')); space.value = getSettings().space; return; }
    saveSettings({ space: v }); hintIn(spaceErr, 'settings_saved');
  });
  const checkOut = slot();
  const checkBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, T('space_check'));
  checkBtn.addEventListener('click', run(checkOut, async () => {
    const sp = getSettings().space.trim();
    let r;
    try { r = await fetch('/api/space-info' + (sp ? '?s=' + encodeURIComponent(sp) : '')); }
    catch (e) { throw new AppError('err_network', null, String(e.message || e)); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) throw new AppError('err_spaceinfo_404');
    if (!r.ok) throw new AppError('err_space_check', { status: r.status }, j.error || '');
    if (!j.hasGenerate) throw new AppError('err_space_nogenerate', null, (j.params || []).join(', '));
    hintIn(checkOut, j.cloning ? (j.promptText ? 'space_ok_full' : 'space_ok_ref') : 'space_no_clone', null, 0);
  }, checkBtn));

  // --- storage ---
  const usage = h('div', { class: 'stack-tight' }), usageErr = slot();
  const refreshUsage = async () => {
    clear(usage);
    try {
      const [u, e] = await Promise.all([audioUsage(), storageEstimate()]);
      add(usage, T('usage_audio', { size: fmtBytes(u.bytes), n: u.count }, 'p'), e ? T('usage_total', { used: fmtBytes(e.usage), quota: fmtBytes(e.quota) }, 'p', { class: 'muted' }) : null);
    } catch (err) { showIn(usageErr, err); }
  };
  const clearErr = slot();

  // --- download path ---
  const pathBox = h('div', { class: 'stack-tight' });
  const drawPath = () => { clear(pathBox); const p = getAudioPath(); pathBox.append(T(p === 'direct' ? 'path_direct' : p === 'proxy' ? 'path_proxy' : 'path_unknown', null, 'p')); };
  drawPath();
  const testOut = slot();
  const testBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, T('test_btn'));
  testBtn.addEventListener('click', run(testOut, async () => {
    if (isBusy()) throw new AppError('err_busy');
    resetAudioPath(); // force a fresh CORS check
    hintIn(testOut, 'test_running', null, 0);
    const url = await requestTts({ text: t('test_text'), control: '', cfg: getSettings().cfg });
    const { blob, path } = await fetchAudioBlob(url);
    drawPath(); hintIn(testOut, path === 'direct' ? 'test_ok_direct' : 'test_ok_proxy', { size: fmtBytes(blob.size) }, 0);
  }, testBtn));

  root.append(
    h('div', { class: 'view-head' }, T('set_title', null, 'h1', { class: 'view-title' })),
    panel({ titleKey: 'set_generation', hintKey: 'set_generation_hint', icon: '♪' },
      numField('set_chunk', 'set_chunk_hint', 'chunkSize', '10'),
      T('set_chunk_warn', null, 'p', { class: 'notice' }),
      numField('set_cfg', 'set_cfg_hint', 'cfg', '0.1')),
    panel({ titleKey: 'set_space', hintKey: 'set_space_hint', icon: '☁' },
      h('label', { class: 'field' }, T('set_space_name', null, 'span', { class: 'field-label' }), space), spaceErr,
      checkBtn, checkOut),
    panel({ titleKey: 'set_storage', icon: '▤' }, usage, usageErr,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: refreshUsage }, T('usage_refresh')),
        h('button', { class: 'btn btn-danger-quiet', type: 'button',
          onclick: run(clearErr, async () => {
            if (!(await confirmDialog({ msgKey: 'clear_confirm', okKey: 'clear_audio', danger: true }))) return;
            await clearChunkAudio(); hintIn(clearErr, 'clear_done'); await refreshUsage();
          }) }, T('clear_audio'))), clearErr),
    h('details', { class: 'more' }, h('summary', null, T('set_audio_path')),
      h('div', { class: 'more-body' }, pathBox, T('set_audio_path_hint', null, 'p', { class: 'muted' }), testBtn, testOut)),
    panel({ titleKey: 'about_title', hintKey: 'about_hint', icon: 'i' },
      h('div', { class: 'contact' },
        h('p', { class: 'file-name' }, T('about_team', null, 'span'), ': AmazinG'),
        h('a', { class: 'btn btn-quiet', href: 'https://t.me/aung_myat_minn', target: '_blank', rel: 'noopener' }, h('span', null, 'Telegram: @aung_myat_minn')),
        h('a', { class: 'btn btn-quiet', href: 'mailto:amazingxstudio@google.com' }, h('span', null, 'Gmail: amazingxstudio@google.com')))));
  refreshUsage();
}
