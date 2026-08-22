export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export const normalizePreset = (preset) =>
  Array.isArray(preset)
    ? preset
    : [preset.id, preset.label, preset.symbol, preset.echo, preset.reverb, preset.delay];
