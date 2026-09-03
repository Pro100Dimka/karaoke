/* eslint-disable default-param-last */
import { clamp } from "../../../../utils/math";

export const PIANO_ROLL_VIEW = {
  width: 1200,
  height: 288,
  keyboardRatio: 86 / 1200,
  seconds: 10,
  lead: 2.5
};

const {
  width: WIDTH,
  height: HEIGHT,
  keyboardRatio: KEYBOARD,
  seconds: SECONDS,
  lead: LEAD
} = PIANO_ROLL_VIEW;

export function normalizePianoNotes(notes = [], shift = 0) {
  const result = [];
  const offset = Number(shift);

  notes.forEach((source, index) => {
    if (!source) return;

    const note = Number(source.note) + offset;
    const start = Number(source.start);
    const end = Number(source.end);

    if (![note, start, end].every(Number.isFinite) || end <= start) return;

    result.push({
      ...source,
      key: source._id || `${start}-${end}-${note}-${index}`,
      note,
      start,
      end
    });
  });

  return result;
}

export function pianoPitchRange(notes = [], sungMidi) {
  let min = Infinity;
  let max = -Infinity;

  for (const item of notes) {
    const note = item?.note;
    if (!Number.isFinite(note)) continue;

    if (note < min) min = note;
    if (note > max) max = note;
  }

  if (min === Infinity) {
    min = Number.isFinite(sungMidi) ? sungMidi : 60;
    max = min;
  }

  return {
    min: clamp(Math.floor(min) - 2, 0, 127),
    max: clamp(Math.ceil(max) + 2, 0, 127)
  };
}

export function pianoRollFrame(
  notes = [],
  currentTime = 0,
  size = PIANO_ROLL_VIEW,
  range = pianoPitchRange(notes)
) {
  const time = Number(currentTime) || 0;
  const start = Math.max(0, time - LEAD);
  const end = start + SECONDS;
  const { min, max } = range;
  const width = size.width || WIDTH;
  const height = size.height || HEIGHT;
  const keyboard = width * KEYBOARD;
  const lane = width - keyboard;
  const rowHeight = height / (max - min + 1);

  const x = (value) => keyboard + ((value - start) / SECONDS) * lane;
  const y = (note) => height - (note - min + 1) * rowHeight;

  const visible = notes
    .filter((note) => note?.end >= start && note.start <= end)
    .map((note) => ({
      ...note,
      left: Math.max(keyboard, x(note.start)),
      right: Math.min(width, x(note.end)),
      state: time < note.start ? "future" : time < note.end ? "current" : "past"
    }));

  const connections = [];

  for (let i = 1; i < visible.length; i++) {
    const previous = visible[i - 1];
    const note = visible[i];
    const gap = note.start - previous.end;

    if (gap > 0.04) continue;

    const overlap = clamp(previous.right - note.left, 4, 18);
    const touching = gap <= 0;

    connections.push({
      fromX: touching ? note.left : previous.right,
      fromY: y(previous.note) + rowHeight / 2,
      toX: touching ? note.left + overlap : note.left,
      toY: y(note.note) + rowHeight / 2,
      state: note.state
    });
  }

  return {
    start,
    end,
    time,
    width,
    height,
    keyboard,
    lane,
    rowHeight,
    min,
    max,
    playhead: x(time),
    x,
    y,
    connections,
    notes: visible
  };
}
