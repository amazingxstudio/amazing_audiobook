// IndexedDB wrapper.
//   books : { id, title, createdAt, updatedAt, chapters:[{id,title,paras:[{t,s}]}], voices:[...], meta }
//   audio : { key, bookId, kind: 'chunk'|'ref', blob, size, type, at }   (key = "<bookId>:<hash>" or "ref:<bookId>:<voiceId>")
import { AppError, toAppError } from './errors.js';

const DB_NAME = 'burmese-audiobook';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new AppError('err_idb_missing'));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'key' }).createIndex('bookId', 'bookId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new AppError('err_idb_open', null, String(r.error?.message || r.error)));
    r.onblocked = () => reject(new AppError('err_idb_open', null, 'blocked'));
  }).catch((e) => { dbp = null; throw e; });
  return dbp;
}

// Run one transaction. fn(store) may return an IDBRequest (its result is returned) or a plain value.
function run(storeName, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      const r = fn(store);
      if (r && typeof r === 'object' && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      else result = r;
    } catch (e) { reject(toAppError(e)); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(toAppError(tx.error));
    tx.onabort = () => reject(toAppError(tx.error || new Error('aborted')));
  }));
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));

// ---- books ----
export const listBooks = () => run('books', 'readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => y.updatedAt - x.updatedAt));
export const getBook = (id) => run('books', 'readonly', (s) => s.get(id));
export const saveBook = (book) => { book.updatedAt = Date.now(); return run('books', 'readwrite', (s) => s.put(book)); };
export async function deleteBook(id) {
  await run('books', 'readwrite', (s) => s.delete(id));
  await deleteAudioByBook(id, null);
}

// ---- audio ----
export const putAudio = (rec) => run('audio', 'readwrite', (s) => s.put({ at: Date.now(), size: rec.blob.size, type: rec.blob.type, ...rec }));
export const getAudio = (key) => run('audio', 'readonly', (s) => s.get(key));
export async function getAudioBlob(key) { const r = await getAudio(key); return r ? r.blob : null; }
/** Set of audio keys stored for a book (chunks only; does not load any blob). */
export async function audioKeys(bookId) {
  const keys = await run('audio', 'readonly', (s) => s.index('bookId').getAllKeys(bookId));
  return new Set(keys);
}
export const deleteAudio = (key) => run('audio', 'readwrite', (s) => s.delete(key));
/** Delete a book's audio. kind = 'chunk' | 'ref' | null (all). */
export function deleteAudioByBook(bookId, kind = 'chunk') {
  return run('audio', 'readwrite', (s) => {
    const req = s.index('bookId').openCursor(bookId);
    req.onsuccess = () => { const c = req.result; if (!c) return; if (!kind || c.value.kind === kind) c.delete(); c.continue(); };
    // (do not return the request: run() would replace its onsuccess handler)
  });
}
/** Delete all generated chunk audio (keeps reference-voice files). */
export function clearChunkAudio() {
  return run('audio', 'readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return; if (c.value.kind === 'chunk') c.delete(); c.continue(); };
  });
}
/** { bytes, count } of everything in the audio store. */
export function audioUsage() {
  return run('audio', 'readonly', (s) => {
    const out = { bytes: 0, count: 0 };
    const req = s.openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return; out.bytes += c.value.size || 0; out.count++; c.continue(); };
    return out; // filled in by the cursor before the transaction completes
  });
}
export async function storageEstimate() {
  try { const e = await navigator.storage?.estimate?.(); return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
