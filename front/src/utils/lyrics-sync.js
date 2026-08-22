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
const fill = (interval, currentTime) => {
  const { start, end } = interval ?? {};
  const [from, to, now] = [start, end, currentTime].map(Number);
  if (![from, to, now].every(Number.isFinite) || to <= from || now <= from) return 0;
  return now >= to ? 100 : ((now - from) / (to - from)) * 100;
};
export function mergeAdjacentLyricsNotes(word) {
  const [start, end] = [word?.start, word?.end].map(Number);
  if (!finite(start) || !finite(end) || end <= start) return [];
  return (Array.isArray(word?.notes) ? word.notes : [])
    .map((note) => ({
      note: Number(note.note),
      start: Math.max(start, Number(note.start)),
      end: Math.min(end, Number(note.end))
    }))
    .filter(
      (note) =>
        Number.isInteger(note.note) &&
        finite(note.start) &&
        finite(note.end) &&
        note.end > note.start
    )
    .sort((a, b) => a.start - b.start)
    .reduce((merged, note) => {
      const previous = merged.at(-1);
      const gap = previous
        ? Math.min(previous.end - previous.start, note.end - note.start) / 2
        : -1;
      if (!previous || previous.note !== note.note || note.start - previous.end > gap)
        merged.push(note);
      else previous.end = Math.max(previous.end, note.end);
      return merged;
    }, []);
}
export function lyricsNoteFillPercent(word, currentTime) {
  const notes = mergeAdjacentLyricsNotes(word);
  const interval = notes.length ? { start: notes[0].start, end: notes.at(-1).end } : word;
  return fill(interval, currentTime);
}
