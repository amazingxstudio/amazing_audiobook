// Book record factory + voice helpers (shared by import, library and book screens).
import { uid } from './store.js';

export const NARRATOR_ID = 'narrator';
export const newVoice = (over = {}) => ({ id: uid(), name: '', control: '', refName: '', speedNote: '', ...over });

export function newBook(title, chapters, meta = {}) {
  return {
    id: uid(), title, createdAt: Date.now(), updatedAt: Date.now(), meta,
    chapters,
    // The built-in narrator has an empty name; the UI shows a translated label for it until it is renamed.
    voices: [{ id: NARRATOR_ID, name: '', control: '', refName: '', speedNote: '', builtin: true }],
  };
}
