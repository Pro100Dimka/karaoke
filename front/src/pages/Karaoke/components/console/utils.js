export { clamp } from "../../../../utils/math";

export function normalizePreset(preset) {
  return Array.isArray(preset)
    ? [preset[0], preset[1], preset[2], preset[3], preset[4], preset[5] ?? 0]
    : [preset?.id, preset?.label, preset?.symbol, preset?.echo, preset?.reverb, preset?.delay ?? 0];
}
