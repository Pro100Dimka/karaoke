import { clamp } from "../../../../../utils/math";

export const PIANO_ROLL_VIEW = {
  width: 1200,
  height: 288,
  keyboardRatio: 86 / 1200,
  seconds: 10,
  lead: 2.5
};

export function normalizePianoNotes(notes = [], shift = 0) {
  return notes.flatMap((source, index) => {
    const note = Number(source.note) + shift;
    const start = Number(source.start);
    const end = Number(source.end);
    return Number.isFinite(note) && Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ ...source, key: source._id || `${start}-${end}-${note}-${index}`, note, start, end }]
      : [];
  });
}

export function pianoPitchRange(notes, sungMidi) {
  const pitches = notes.map(({ note }) => note).filter(Number.isFinite);
  if (!pitches.length && Number.isFinite(sungMidi)) pitches.push(sungMidi);
  if (!pitches.length) pitches.push(60);
  return {
    min: clamp(Math.floor(Math.min(...pitches)) - 2, 0, 127),
    max: clamp(Math.ceil(Math.max(...pitches)) + 2, 0, 127)
  };
}

// pitchRange ({ min, max }, from pianoPitchRange) is a caller-supplied
// argument rather than computed here because this runs on every animation
// frame while playing (both the canvas-2d and Pixi draw loops call it up to
// ~60 times a second) -- recomputing a full min/max scan over every note in
// the song on each of those frames was pure waste when only `currentTime`
// actually changes frame to frame. Callers memoize pitchRange themselves,
// keyed on the (much more rarely changing) notes/sungMidi.
export function pianoRollFrame(notes, currentTime, size, pitchRange) {
  const dimensions = size || PIANO_ROLL_VIEW;
  const time = Number(currentTime) || 0;
  const start = Math.max(0, time - PIANO_ROLL_VIEW.lead);
  const end = start + PIANO_ROLL_VIEW.seconds;
  const { min, max } = pitchRange;
  const width = dimensions.width || PIANO_ROLL_VIEW.width;
  const height = dimensions.height || PIANO_ROLL_VIEW.height;
  const keyboard = width * PIANO_ROLL_VIEW.keyboardRatio;
  const lane = width - keyboard;
  const rowHeight = height / (max - min + 1);
  const x = (value) => keyboard + ((value - start) / PIANO_ROLL_VIEW.seconds) * lane;
  const y = (midi) => height - (midi - min + 1) * rowHeight;
  const visibleNotes = notes
    .filter((note) => note.end >= start && note.start <= end)
    .map((note) => ({
      ...note,
      left: Math.max(keyboard, x(note.start)),
      right: Math.min(width, x(note.end)),
      state:
        time >= note.start && time < note.end ? "current" : note.end <= time ? "past" : "future"
    }));
  const connections = visibleNotes.slice(1).flatMap((note, index) => {
    const previous = visibleNotes[index];
    const gap = note.start - previous.end;
    if (gap > 0.04) return [];
    const overlapWidth = Math.max(4, Math.min(18, previous.right - note.left));
    const fromX = gap <= 0 ? note.left : previous.right;
    const toX = gap <= 0 ? note.left + overlapWidth : note.left;
    return [
      {
        fromX,
        fromY: y(previous.note) + rowHeight / 2,
        toX,
        toY: y(note.note) + rowHeight / 2,
        state: note.state
      }
    ];
  });
  return {
    end,
    height,
    keyboard,
    lane,
    max,
    min,
    playhead: x(time),
    rowHeight,
    start,
    time,
    width,
    x,
    y,
    connections,
    notes: visibleNotes
  };
}
