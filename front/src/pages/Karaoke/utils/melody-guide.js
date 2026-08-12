const A4_MIDI = 69;
const A4_FREQUENCY = 440;

export function midiToFrequency(midi) {
  const value = Number(midi);
  if (!Number.isFinite(value)) return null;
  return A4_FREQUENCY * 2 ** ((value - A4_MIDI) / 12);
}

export function findActiveMelodyNote(notes, position) {
  const time = Number(position);
  if (!Array.isArray(notes) || !Number.isFinite(time)) return null;
  return (
    notes.find(
      (note) =>
        Number.isFinite(Number(note?.start)) &&
        Number.isFinite(Number(note?.end)) &&
        time >= Number(note.start) &&
        time < Number(note.end)
    ) || null
  );
}

export function getMelodyGuideState({
  notes,
  position,
  keyShift = 0,
  volume = 0
}) {
  const safeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
  const note = findActiveMelodyNote(notes, position);
  if (!note || safeVolume <= 0) {
    return { active: false, note: null, frequency: null, gain: 0.0001 };
  }

  const midi = Number(note.midi) + (Number(keyShift) || 0);
  const frequency = midiToFrequency(midi);
  if (!Number.isFinite(frequency)) {
    return { active: false, note: null, frequency: null, gain: 0.0001 };
  }

  return {
    active: true,
    note,
    frequency,
    gain: 0.3 * safeVolume ** 1.65
  };
}
