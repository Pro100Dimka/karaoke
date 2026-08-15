export function formatTime(seconds) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const minutes = Math.floor(Math.max(0, safeSeconds) / 60);
  const remainder = Math.floor(Math.max(0, safeSeconds) % 60);

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function midiToWesternNote(midi) {
  if (!Number.isFinite(midi)) return "—";

  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B"
  ];
  const roundedMidi = Math.round(midi);
  const note = names[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;

  return `${note}${octave}`;
}
