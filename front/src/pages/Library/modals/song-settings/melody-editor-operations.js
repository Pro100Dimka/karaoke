const byStart = (left, right) => left.start - right.start || left.note - right.note;

export const canonicalLyricProjection = (words) =>
  (words || []).map((word, index) => ({
    index,
    text: String(word.text || ""),
    start: Number(word.start),
    end: Number(word.end)
  }));

export function mergeSelectedNotes(notes, selectedIds) {
  const selected = new Set(selectedIds);
  const chosen = notes.filter((note) => selected.has(note._id)).sort(byStart);
  if (chosen.length < 2 || chosen.some((note) => note.word_index !== chosen[0].word_index)) {
    return { notes, selectedId: chosen[0]?._id || null };
  }
  const merged = {
    ...chosen[0],
    start: Math.min(...chosen.map((note) => note.start)),
    end: Math.max(...chosen.map((note) => note.end)),
    note: Math.round(chosen.reduce((sum, item) => sum + item.note, 0) / chosen.length)
  };
  return {
    notes: [...notes.filter((note) => !selected.has(note._id)), merged].sort(byStart),
    selectedId: merged._id
  };
}

export function deleteNotes(notes, selectedIds) {
  const selected = new Set(selectedIds);
  return notes.filter((note) => !selected.has(note._id));
}

export function adjacentNoteId(notes, selectedIds, direction) {
  const ordered = [...notes].sort(byStart);
  if (!ordered.length) return null;
  const selected = new Set(selectedIds);
  const anchor =
    direction > 0
      ? ordered.findIndex((note) => selected.has(note._id))
      : ordered.findLastIndex((note) => selected.has(note._id));
  if (anchor < 0) return direction > 0 ? ordered[0]._id : ordered.at(-1)._id;
  return ordered[Math.max(0, Math.min(ordered.length - 1, anchor + Math.sign(direction)))]._id;
}

export function constrainedMoveDelta(notes, movingIds, requestedDelta) {
  const moving = new Set(movingIds);
  const chosen = notes.filter((note) => moving.has(note._id));
  if (!chosen.length) return 0;
  let minimum = Math.max(...chosen.map((note) => note.word_start - note.start));
  let maximum = Math.min(...chosen.map((note) => note.word_end - note.end));
  for (const current of chosen) {
    for (const neighbour of notes) {
      if (moving.has(neighbour._id) || neighbour.word_index !== current.word_index) continue;
      if (neighbour.end <= current.start)
        minimum = Math.max(minimum, neighbour.end - current.start);
      if (neighbour.start >= current.end)
        maximum = Math.min(maximum, neighbour.start - current.end);
    }
  }
  return Math.max(minimum, Math.min(maximum, requestedDelta));
}

export function resizeBounds(notes, noteId, minDuration = 0.03) {
  const current = notes.find((note) => note._id === noteId);
  if (!current) return null;
  let previousEnd = current.word_start;
  let nextStart = current.word_end;
  for (const note of notes) {
    if (note._id === noteId || note.word_index !== current.word_index) continue;
    if (note.end <= current.start) previousEnd = Math.max(previousEnd, note.end);
    if (note.start >= current.end) nextStart = Math.min(nextStart, note.start);
  }
  return {
    minStart: previousEnd,
    maxStart: current.end - minDuration,
    minEnd: current.start + minDuration,
    maxEnd: nextStart
  };
}
