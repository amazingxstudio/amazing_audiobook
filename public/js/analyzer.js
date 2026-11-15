// HOOK for a later stage: automatic dialogue / emotion / speaker detection.
// NOT implemented on purpose. The UI shows a disabled button that will call analyzeBook() later.
//
// Planned contract (so the rest of the app does not need to change):
//   analyzeBook(book) -> Promise<Array<{ chapterId, paraIndex, speaker, emotion?, control? }>>
// The caller would then write `speaker` into book.chapters[*].paras[*].s and, optionally,
// create extra voice profiles. Audio keys include the voice control text, so changed
// assignments simply trigger regeneration of the affected chunks only.
export const ANALYZER_AVAILABLE = false;
export async function analyzeBook(/* book */) {
  return null; // TODO(stage 2)
}
