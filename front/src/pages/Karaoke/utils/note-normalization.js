export function normalizeNoteList(raw, resolveNamedNote) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      ...note,
      start: Number(note.start),
      end: Number(note.end),
      midi: Number(
        note.midi ??
          note.midi_note ??
          note.midiNote ??
          note.pitch ??
          resolveNamedNote?.(note.note)
      ),
      wordIndex: Number.isInteger(Number(note.word_index ?? note.wordIndex))
        ? Number(note.word_index ?? note.wordIndex)
        : null,
      syllableIndex: Number.isInteger(
        Number(note.syllable_index ?? note.syllableIndex)
      )
        ? Number(note.syllable_index ?? note.syllableIndex)
        : null
    }))
    .filter(
      (note) =>
        Number.isFinite(note.start) &&
        note.start >= 0 &&
        Number.isFinite(note.end) &&
        note.end > note.start &&
        Number.isFinite(note.midi) &&
        note.midi >= 0 &&
        note.midi <= 127
    )
    .sort((a, b) => a.start - b.start || a.end - b.end || a.midi - b.midi);
}
