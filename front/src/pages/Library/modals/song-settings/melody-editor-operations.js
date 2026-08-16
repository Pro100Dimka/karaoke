export const syllableIndicesForNote = (note) => {
  const raw = Array.isArray(note.syllable_indices) ? note.syllable_indices : [note.syllable_index];
  return [...new Set(raw.map(Number).filter(Number.isFinite))];
};
const appendLyricFragment = (text, fragment, sameWord) => {
  if (!text) return fragment;
  if (!fragment) return text;
  if (!sameWord) return `${text} ${fragment}`;
  const left = text.toLocaleLowerCase();
  const right = fragment.toLocaleLowerCase();
  let overlap = Math.min(fragment.length, text.length);
  while (overlap && left.slice(-overlap) !== right.slice(0, overlap)) overlap -= 1;
  return `${text}${fragment.slice(overlap)}`;
};
const linkedText = (note, syllablesByIndex, include = () => true) => {
  let text = "";
  let previousWord;
  for (const index of syllableIndicesForNote(note)) {
    if (!include(index)) continue;
    const syllable = syllablesByIndex.get(index);
    const fragment = String(syllable?.text || "");
    if (!fragment) continue;
    const word = Number(syllable?.word_index);
    text = appendLyricFragment(
      text,
      fragment,
      Number.isFinite(word) && Number.isFinite(previousWord) && word === previousWord
    );
    previousWord = word;
  }
  return text;
};
const textOf = (note, syllablesByIndex) =>
  typeof note.editor_text === "string" && note.editor_text.length
    ? note.editor_text
    : linkedText(note, syllablesByIndex);
const wordOf = (note, syllablesByIndex) => {
  if (note.word_index != null && note.word_index !== "") return Number(note.word_index);
  const idx = syllableIndicesForNote(note)[0];
  return Number.isFinite(idx) ? Number(syllablesByIndex.get(idx)?.word_index) : null;
};
const byStartEnd = (a, b) => a.start - b.start || a.end - b.end;
const byStartPitch = (a, b) => a.start - b.start || a.midi_note - b.midi_note;
const center = ({ start, end }) => start + end;
const byMidpoint = (a, b) => center(a) - center(b);
const ascending = (a, b) => a - b;
const glue = (leftText, rightText, sameWord) => {
  if (!leftText) return rightText || "";
  if (!rightText) return leftText;
  if (!sameWord) return `${leftText} ${rightText}`;

  const left = String(leftText);
  const right = String(rightText);
  const normalizedLeft = left.toLocaleLowerCase();
  const normalizedRight = right.toLocaleLowerCase();

  // A note may already contain the complete edited word. In that case simply
  // concatenating both labels produced values such as "БолБольшой".
  let overlap = right.length;
  while (overlap && normalizedLeft.slice(-overlap) !== normalizedRight.slice(0, overlap)) overlap--;
  return `${left}${right.slice(overlap)}`;
};
const combinedContent = (notes, syllablesByIndex) => {
  let editorText = "";
  let previousWord = null;
  for (const note of notes) {
    const text = textOf(note, syllablesByIndex);
    const word = wordOf(note, syllablesByIndex);
    editorText = glue(editorText, text, word != null && previousWord === word);
    if (word != null) previousWord = word;
  }
  return {
    editor_text: editorText,
    syllable_indices: [...new Set(notes.flatMap(syllableIndicesForNote))].sort(ascending)
  };
};

export function displayTextForNote(note, syllablesByIndex, labelOwnerBySyllable) {
  if (typeof note.editor_text === "string" && note.editor_text.length) return note.editor_text;
  return linkedText(
    note,
    syllablesByIndex,
    (index) => labelOwnerBySyllable.get(index) === note._id
  );
}

export const canonicalLyricProjection = (syllables) =>
  syllables
    .map((syllable, position) => ({
      index: Number(syllable.index ?? position),
      word_index: Number(syllable.word_index),
      text: String(syllable.text || ""),
      start: Number(syllable.start),
      end: Number(syllable.end)
    }))
    .filter(
      ({ index, text, start, end }) =>
        Number.isFinite(index) &&
        text.length > 0 &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
    );

export function mergeSelectedNotes(notes, selectedIds, syllablesByIndex) {
  const selected = new Set(selectedIds);
  const chosen = notes.filter((note) => selected.has(note._id)).sort(byStartEnd);
  if (chosen.length < 2) return { notes, selectedId: chosen[0]?._id || null };
  const first = chosen[0];
  const merged = {
    ...first,
    start: Math.min(...chosen.map((n) => n.start)),
    end: Math.max(...chosen.map((n) => n.end)),
    midi_note: Math.round(chosen.reduce((sum, n) => sum + n.midi_note, 0) / chosen.length),
    ...combinedContent(chosen, syllablesByIndex)
  };
  const result = [...notes.filter((note) => !selected.has(note._id)), merged].sort(byStartPitch);
  return { notes: result, selectedId: merged._id };
}

export function deleteNotesAndTransferText(notes, selectedIds, syllablesByIndex) {
  const selected = new Set(selectedIds);
  const removed = notes.filter((note) => selected.has(note._id));
  const remaining = notes.filter((note) => !selected.has(note._id)).map((note) => ({ ...note }));
  if (!removed.length || !remaining.length) return remaining;

  const transfers = new Map();
  for (const gone of removed) {
    const goneText = textOf(gone, syllablesByIndex);
    if (!goneText) continue;
    const goneCenter = center(gone);
    const target = remaining
      .map((note) => ({ note, distance: Math.abs(center(note) - goneCenter) }))
      .sort((a, b) => a.distance - b.distance || a.note.start - b.note.start)[0].note;
    const transferred = transfers.get(target);
    if (transferred) transferred.push(gone);
    else transfers.set(target, [gone]);
  }
  for (const [target, transferred] of transfers) {
    Object.assign(
      target,
      combinedContent([...transferred, target].sort(byMidpoint), syllablesByIndex)
    );
  }
  return remaining.sort(byStartPitch);
}

export function adjacentNoteId(notes, selectedIds, direction) {
  const ordered = [...notes].sort((a, b) => byStartEnd(a, b) || a.midi_note - b.midi_note);
  if (!ordered.length) return null;
  const selected = new Set(selectedIds);
  const anchorIndex =
    direction > 0
      ? ordered.findIndex((note) => selected.has(note._id))
      : (() => {
          for (let i = ordered.length - 1; i >= 0; i--) if (selected.has(ordered[i]._id)) return i;
          return -1;
        })();
  if (anchorIndex < 0) return direction > 0 ? ordered[0]._id : ordered.at(-1)._id;
  const next = Math.max(0, Math.min(ordered.length - 1, anchorIndex + (direction > 0 ? 1 : -1)));
  return ordered[next]._id;
}

export function constrainedMoveDelta(notes, movingIds, requestedDelta, duration) {
  const moving = new Set(movingIds);
  const chosen = notes.filter((note) => moving.has(note._id));
  if (!chosen.length) return 0;
  const groupStart = Math.min(...chosen.map((note) => note.start));
  const groupEnd = Math.max(...chosen.map((note) => note.end));
  let minDelta = -groupStart;
  let maxDelta = Math.max(0, duration - groupEnd);

  for (const note of notes) {
    if (note.end <= groupStart + 1e-9) minDelta = Math.max(minDelta, note.end - groupStart);
    if (note.start >= groupEnd - 1e-9) maxDelta = Math.min(maxDelta, note.start - groupEnd);
  }
  return Math.max(minDelta, Math.min(maxDelta, requestedDelta));
}

export function resizeBounds(notes, noteId, duration, minDuration = 0.03) {
  const current = notes.find((note) => note._id === noteId);
  if (!current) return null;
  let previousEnd = 0;
  let nextStart = duration;
  for (const note of notes) {
    if (note.end <= current.start + 1e-9) previousEnd = Math.max(previousEnd, note.end);
    if (note.start >= current.end - 1e-9) nextStart = Math.min(nextStart, note.start);
  }
  return {
    minStart: previousEnd,
    maxStart: current.end - minDuration,
    minEnd: current.start + minDuration,
    maxEnd: nextStart
  };
}
