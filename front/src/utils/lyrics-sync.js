const finite = (value) => Number.isFinite(Number(value));

export function flattenLyricsNotes(lyricsSync) {
  const canonical = new Map();
  for (const [wordIndex, word] of (lyricsSync?.words ?? []).entries()) {
    for (const note of Array.isArray(word?.notes) ? word.notes : []) {
      const key = `${note.note}:${note.start}:${note.end}`;
      const overlap = Math.min(note.end, word.end) - Math.max(note.start, word.start);
      if ((canonical.get(key)?.overlap ?? -Infinity) >= overlap) continue;
      canonical.set(key, {
        overlap,
        value: {
          ...note,
          _id: `note-${key}`,
          word_index: wordIndex,
          word_start: word.start,
          word_end: word.end,
          word_text: word.text
        }
      });
    }
  }
  return [...canonical.values()].map(({ value }) => value);
}

function fillPercent(interval, currentTime) {
  const start = Number(interval?.start);
  const end = Number(interval?.end);
  const now = Number(currentTime);
  if (![start, end, now].every(Number.isFinite) || end <= start || now <= start) return 0;
  return now >= end ? 100 : ((now - start) / (end - start)) * 100;
}

export function mergeAdjacentLyricsNotes(word) {
  const start = Number(word?.start);
  const end = Number(word?.end);
  if (!finite(start) || !finite(end) || end <= start) return [];
  const notes = (Array.isArray(word?.notes) ? word.notes : [])
    .map(({ note, start: noteStart, end: noteEnd }) => ({
      note: Number(note),
      start: Math.max(start, Number(noteStart)),
      end: Math.min(end, Number(noteEnd))
    }))
    .filter(
      ({ note, start: noteStart, end: noteEnd }) =>
        Number.isInteger(note) && finite(noteStart) && finite(noteEnd) && noteEnd > noteStart
    )
    .sort((left, right) => left.start - right.start);
  return notes.reduce((merged, note) => {
    const previous = merged.at(-1);
    const maxGap = previous
      ? Math.min(previous.end - previous.start, note.end - note.start) / 2
      : -1;
    if (!previous || previous.note !== note.note || note.start - previous.end > maxGap) {
      merged.push(note);
    } else {
      previous.end = Math.max(previous.end, note.end);
    }
    return merged;
  }, []);
}

export function lyricsNoteFillPercent(word, currentTime) {
  const notes = mergeAdjacentLyricsNotes(word);
  return fillPercent(
    notes.length ? { start: notes[0].start, end: notes.at(-1).end } : word,
    currentTime
  );
}
