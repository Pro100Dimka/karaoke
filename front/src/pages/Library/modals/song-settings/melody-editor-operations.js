const textOf = (note, syllablesByIndex) => {
  if (typeof note.editor_text === "string" && note.editor_text.length)
    return note.editor_text;
  const idx = Number(note.syllable_index);
  return Number.isFinite(idx)
    ? String(syllablesByIndex.get(idx)?.text || "")
    : "";
};
const wordOf = (note, syllablesByIndex) => {
  if (note.word_index != null && note.word_index !== "")
    return Number(note.word_index);
  const idx = Number(note.syllable_index);
  return Number.isFinite(idx)
    ? Number(syllablesByIndex.get(idx)?.word_index)
    : null;
};
const sourceIndices = (note) => {
  const raw = Array.isArray(note.syllable_indices)
    ? note.syllable_indices
    : [note.syllable_index];
  return [...new Set(raw.map(Number).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
};
const glue = (leftText, rightText, sameWord) => {
  if (!leftText) return rightText || "";
  if (!rightText) return leftText;
  return sameWord ? `${leftText}${rightText}` : `${leftText} ${rightText}`;
};

export function displayTextForNote(
  note,
  syllablesByIndex,
  labelOwnerBySyllable
) {
  if (typeof note.editor_text === "string" && note.editor_text.length)
    return note.editor_text;
  const idx = Number(note.syllable_index);
  if (!Number.isFinite(idx) || labelOwnerBySyllable.get(idx) !== note._id)
    return "";
  return String(syllablesByIndex.get(idx)?.text || "");
}

export function mergeSelectedNotes(notes, selectedIds, syllablesByIndex) {
  const selected = new Set(selectedIds);
  const chosen = notes
    .filter((note) => selected.has(note._id))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (chosen.length < 2) return { notes, selectedId: chosen[0]?._id || null };
  const first = chosen[0];
  let combinedText = "";
  let previousWord = null;
  for (const note of chosen) {
    const text = textOf(note, syllablesByIndex);
    const word = wordOf(note, syllablesByIndex);
    combinedText = glue(
      combinedText,
      text,
      previousWord != null && word != null && previousWord === word
    );
    if (word != null) previousWord = word;
  }
  const merged = {
    ...first,
    start: Math.min(...chosen.map((n) => n.start)),
    end: Math.max(...chosen.map((n) => n.end)),
    midi_note: Math.round(
      chosen.reduce((sum, n) => sum + n.midi_note, 0) / chosen.length
    ),
    editor_text: combinedText,
    syllable_indices: [...new Set(chosen.flatMap(sourceIndices))].sort(
      (a, b) => a - b
    )
  };
  const result = [
    ...notes.filter((note) => !selected.has(note._id)),
    merged
  ].sort((a, b) => a.start - b.start || a.midi_note - b.midi_note);
  return { notes: result, selectedId: merged._id };
}

export function deleteNotesAndTransferText(
  notes,
  selectedIds,
  syllablesByIndex
) {
  const selected = new Set(selectedIds);
  const removed = notes
    .filter((note) => selected.has(note._id))
    .sort((a, b) => a.start - b.start);
  const remaining = notes
    .filter((note) => !selected.has(note._id))
    .map((note) => ({ ...note }));
  if (!removed.length || !remaining.length) return remaining;

  for (const gone of removed) {
    const goneText = textOf(gone, syllablesByIndex);
    if (!goneText) continue;
    const goneMid = (gone.start + gone.end) / 2;
    let targetIndex = 0;
    let best = Infinity;
    remaining.forEach((note, index) => {
      const mid = (note.start + note.end) / 2;
      const distance = Math.abs(mid - goneMid);
      if (
        distance < best - 1e-9 ||
        (Math.abs(distance - best) < 1e-9 &&
          note.start < remaining[targetIndex].start)
      ) {
        best = distance;
        targetIndex = index;
      }
    });
    const target = remaining[targetIndex];
    const existing = textOf(target, syllablesByIndex);
    const goneWord = wordOf(gone, syllablesByIndex);
    const targetWord = wordOf(target, syllablesByIndex);
    const sameWord =
      goneWord != null && targetWord != null && goneWord === targetWord;
    target.editor_text =
      goneMid <= (target.start + target.end) / 2
        ? glue(goneText, existing, sameWord)
        : glue(existing, goneText, sameWord);
    target.syllable_indices = [
      ...new Set([...sourceIndices(target), ...sourceIndices(gone)])
    ].sort((a, b) => a - b);
  }
  return remaining.sort(
    (a, b) => a.start - b.start || a.midi_note - b.midi_note
  );
}

export function adjacentNoteId(notes, selectedIds, direction) {
  const ordered = [...notes].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.midi_note - b.midi_note
  );
  if (!ordered.length) return null;
  const selected = new Set(selectedIds);
  const anchorIndex =
    direction > 0
      ? ordered.findIndex((note) => selected.has(note._id))
      : (() => {
          for (let i = ordered.length - 1; i >= 0; i--)
            if (selected.has(ordered[i]._id)) return i;
          return -1;
        })();
  if (anchorIndex < 0)
    return direction > 0 ? ordered[0]._id : ordered.at(-1)._id;
  const next = Math.max(
    0,
    Math.min(ordered.length - 1, anchorIndex + (direction > 0 ? 1 : -1))
  );
  return ordered[next]._id;
}

export function constrainedMoveDelta(
  notes,
  movingIds,
  requestedDelta,
  duration
) {
  const moving = new Set(movingIds);
  const chosen = notes.filter((note) => moving.has(note._id));
  if (!chosen.length) return 0;
  const others = notes.filter((note) => !moving.has(note._id));
  const groupStart = Math.min(...chosen.map((note) => note.start));
  const groupEnd = Math.max(...chosen.map((note) => note.end));
  let minDelta = -groupStart;
  let maxDelta = Math.max(0, duration - groupEnd);

  for (const note of others) {
    if (note.end <= groupStart + 1e-9)
      minDelta = Math.max(minDelta, note.end - groupStart);
    if (note.start >= groupEnd - 1e-9)
      maxDelta = Math.min(maxDelta, note.start - groupEnd);
  }
  return Math.max(minDelta, Math.min(maxDelta, requestedDelta));
}

export function resizeBounds(notes, noteId, duration, minDuration = 0.03) {
  const current = notes.find((note) => note._id === noteId);
  if (!current) return null;
  const others = notes.filter((note) => note._id !== noteId);
  let previousEnd = 0;
  let nextStart = duration;
  for (const note of others) {
    if (note.end <= current.start + 1e-9)
      previousEnd = Math.max(previousEnd, note.end);
    if (note.start >= current.end - 1e-9)
      nextStart = Math.min(nextStart, note.start);
  }
  return {
    minStart: Math.min(current.end - minDuration, previousEnd),
    maxStart: current.end - minDuration,
    minEnd: current.start + minDuration,
    maxEnd: Math.max(current.start + minDuration, nextStart)
  };
}
