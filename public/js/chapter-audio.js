// Build / download a chapter's audio from stored chunks.
import { planChapter } from './chunker.js';
import { getAudioBlob } from './store.js';
import { mergeWav, saveBlob } from './audio.js';
import { getSettings } from './settings.js';
import { AppError } from './errors.js';

/** Merge all stored chunks of a chapter into one WAV blob (all chunks must exist). */
export async function chapterWavBlob(book, chapter) {
  const { chunkSize, cfg } = getSettings();
  const plan = planChapter(book, chapter, { chunkSize, cfg });
  if (!plan.length) throw new AppError('err_empty_chapter');
  const blobs = [];
  let missing = 0;
  for (const c of plan) { const b = await getAudioBlob(c.key); if (b) blobs.push(b); else missing++; }
  if (!blobs.length) throw new AppError('err_no_audio_chunks');
  if (missing) throw new AppError('err_missing_chunks', { n: missing });
  const { blob: wav } = await mergeWav(blobs, plan.slice(0, -1).map((c) => c.pauseAfter));
  return wav;
}

/** Merge a chapter's chunks and hand the result to the browser as a download. */
export async function downloadChapterWav(book, chapter) {
  const wav = await chapterWavBlob(book, chapter);
  const idx = book.chapters.findIndex((c) => c.id === chapter.id) + 1;
  const name = `${String(idx).padStart(2, '0')} ${chapter.title}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'chapter';
  saveBlob(wav, name + '.wav');
  return wav.size;
}
