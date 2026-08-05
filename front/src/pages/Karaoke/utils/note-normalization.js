export function normalizeNoteList(raw, resolveNamedNote = () => NaN) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      start: Number(note.start),
      end: Number(note.end),
      midi: Number(note.midi ?? note.pitch ?? resolveNamedNote(note.note))
    }))
    .filter(
      (note) =>
        Number.isFinite(note.start) &&
        Number.isFinite(note.end) &&
        note.end >= note.start &&
        Number.isFinite(note.midi)
    );
}
