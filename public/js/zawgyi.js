// Zawgyi detection + a SMALL Zawgyi -> Unicode converter.
// Honest scope: covers the common letters, medials, asat, ေ/ြ re-ordering and the most common stacked
// consonants. Rare glyph variants (U+1060-1097 not listed below, kinzi forms) are NOT converted;
// convertZawgyi() reports how many such characters remain so the UI can warn clearly.

const MAP = {
  // Zawgyi U+103A is ya-pin, U+103B is ya-yit(ra), U+1039 is the visible asat.
  '\u103A': '\u103B', '\u103B': '\u103C', '\u103C': '\u103C', '\u1039': '\u103A',
  '\u107E': '\u103C', '\u107F': '\u103C', '\u1080': '\u103C', '\u1081': '\u103C', // ra-medial width variants
  '\u1033': '\u102F', '\u1034': '\u1030',                                         // long u / uu
  '\u1060': '\u1039\u1000', '\u1061': '\u1039\u1001', '\u1062': '\u1039\u1002', '\u1063': '\u1039\u1003',
  '\u1065': '\u1039\u1005', '\u1066': '\u1039\u1006', '\u1067': '\u1039\u1006',
  '\u1068': '\u1039\u1007', '\u1069': '\u1039\u1008',
  '\u106A': '\u1009', '\u106B': '\u100A', '\u108F': '\u1014', '\u1090': '\u101B',
  '\u1094': '\u1037', '\u1095': '\u1037',
  '\u1087': '\u103E', '\u1088': '\u103E\u102F', '\u1089': '\u103E\u1030', '\u108A': '\u103D\u103E',
  '\u105A': '\u102B\u103A',
};
const MAP_RE = new RegExp('[' + Object.keys(MAP).join('') + ']', 'g');
const CONS = '[\\u1000-\\u1021]';

const count = (s, re) => (s.match(re) || []).length;

/** Guess whether text is Zawgyi or Unicode. Returns {encoding: 'zawgyi'|'unicode'|'unknown', z, u, burmese}. */
export function detectEncoding(text) {
  const burmese = count(text, /[\u1000-\u109F]/g);
  if (burmese < 40) return { encoding: 'unknown', z: 0, u: 0, burmese };
  // Zawgyi-only signals
  const z =
    3 * count(text, /[\u1060-\u1068\u106A-\u1097]/g) +                      // Zawgyi-only glyph code points
    2 * count(text, /(?:^|[^\u1000-\u1021\u103B-\u103E\u1025-\u1027])\u1031/g); // ေ not after a consonant/medial
  // Unicode-only signals: ေ directly after consonant+medials and followed by ာ/ါ ("ော"), kinzi "င်္"
  const u =
    2 * count(text, /[\u1000-\u1021][\u103B-\u103E]*\u1031[\u102B\u102C]/g) +
    2 * count(text, /\u1004\u103A\u1039/g) +
    count(text, /\u1039[\u1000-\u1021]/g) * 0; // (virama also appears in Zawgyi data, not used as a signal)
  let encoding = 'unknown';
  if (z >= 3 && z > 2 * u) encoding = 'zawgyi';
  else if (u > 2 * z || z === 0) encoding = 'unicode';
  return { encoding, z, u, burmese };
}

/** Convert Zawgyi text to Unicode. Returns {text, unsupported}. */
export function convertZawgyi(input) {
  let s = input.replace(MAP_RE, (c) => MAP[c]);
  s = s.replace(/\u1025\u102E/g, '\u1026').replace(/\u1025(?=[\u103A\u102C])/g, '\u1009');
  // Zawgyi uses digit 0 / 7 for wa / ra when they sit between Burmese letters
  s = s.replace(/(?<=[\u1000-\u103E])\u1040(?![\u1040-\u1049])|(?<![\u1040-\u1049])\u1040(?=[\u1000-\u103E])/g, '\u101D');
  s = s.replace(/(?<=[\u1000-\u103E])\u1047(?![\u1040-\u1049])|(?<![\u1040-\u1049])\u1047(?=[\u1000-\u103E])/g, '\u101B');
  // Visual order -> logical order: [ေ][ြ] consonant [stack][ျ ွ ှ]  ->  consonant [stack] medials(sorted) ေ
  const re = new RegExp('([\\u1031\\u103C]+)(' + CONS + ')((?:\\u1039' + CONS + ')*)([\\u103B\\u103D\\u103E]*)', 'g');
  s = s.replace(re, (_, pre, c, stack, med) => {
    const all = Array.from(new Set((pre.includes('\u103C') ? '\u103C' : '') + med)).sort().join('');
    return c + stack + all + (pre.includes('\u1031') ? '\u1031' : '');
  });
  const unsupported = count(s, /[\u1060-\u1097]/g);
  return { text: s, unsupported };
}
