// One voice profile as a simple box: style text, voice status, "try a voice", "use my sample" (cloning), reset.
// Voice consistency: once a voice has a reference clip (from the first generated chunk, a voice you kept, or your sample)
// that clip is sent with EVERY chunk, so all chunks use the same voice.
import { h, T, clear, add, tAttr } from '../dom.js';
import { setT, t } from '../i18n.js';
import { slot, showIn, hintIn, confirmDialog, run, voiceLabel } from '../ui.js';
import { requestTts, loadRef, setVoiceRef, clearVoiceRef, pruneBookAudio, isBusy } from '../generator.js';
import { fetchAudioBlob } from '../audio.js';
import { chunkParagraph } from '../chunker.js';
import { getSettings } from '../settings.js';
import { audioKeys, saveBook } from '../store.js';
import { blobDuration, prepareRef } from '../refaudio.js';
import { AppError } from '../errors.js';

/** A short real sentence from the book to use as the voice test. */
export function testSentence(book) {
  for (const ch of book.chapters) for (const p of ch.paras) {
    const c = chunkParagraph(p.t, 120)[0];
    if (c && c.text.length >= 25) return c.text;
  }
  return t('test_text');
}

export function voiceBox(book, voice, { onChanged, onDelete, save }) {
  const err = slot(), sampleErr = slot();
  const status = h('div', { class: 'stack-tight' });
  const preview = h('div', { class: 'stack-tight' });
  let pending = null; // { blob, text } = a tried voice that can be kept

  const drawStatus = () => {
    if (typeof resetBtn !== 'undefined') resetBtn.hidden = !voice.hasRef;
    clear(status);
    const key = !voice.hasRef ? 'voice_state_none' : voice.refSource === 'upload' ? 'voice_state_upload' : voice.refSource === 'preview' ? 'voice_state_preview' : 'voice_state_auto';
    add(status,
      h('div', { class: 'chips' }, T(key, null, 'span', { class: 'chip chip-state ' + (voice.hasRef ? 's-complete' : '') }),
        voice.hasRef && voice.refSource === 'upload' ? T(voice.refText ? 'voice_mode_prompt' : 'voice_mode_ref', null, 'span', { class: 'chip' }) : null),
      T(voice.hasRef ? 'voice_state_hint_on' : 'voice_state_hint_off', null, 'p', { class: 'hint' }));
  };

  async function existingAudio() {
    const keys = await audioKeys(book.id);
    return [...keys].some((k) => !k.startsWith('ref:'));
  }
  async function confirmChange() {
    if (!(await existingAudio())) return true;
    return confirmDialog({ msgKey: 'voice_change_confirm', okKey: 'confirm_ok' });
  }
  async function afterChange() {
    await pruneBookAudio(book); drawStatus(); onChanged?.();
  }
  function showAudio(blob, keepable, textKey) {
    clear(preview);
    const url = URL.createObjectURL(blob);
    const a = h('audio', { controls: true, src: url });
    add(preview, T(textKey, null, 'p', { class: 'hint' }), a);
    if (keepable) {
      const keepErr = slot();
      add(preview, h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: run(keepErr, async () => {
          if (!(await confirmChange())) return;
          await setVoiceRef(book, voice, pending.blob, pending.text, 'preview', { newId: true });
          pending = null; clear(preview); hintIn(preview, 'voice_kept'); await afterChange();
        }) }, T('voice_keep')),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { pending = null; clear(preview); } }, T('voice_discard'))), keepErr);
    }
    a.play?.().catch(() => {});
  }
  async function generateTest(useRef) {
    if (isBusy()) throw new AppError('err_busy');
    const text = testSentence(book);
    const ref = useRef ? await loadRef(book, voice) : null;
    const url = await requestTts({ text, control: voice.control || '', cfg: getSettings().cfg, ref });
    const { blob } = await fetchAudioBlob(url);
    return { blob, text, cloned: !!ref };
  }

  // ---- style text (what the voice should be like) ----
  const control = h('textarea', { class: 'input', rows: '2', maxlength: 400 }, voice.control || '');
  tAttr(control, 'placeholder', 'voice_control_ph'); control.placeholder = t('voice_control_ph');
  control.addEventListener('change', async () => { voice.control = control.value.trim(); await save?.(); });

  // ---- sample (clone) form ----
  const file = h('input', { type: 'file', accept: 'audio/*', class: 'visually-hidden', id: 'smp-' + voice.id });
  const fileInfo = h('p', { class: 'muted' });
  setT(fileInfo, 'voice_sample_none');
  const transcript = h('textarea', { class: 'input', rows: '3', maxlength: 1500, lang: 'my' });
  tAttr(transcript, 'placeholder', 'voice_transcript_ph'); transcript.placeholder = t('voice_transcript_ph');
  let picked = null;
  file.addEventListener('change', async () => {
    picked = file.files[0] || null;
    if (!picked) return setT(fileInfo, 'voice_sample_none');
    clear(fileInfo); fileInfo.removeAttribute('data-i18n');
    const d = await blobDuration(picked);
    fileInfo.append(h('span', null, picked.name + (d ? ` (${Math.round(d)} s)` : '')));
  });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, T('voice_sample_save'));
  saveBtn.addEventListener('click', run(sampleErr, async () => {
    if (!picked) throw new AppError('err_sample_missing');
    const text = transcript.value.trim();
    // check the sample first, so a bad file is reported before the user is asked to confirm anything
    const pre = await prepareRef(picked, { maxSec: text ? 0 : 15, skipSilence: !text });
    if (text && pre.seconds > 40) throw new AppError('err_ref_long', { s: Math.round(pre.seconds) });
    if (!(await confirmChange())) return;
    await setVoiceRef(book, voice, picked, text, 'upload', { newId: true, maxSec: text ? 0 : 15 });
    voice.refName = picked.name; await save?.();
    await afterChange();
    hintIn(sampleErr, 'voice_sample_saved', null, 0);
    // let the user hear the clone right away
    const r = await generateTest(true);
    showAudio(r.blob, false, 'voice_clone_result');
  }, saveBtn));

  const sample = h('details', { class: 'more' },
    h('summary', null, T('voice_sample_title')),
    h('div', { class: 'more-body' },
      h('ol', { class: 'steps' }, T('voice_sample_s1', null, 'li'), T('voice_sample_s2', null, 'li'), T('voice_sample_s3', null, 'li')),
      h('div', { class: 'stack-tight' },
        h('label', { class: 'btn btn-quiet', for: 'smp-' + voice.id, tabindex: '0',
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, T('voice_sample_pick')),
        file, fileInfo),
      h('label', { class: 'field' }, T('voice_transcript', null, 'span', { class: 'field-label' }), transcript, T('voice_transcript_hint', null, 'span', { class: 'hint' })),
      saveBtn, sampleErr));

  const tryBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, T('voice_try'));
  tryBtn.addEventListener('click', run(err, async () => {
    const r = await generateTest(false);
    pending = { blob: r.blob, text: r.text };
    showAudio(r.blob, true, 'voice_try_result');
  }, tryBtn));
  const resetBtn = h('button', { class: 'btn btn-danger-quiet', type: 'button' }, T('voice_reset'));
  resetBtn.addEventListener('click', run(err, async () => {
    if (!(await confirmChange())) return;
    await clearVoiceRef(book, voice); clear(preview); await afterChange();
  }, resetBtn));

  drawStatus();
  const onVoice = (e) => { if (e.detail.voiceId !== voice.id || e.detail.bookId !== book.id) return; if (!box.isConnected) return document.removeEventListener('voicechange', onVoice); drawStatus(); };
  document.addEventListener('voicechange', onVoice);
  const box = h('div', { class: 'stack' },
    status,
    h('label', { class: 'field' }, T('voice_control', null, 'span', { class: 'field-label' }), control),
    h('div', { class: 'row wrap' }, tryBtn, resetBtn),
    err, preview, sample);
  return box;
}
