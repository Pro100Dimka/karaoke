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

function intervalFillPercent({ start, end }, currentTime) {
  if (currentTime <= start) return 0;
  if (currentTime >= end) return 100;
  return ((currentTime - start) / (end - start)) * 100;
}

export function mergeAdjacentLyricsNotes(word) {
  const start = Number(word?.start);
  const end = Number(word?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const notes = (Array.isArray(word.notes) ? word.notes : [])
    .map((note) => ({
      note: Number(note.note),
      start: Math.max(start, Number(note.start)),
      end: Math.min(end, Number(note.end))
    }))
    .filter(
      (note) =>
        Number.isInteger(note.note) &&
        Number.isFinite(note.start) &&
        Number.isFinite(note.end) &&
        note.end > note.start
    )
    .sort((left, right) => left.start - right.start);

  return notes.reduce((merged, note) => {
    const previous = merged.at(-1);
    if (!previous || previous.note !== note.note) return [...merged, note];
    const gap = note.start - previous.end;
    const shorterDuration = Math.min(previous.end - previous.start, note.end - note.start);
    if (gap > shorterDuration / 2) return [...merged, note];
    previous.end = Math.max(previous.end, note.end);
    return merged;
  }, []);
}

export function lyricsNoteFillPercent(word, currentTime) {
  const notes = mergeAdjacentLyricsNotes(word);
  if (notes.length === 0) return intervalFillPercent(word, currentTime);
  return intervalFillPercent({ start: notes[0].start, end: notes.at(-1).end }, currentTime);
}
