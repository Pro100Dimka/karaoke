export { formatClockTime as formatTime } from "../../../utils/time-format";

export function midiToWesternNote(midi) {
  if (!Number.isFinite(midi)) return "—";

  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const roundedMidi = Math.round(midi);
  const note = names[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;

  return `${note}${octave}`;
}
