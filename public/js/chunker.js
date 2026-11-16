// Chunker: paragraph -> sentences (။ ! ?) -> chunks <= chunkSize characters.
// Cuts only at safe places. Preference order when a sentence is too long:
//   1) after a clause mark (၊ , ; :)   2) at a space   3) after a common sentence/clause particle
//   4) at any syllable start.  A chunk cut at tier 4 is flagged `forced` (word boundary not guaranteed,
//   because Burmese has no spaces and we have no dictionary).

export const PAUSE_MS = { para: 450, sentence: 120 };

// Dependent Myanmar characters: vowel signs, medials, asat, virama, tone marks, and extension marks.
// A cut is never allowed directly before one of these.
const DEP = /[\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u200C\u200D]/;
const WORDCH = /[A-Za-z0-9\u1040-\u1049]/;
const CLOSERS = /[”’)）\]"'၊။,.!?;:]/;
const OPENERS = /[“‘(（\[]/;
const isMy = (c) => c >= '\u1000' && c <= '\u109F';

// Common particles that end a clause/sentence (tier 3 cut points).
const PARTICLE = /(?:ပါတယ်|ပါသည်|ခဲ့တယ်|ခဲ့သည်|တယ်|သည်|မယ်|မည်|ပါပြီ|ပြီး|ပြီ|ဘူး|ရင်|လျှင်|၍|ကာ|လို့|ပေမယ့်|သော်လည်း|ပါ|တော့|လေ|နော်|လား)$/;

/** True if the text may be cut right before index i without splitting a syllable (or Latin word / number). */
export function canCutBefore(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const c = s[i], p = s[i - 1], n = s[i + 1];
  if (DEP.test(c)) return false;                       // c belongs to the previous syllable
  if (p === '\u1039') return false;                    // stacked consonant belongs to the previous syllable
  if (isMy(c) && (n === '\u103A' || n === '\u1039')) return false; // c is a final consonant (asat) or will be stacked
  if (WORDCH.test(c) && WORDCH.test(p)) return false;  // inside a Latin word or a number
  if (CLOSERS.test(c) || OPENERS.test(p)) return false; // don't leave a closing mark alone or an opening mark behind
  return true;
}

/** Split text after sentence terminators, keeping closing quotes and trailing spaces with the sentence. */
export function splitSentences(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const end = c === '။' || c === '!' || c === '?' || (c === '.' && (i + 1 >= s.length || /\s/.test(s[i + 1])));
    if (!end) continue;
    let j = i + 1;
    while (j < s.length && /[။!?.”’"')）\]]/.test(s[j])) j++;
    while (j < s.length && /\s/.test(s[j])) j++;
    out.push(s.slice(start, j));
    start = j;
    i = j - 1;
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

// Find where to cut a too-long string so the left part is <= max characters.
function findCut(s, max) {
  const tiers = [
    (i) => /[၊,;:][”’)"']*\s*$/.test(s.slice(Math.max(0, i - 4), i)),
    (i) => /\s/.test(s[i - 1]),
    (i) => PARTICLE.test(s.slice(Math.max(0, i - 12), i)),
    () => true,
  ];
  for (const min of [Math.max(1, Math.floor(max * 0.3)), 1]) {
    for (let t = 0; t < tiers.length; t++) {
      for (let i = Math.min(max, s.length - 1); i >= min; i--) {
        if (canCutBefore(s, i) && tiers[t](i)) return { at: i, forced: t === 3 };
      }
    }
  }
  return { at: max, forced: true }; // last resort (e.g. a huge unbroken Latin string)
}

/** Split one paragraph into chunks no longer than `max`. Returns [{text, forced}]. */
export function chunkParagraph(text, max) {
  const out = [];
  let cur = '';
  const flush = () => { const x = cur.trim(); if (x) out.push({ text: x }); cur = ''; };
  for (const u of splitSentences(text)) {
    if (u.trim().length > max) {
      flush();
      let rest = u.trim();
      while (rest.length > max) {
        const { at, forced } = findCut(rest, max);
        out.push({ text: rest.slice(0, at).trim(), forced });
        rest = rest.slice(at).trim();
      }
      cur = rest; // the tail can still be merged with the next sentence
      continue;
    }
    if ((cur + u).trim().length > max) { flush(); cur = u; } else cur += u;
  }
  flush();
  return out;
}

// cyrb53 string hash -> short hex id (used so audio is cached per exact text + voice + cfg)
export function hashStr(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + str.length.toString(16);
}

/**
 * Build the ordered chunk list of a chapter.
 * chunk.key = "<bookId>:<hash(text, control, cfg, voice refId)>" -> same text+voice+cfg is never generated twice,
 * and changing a paragraph's speaker (or the voice's control text) automatically invalidates its audio.
 */
export function planChapter(book, chapter, { chunkSize, cfg }) {
  const voices = new Map(book.voices.map((v) => [v.id, v]));
  const out = [];
  chapter.paras.forEach((p, pi) => {
    const v = voices.get(p.s) || voices.get('narrator') || { id: 'narrator', control: '' };
    const control = (v.control || '').trim();
    const pieces = chunkParagraph(p.t, chunkSize);
    pieces.forEach((c, ci) => {
      // refId changes whenever the voice sample / locked voice changes, so audio from another voice is never reused
      const hash = hashStr(`${c.text}\u0001${control}\u0001${Number(cfg)}\u0001${v.refId || ''}`);
      out.push({
        idx: out.length, para: pi, text: c.text, speaker: v.id, control, forced: !!c.forced,
        hash, key: `${book.id}:${hash}`,
        pauseAfter: ci === pieces.length - 1 ? 'para' : 'sentence',
      });
    });
  });
  return out;
}
