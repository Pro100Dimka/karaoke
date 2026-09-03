export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export const normalizePreset = (preset) =>
  Array.isArray(preset)
    ? preset
    : [preset.id, preset.label, preset.symbol, preset.echo, preset.reverb, preset.delay];

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function noteRangeLabel(value, fallback, shift = 0) {
  if (value == null || value === "") return fallback;

  const midi = Number(value);
  if (!Number.isFinite(midi)) return String(value);

  const note = clamp(Math.round(midi) + (Number(shift) || 0), 0, 127);
  return `${NOTES[note % 12]}${Math.floor(note / 12) - 1}`;
}
