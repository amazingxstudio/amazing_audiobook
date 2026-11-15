// Node unit tests for the pure modules: node tests/unit.mjs
import assert from 'node:assert/strict';
import { chunkParagraph, canCutBefore, splitSentences, planChapter, hashStr } from '../public/js/chunker.js';
import { detectEncoding, convertZawgyi } from '../public/js/zawgyi.js';
import { splitChapters, mergeWithNext, splitChapterAt, deleteChapter, isHeading } from '../public/js/splitter.js';
import { cleanPages } from '../public/js/cleanup.js';
import { mergeWav, parseWav } from '../public/js/audio.js';
import { withRetry, SequentialQueue } from '../public/js/queue.js';
import { CancelError } from '../public/js/errors.js';

let pass = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ok  ' + name); }, (e) => { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; });

const S1 = 'မနက်စောစော မြို့လေးကို နှင်းမှုန်တွေ ဖုံးလွှမ်းထားသည်။ ဆိုင်ခန်းများ ဖွင့်ကာစ အချိန်ဖြစ်သည်။ သူမသည် လက်ထဲက ထီးအိတ်ကို တင်းတင်းကိုင်ကာ လမ်းမပေါ်သို့ ထွက်လာခဲ့သည်။';
const LONG = 'မင်္ဂလာပါ ဒီနေ့ ရာသီဥတု ကောင်းလို့ ကျွန်တော်တို့ အားလုံး ပန်းခြံထဲကို လမ်းလျှောက်သွားကြပြီး သစ်ပင်အောက်မှာ ထိုင်ကာ စကားတွေ ပြောခဲ့ကြတယ်၊ ကလေးတွေက ပျော်ရွှင်စွာ ပြေးလွှားကစားနေကြပြီး အမေကတော့ မုန့်တွေ ယူလာခဲ့တယ်';
const LONG_NOSPACE = LONG.replace(/ /g, '');

await ok('splitSentences keeps terminators and closing quotes', () => {
  const r = splitSentences('“ဘယ်သွားမလဲ။” ဟု မေးသည်။ ဟုတ်ကဲ့။');
  assert.equal(r.length, 3); assert.ok(r[0].endsWith('” '));
});
await ok('chunks respect max and re-join to the original text', () => {
  for (const max of [60, 120, 250]) for (const src of [S1.repeat(4), LONG, LONG_NOSPACE, LONG_NOSPACE.repeat(3)]) {
    const ch = chunkParagraph(src, max);
    assert.ok(ch.every((c) => c.text.length <= max), `len>${max}`);
    assert.equal(ch.map((c) => c.text).join('').replace(/\s/g, ''), src.replace(/\s/g, ''));
  }
});
await ok('never cuts inside a syllable (no chunk starts with a dependent mark or follows a virama)', () => {
  const DEP = /^[\u102B-\u103E\u1056-\u1059]/;
  for (const max of [30, 45, 60, 90]) {
    const ch = chunkParagraph(LONG_NOSPACE.repeat(5), max);
    ch.forEach((c, i) => {
      assert.ok(!DEP.test(c.text), 'starts with dependent: ' + c.text.slice(0, 4));
      if (i > 0) assert.notEqual(ch[i - 1].text.slice(-1), '\u1039', 'ends with virama');
    });
  }
});
await ok('prefers sentence ends, then ၊, then spaces (not forced)', () => {
  const ch = chunkParagraph(S1, 80);
  assert.ok(ch.length >= 2); assert.ok(ch.slice(0, -1).every((c) => /။$/.test(c.text)), JSON.stringify(ch.map(c=>c.text)));
  const c2 = chunkParagraph(LONG, 90);
  assert.ok(c2.every((c) => !c.forced), 'forced cut although spaces exist');
});
await ok('canCutBefore rules', () => {
  const w = 'မင်္ဂလာ';           // မ င ် ္ ဂ လ ာ
  assert.equal(canCutBefore(w, 1), false); // before င (final consonant with asat)
  assert.equal(canCutBefore(w, 4), false); // after virama
  assert.equal(canCutBefore(w, 5), true);  // before လ
  assert.equal(canCutBefore('abc def', 1), false); assert.equal(canCutBefore('abc def', 4), true);
  assert.equal(canCutBefore('ပါ။', 2), false);
});
await ok('planChapter: keys depend on text, voice control and cfg', () => {
  const book = { id: 'b1', voices: [{ id: 'narrator', control: '' }, { id: 'v2', control: 'old man' }] };
  const ch = { paras: [{ t: S1, s: 'narrator' }, { t: S1, s: 'v2' }] };
  const a = planChapter(book, ch, { chunkSize: 250, cfg: 2 });
  assert.equal(a.length, 2); assert.notEqual(a[0].key, a[1].key);
  assert.deepEqual(a.map((x) => x.pauseAfter), ['para', 'para']);
  const b = planChapter(book, ch, { chunkSize: 250, cfg: 2.5 });
  assert.notEqual(a[0].key, b[0].key);
  assert.equal(planChapter(book, ch, { chunkSize: 250, cfg: 2 })[0].key, a[0].key);
  assert.equal(hashStr('x'), hashStr('x'));
});

await ok('detectEncoding: Unicode vs Zawgyi sample', () => {
  const uni = (S1 + ' ').repeat(4);
  assert.equal(detectEncoding(uni).encoding, 'unicode');
  // Zawgyi-encoded forms (ေ before consonant, visible asat U+1039, ြ typed first)
  const zg = 'ေကာင္းပါတယ္။ ျမန္မာ ႏိုင္ငံ ေရာက္ေနတဲ့ ေက်ာင္းသား ေတြ ေပ်ာ္ေနၾကတယ္။ ေတာ္ေတာ္ ေကာင္းတယ္။ ေမာင္ေမာင္ ေျပာတယ္။ '.repeat(3);
  assert.equal(detectEncoding(zg).encoding, 'zawgyi');
  assert.equal(detectEncoding('hello world').encoding, 'unknown');
});
await ok('convertZawgyi: known words', () => {
  assert.equal(convertZawgyi('ျမန္မာ').text, 'မြန်မာ');
  assert.equal(convertZawgyi('ေကာင္း').text, 'ကောင်း');
  assert.equal(convertZawgyi('သည္').text, 'သည်');
  assert.equal(convertZawgyi('\u1000\u103A').text, '\u1000\u103B'); // Zawgyi ya-pin U+103A -> Unicode U+103B
  assert.equal(convertZawgyi('Hello 123').text, 'Hello 123');
  assert.equal(convertZawgyi('\u1019\u1031\u1019\u1031').text.length, 4);
  assert.ok(convertZawgyi('\u1031\u1019\u1031\u1019').text, 'does not throw');
});

await ok('isHeading patterns', () => {
  for (const h of ['အခန်း ၁', 'အခန်း (၂)', 'အခန်း၃', 'အခန်း (၁) - မိုးရာသီ', 'Chapter 3', 'CHAPTER IV', 'ပထမ အခန်း', 'အခန်း ၁၂ ညနေခင်း']) assert.ok(isHeading(h), h);
  for (const h of ['သူမ အခန်းထဲ ဝင်သွားသည်။', 'This is a chapter of life', 'ခန်းမ ကြီးထဲမှာ လူတွေ ပြည့်နေသည်။'.repeat(3)]) assert.ok(!isHeading(h), h);
});
const tf = (k, n) => (k === 'front' ? 'FRONT' : `PART ${n}`);
await ok('splitChapters: headings, front matter, title line, fallback parts', () => {
  const body = (n) => S1.repeat(n);
  const paras = [body(2), 'အခန်း ၁', 'မိုးရာသီ', body(1), body(1), 'အခန်း (၂)', body(1), 'Chapter 3', body(1)];
  const r = splitChapters(paras, { titleFn: tf });
  assert.equal(r.method, 'headings');
  assert.deepEqual(r.chapters.map((c) => c.title), ['FRONT', 'အခန်း ၁ မိုးရာသီ', 'အခန်း (၂)', 'Chapter 3']);
  const r2 = splitChapters(Array.from({ length: 40 }, () => S1.repeat(2)), { partChars: 1000, titleFn: tf });
  assert.equal(r2.method, 'parts'); assert.ok(r2.chapters.length > 3); assert.equal(r2.chapters[0].title, 'PART 1');
  const w = ['x', '၁။ တစ်ခန်း', body(1), '၂။ နောက်ခန်း', body(1), '၃။ နောက်ဆုံး', body(1)];
  assert.equal(splitChapters(w, { titleFn: tf }).method, 'headings');
});
await ok('editor ops: merge, split, delete', () => {
  const mk = (t, n) => ({ id: t, title: t, paras: Array.from({ length: n }, (_, i) => ({ t: t + i, s: 'narrator' })) });
  const chs = [mk('a', 3), mk('b', 2), mk('c', 1)];
  assert.ok(mergeWithNext(chs, 0)); assert.equal(chs.length, 2); assert.equal(chs[0].paras.length, 5);
  assert.ok(splitChapterAt(chs, 0, 2, 'NEW')); assert.equal(chs[1].title, 'NEW'); assert.equal(chs[0].paras.length, 2); assert.equal(chs[1].paras.length, 3);
  assert.ok(!splitChapterAt(chs, 0, 0, 'x')); assert.ok(!mergeWithNext(chs, 2));
  assert.ok(deleteChapter(chs, 1)); assert.equal(chs.length, 2);
});

const L = (text, i, x = 50, w = 400) => ({ text, x, y: 800 - i * 20, h: 12, w });
await ok('cleanup: page numbers, repeated headers/footers, joined lines, paragraph breaks', () => {
  const pages = [];
  for (let p = 1; p <= 6; p++) pages.push({ lines: [
    L('ဝတ္ထုအမည် - ညနေခင်း', 0), L(`${p}`, 1, 250, 10),
    L('အခန်း ၁', 2, 250, 60),
    L('မနက်စောစော မြို့လေးကို နှင်းမှုန်တွေ', 3), L('ဖုံးလွှမ်းထားသည်။', 4, 50, 120),
    L('ဆိုင်ခန်းများ ဖွင့်ကာစ အချိန်ဖြစ်သည်။ သူမ', 5), L('လမ်းမပေါ် ထွက်လာခဲ့သည်။', 6, 50, 150),
    L('Page ' + p, 30, 250, 40),
  ] });
  const { paragraphs, stats } = cleanPages(pages);
  assert.equal(stats.pageNumbers >= 12, true, JSON.stringify(stats));
  assert.ok(stats.headersFooters >= 6);
  assert.ok(!paragraphs.some((x) => x.includes('ဝတ္ထုအမည်')));
  assert.ok(paragraphs.includes('အခန်း ၁'));
  assert.ok(paragraphs.includes('မနက်စောစော မြို့လေးကို နှင်းမှုန်တွေဖုံးလွှမ်းထားသည်။'), JSON.stringify(paragraphs.slice(0, 4)));
});
await ok('cleanup: Latin lines join with a space; indent starts a new paragraph', () => {
  const lines = [L('The rain had been', 0, 50, 400), L('falling all night.', 1, 50, 400), L('Morning came late.', 2, 80, 400)];
  const r = cleanPages([{ lines }]);
  assert.deepEqual(r.paragraphs, ['The rain had been falling all night.', 'Morning came late.']);
});

// --- WAV ---
function wav(samples, rate = 24000) {
  const b = Buffer.alloc(44 + samples * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40); for (let i = 0; i < samples; i++) b.writeInt16LE(((i % 100) - 50) * 100, 44 + i * 2);
  return new Blob([b], { type: 'audio/wav' });
}
await ok('mergeWav: valid header, sizes include pauses, rejects mismatches', async () => {
  const out = await mergeWav([wav(2400), wav(4800), wav(1200)], ['sentence', 'para']);
  const info = await parseWav(out);
  const pause = (ms) => Math.round(ms / 1000 * 24000) * 2;
  assert.equal(info.dataSize, (2400 + 4800 + 1200) * 2 + pause(120) + pause(450));
  assert.equal(info.sampleRate, 24000); assert.equal(out.size, 44 + info.dataSize);
  await assert.rejects(mergeWav([wav(100), wav(100, 16000)]), (e) => e.key === 'err_wav_mismatch');
  await assert.rejects(mergeWav([new Blob(['not a wav file at all, definitely not riff data......'])]), (e) => e.key === 'err_not_wav');
});

// --- queue / retry ---
await ok('withRetry: 3 attempts then success; gives up after 3; no retry when shouldRetry=false', async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) throw new Error('boom'); return 'ok'; }, { delays: [5, 5] });
  assert.equal(r, 'ok'); assert.equal(n, 3);
  n = 0; await assert.rejects(withRetry(async () => { n++; throw new Error('x'); }, { delays: [5, 5] })); assert.equal(n, 3);
  n = 0; await assert.rejects(withRetry(async () => { n++; throw new Error('x'); }, { delays: [5, 5], shouldRetry: () => false })); assert.equal(n, 1);
});
await ok('SequentialQueue: strictly one at a time, pause/resume/cancel', async () => {
  const q = new SequentialQueue(); let active = 0, maxActive = 0; const order = [];
  const task = (i) => q.add(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 10)); active--; order.push(i); });
  const ps = [1, 2, 3, 4].map(task);
  q.pause(); await new Promise((r) => setTimeout(r, 60));
  const doneWhilePaused = order.length;
  q.resume(); await Promise.all(ps);
  assert.equal(maxActive, 1); assert.deepEqual(order, [1, 2, 3, 4]); assert.ok(doneWhilePaused <= 1);
  const q2 = new SequentialQueue(); const p = [q2.add(() => new Promise((r) => setTimeout(r, 30))), q2.add(async () => 1)];
  q2.cancel(); await assert.rejects(p[1], CancelError);
});
console.log(process.exitCode ? '\nSOME TESTS FAILED' : `\nall ${pass} passed`);
