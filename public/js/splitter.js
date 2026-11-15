// Chapter detection on a list of paragraph strings, plus the editing operations used by the chapter editor.
// Paragraph objects everywhere in the app: { t: text, s: speakerId }.

const NUMW = '(?:[၀-၉0-9]{1,4}|တစ်|နှစ်|သုံး|လေး|ငါး|ခြောက်|ခုနစ်|ရှစ်|ကိုး|ဆယ်[\\u1000-\\u109F]*)';
// Strong heading patterns (a single short line)
const STRONG = [
  new RegExp('^\\s*(?:အခန်း|ခန်း)\\s*[(（\\[]?\\s*' + NUMW + '\\s*[)）\\]]?(?:[\\s:：\\-–—.၊]+\\S.{0,70})?$'),
  /^\s*(?:Chapter|CHAPTER|Ch\.)\s*(?:\d{1,4}|[IVXLCM]{1,7})\b.{0,70}$/,
  /^\s*(?:ပထမ|ဒုတိယ|တတိယ|စတုတ္ထ|ပဉ္စမ|ဆဋ္ဌမ|သတ္တမ|အဋ္ဌမ|နဝမ|ဒသမ)\s*အခန်း.{0,60}$/,
];
// Weak patterns: "၃။ Title" / "3. Title" / a lone number. Only trusted when they form a 1,2,3... sequence.
const WEAK = [
  /^\s*([၀-၉]{1,3}|\d{1,3})\s*[.)၊။\-–—:]\s*\S.{0,70}$/,
  /^\s*([၀-၉]{1,3}|\d{1,3})\s*$/,
];
const BURMESE_DIGITS = '၀၁၂၃၄၅၆၇၈၉';
export const toInt = (s) => parseInt(String(s).replace(/[၀-၉]/g, (d) => BURMESE_DIGITS.indexOf(d)), 10);

const oneLine = (p) => !p.includes('\n') && p.length <= 90;
/** Strong heading test (also used by cleanup so headings stay on their own line). */
export function isHeading(line) {
  const s = line.trim();
  return s.length > 0 && s.length <= 90 && STRONG.some((re) => re.test(s));
}
const isPureNumberHeading = (s) => new RegExp('^\\s*(?:(?:အခန်း|ခန်း)\\s*[(（\\[]?\\s*' + NUMW + '\\s*[)）\\]]?|(?:Chapter|CHAPTER)\\s*\\S+)\\s*$').test(s);

let idc = 0;
export const newId = (p = 'ch') => `${p}_${Date.now().toString(36)}${(idc++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const mkPara = (t) => ({ t, s: 'narrator' });

function weakHeadingIndexes(paras) {
  const hits = [];
  paras.forEach((p, i) => {
    if (!oneLine(p) || /[။]$/.test(p.trim())) return;
    for (const re of WEAK) { const m = p.match(re); if (m) { hits.push({ i, n: toInt(m[1]) }); break; } }
  });
  // accept only if numbers mostly climb by 1 (at least 3 headings)
  let ok = 0;
  for (let k = 1; k < hits.length; k++) if (hits[k].n === hits[k - 1].n + 1) ok++;
  return hits.length >= 3 && ok >= (hits.length - 1) * 0.7 ? hits.map((h) => h.i) : [];
}

/**
 * Detect chapters. Returns { chapters, method: 'headings'|'parts', skippedFront }.
 * titleFn(kind, n) supplies localized default titles ('part' | 'front').
 */
export function splitChapters(paragraphs, { partChars = 6000, titleFn }) {
  const heads = new Set();
  paragraphs.forEach((p, i) => { if (oneLine(p) && STRONG.some((re) => re.test(p.trim()))) heads.add(i); });
  if (heads.size < 2) weakHeadingIndexes(paragraphs).forEach((i) => heads.add(i));

  if (heads.size >= 2) {
    const chapters = [];
    let cur = null, front = [];
    paragraphs.forEach((p, i) => {
      if (heads.has(i)) {
        let title = p.trim();
        cur = { id: newId(), title, paras: [] };
        chapters.push(cur);
        return;
      }
      if (cur) cur.paras.push(mkPara(p)); else front.push(p);
    });
    // "အခန်း ၁" followed by a short title line -> use it as the title
    for (const ch of chapters) {
      const first = ch.paras[0]?.t;
      if (first && isPureNumberHeading(ch.title) && first.length <= 50 && !/[။!?]$/.test(first) && ch.paras.length > 1) {
        ch.title = `${ch.title} ${first}`; ch.paras.shift();
      }
    }
    const frontChars = front.join('').length;
    let skippedFront = 0;
    if (frontChars >= 300) chapters.unshift({ id: newId(), title: titleFn('front'), paras: front.map(mkPara) });
    else skippedFront = frontChars;
    return { chapters: chapters.filter((c) => c.paras.length), method: 'headings', skippedFront };
  }

  // Fallback: fixed-size parts on paragraph boundaries
  const chapters = [];
  let cur = null, size = 0;
  for (const p of paragraphs) {
    if (!cur || size >= partChars) { cur = { id: newId(), title: titleFn('part', chapters.length + 1), paras: [] }; chapters.push(cur); size = 0; }
    cur.paras.push(mkPara(p)); size += p.length;
  }
  return { chapters, method: 'parts', skippedFront: 0 };
}

// ---- editor operations (all return nothing and mutate the array in place) ----
export function mergeWithNext(chs, i) {
  if (i < 0 || i >= chs.length - 1) return false;
  chs[i].paras.push(...chs[i + 1].paras);
  chs.splice(i + 1, 1);
  return true;
}
/** Split chapter i so paragraph `at` becomes the first paragraph of a new chapter. */
export function splitChapterAt(chs, i, at, newTitle) {
  const ch = chs[i];
  if (!ch || at <= 0 || at >= ch.paras.length) return false;
  chs.splice(i + 1, 0, { id: newId(), title: newTitle, paras: ch.paras.splice(at) });
  return true;
}
export function deleteChapter(chs, i) { if (i < 0 || i >= chs.length) return false; chs.splice(i, 1); return true; }
