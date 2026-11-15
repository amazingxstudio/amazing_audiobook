// Turns raw per-page lines (from pdf.js) into clean paragraphs.
// Input:  pages = [{ lines: [{ text, x, y, h, w }] }]   (x/y/h/w optional; without them only punctuation is used)
// Output: { paragraphs: string[], stats }

import { isHeading } from './splitter.js';

const PAGE_NUM = /^\s*(?:[-–—~(\[]\s*)?(?:(?:page|p\.|စာမျက်နှာ|စာ)\s*)?[0-9၀-၉]{1,4}(?:\s*(?:\/|of)\s*[0-9၀-၉]{1,4})?(?:\s*[-–—~)\]])?\s*$/i;
const norm = (s) => s.replace(/[0-9၀-၉]+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const TERMINAL = /[။!?.”’"')）\]]$/;
const WORD = /[A-Za-z0-9\u1040-\u1049]/;
const median = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };

export function cleanPages(pages) {
  const stats = { pageNumbers: 0, headersFooters: 0 };
  // 1) normalise lines, drop empties
  const P = pages.map((pg) => ({
    lines: pg.lines.map((l) => ({ ...l, text: l.text.replace(/[\u200B\uFEFF]/g, '').replace(/[ \t]+/g, ' ').trim() })).filter((l) => l.text),
  }));

  // 2) page numbers: only looked for in the first/last two lines of a page
  const edge = (pg, k) => [0, 1, pg.lines.length - 2, pg.lines.length - 1].filter((i, n, a) => i >= 0 && i < pg.lines.length && a.indexOf(i) === n);
  P.forEach((pg) => {
    const drop = new Set();
    for (const i of edge(pg)) if (PAGE_NUM.test(pg.lines[i].text)) drop.add(i);
    stats.pageNumbers += drop.size;
    pg.lines = pg.lines.filter((_, i) => !drop.has(i));
  });

  // 3) repeated headers/footers: same text (digits ignored) at page edges on many pages
  const counts = new Map();
  P.forEach((pg) => {
    const seen = new Set();
    for (const i of edge(pg)) { const l = pg.lines[i]; if (l && l.text.length <= 120 && !isHeading(l.text)) seen.add(norm(l.text)); }
    seen.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  });
  const minRepeat = Math.max(3, Math.ceil(P.length * 0.3));
  P.forEach((pg) => {
    const drop = new Set();
    for (const i of edge(pg)) { const l = pg.lines[i]; if (l && (counts.get(norm(l.text)) || 0) >= minRepeat && norm(l.text).length) drop.add(i); }
    stats.headersFooters += drop.size;
    pg.lines = pg.lines.filter((_, i) => !drop.has(i));
  });

  // 4) join lines into paragraphs
  const paragraphs = [];
  let buf = '', prev = null, prevHeading = false;
  const push = () => { if (buf.trim()) paragraphs.push(buf.replace(/\s{2,}/g, ' ').trim()); buf = ''; };

  for (const pg of P) {
    const widths = pg.lines.map((l) => l.w).filter((w) => w > 0);
    const maxW = pct(widths, 0.9);
    const minX = Math.min(...pg.lines.map((l) => (l.x ?? Infinity)));
    const dys = [];
    for (let i = 1; i < pg.lines.length; i++) if (pg.lines[i].y != null && pg.lines[i - 1].y != null) dys.push(Math.abs(pg.lines[i - 1].y - pg.lines[i].y));
    const medDy = median(dys);

    pg.lines.forEach((l, i) => {
      const heading = isHeading(l.text);
      const before = i > 0 ? pg.lines[i - 1] : null;
      const bigGap = before && medDy > 0 && Math.abs(before.y - l.y) > medDy * 1.6;
      const indent = l.x != null && Number.isFinite(minX) && l.h > 0 && l.x - minX > l.h * 1.2;
      const prevShortEnd = prev && prev.rel != null && prev.rel < 0.75 && TERMINAL.test(prev.text);
      const prevPlainEnd = prev && prev.rel == null && TERMINAL.test(prev.text); // no geometry: punctuation only
      const startsNew = !buf || heading || prevHeading || bigGap || indent || prevShortEnd || prevPlainEnd;
      if (startsNew) push();
      if (buf) {
        // Burmese lines join without a space; Latin/digit boundaries need one
        const a = buf[buf.length - 1], b = l.text[0];
        buf += (WORD.test(a) && WORD.test(b)) || /[.,;:!?]$/.test(a) && WORD.test(b) ? ' ' + l.text : l.text;
      } else buf = l.text;
      prev = { text: l.text, rel: maxW > 0 && l.w > 0 ? l.w / maxW : null };
      prevHeading = heading;
    });
  }
  push();
  return { paragraphs, stats };
}
