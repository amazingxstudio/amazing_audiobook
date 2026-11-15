// PDF text extraction in the browser with pdf.js (loaded from cdnjs, exact version pinned).
// Returns per-page lines with geometry so cleanup.js can detect paragraphs, headers and footers.
import { AppError } from './errors.js';

export const PDFJS_VERSION = '3.11.174';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
let loading = null;

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = BASE + 'pdf.min.js'; s.async = true;
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('pdfjsLib missing'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { loading = null; reject(new Error('script load failed')); };
    document.head.append(s);
  });
  return loading;
}

/** Group pdf.js text items into visual lines (top to bottom, items left to right). Exported for tests. */
export function itemsToLines(items) {
  const its = items
    .filter((i) => typeof i.str === 'string' && i.str !== '' && i.transform)
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 10, w: i.width || 0 }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - it.y) <= 0.5 * Math.max(L.h, it.h)) { L.items.push(it); L.h = Math.max(L.h, it.h); }
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines.map((L) => {
    L.items.sort((a, b) => a.x - b.x);
    let text = '', prevEnd = null;
    for (const it of L.items) {
      if (prevEnd !== null && it.x - prevEnd > 0.3 * L.h && !text.endsWith(' ') && !it.s.startsWith(' ')) text += ' ';
      text += it.s; prevEnd = it.x + it.w;
    }
    const x = L.items[0].x, last = L.items[L.items.length - 1];
    return { text: text.trim(), x, y: L.y, h: L.h, w: last.x + last.w - x };
  }).filter((l) => l.text);
}

export async function extractPdf(file, { onProgress } = {}) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new AppError('err_not_pdf');
  let lib;
  try { lib = await loadPdfJs(); } catch (e) { throw new AppError('err_pdf_load', null, String(e.message || e)); }
  let doc;
  try { doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  catch (e) { throw new AppError('err_pdf_read', null, String(e.message || e)); }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p);
      pages.push({ lines: itemsToLines((await page.getTextContent()).items) });
      page.cleanup();
    } catch (e) { throw new AppError('err_pdf_page', { n: p }, String(e.message || e)); }
    onProgress?.(p, doc.numPages);
    if (p % 4 === 0) await new Promise((r) => setTimeout(r)); // let the UI repaint the progress bar
  }
  return { pages, numPages: doc.numPages };
}
