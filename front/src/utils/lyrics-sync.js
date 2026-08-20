export function flattenLyricsNotes(lyricsSync) {
  if (!Array.isArray(lyricsSync?.words)) return [];
  return lyricsSync.words.flatMap((word, wordIndex) =>
    (Array.isArray(word.notes) ? word.notes : []).map((note, noteIndex) => ({
      ...note,
      _id: `word-${wordIndex}-note-${noteIndex}`,
      word_index: wordIndex,
      word_start: word.start,
      word_end: word.end,
      word_text: word.text
    }))
  );
}
