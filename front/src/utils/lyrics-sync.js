export function flattenLyricsNotes(lyricsSync) {
  if (!Array.isArray(lyricsSync?.words)) return [];
  const canonical = new Map();
  lyricsSync.words.forEach((word, wordIndex) => {
    (Array.isArray(word.notes) ? word.notes : []).forEach((note) => {
      const key = `${note.note}:${note.start}:${note.end}`;
      const overlap = Math.min(note.end, word.end) - Math.max(note.start, word.start);
      const current = canonical.get(key);
      if (current && current._wordOverlap >= overlap) return;
      canonical.set(key, {
        ...note,
        _id: `note-${key}`,
        _wordOverlap: overlap,
        word_index: wordIndex,
        word_start: word.start,
        word_end: word.end,
        word_text: word.text
      });
    });
  });
  return [...canonical.values()].map((item) => {
    const note = { ...item };
    delete note._wordOverlap;
    return note;
  });
}
