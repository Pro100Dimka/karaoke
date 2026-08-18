export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const clamp01 = (value) => clamp(value, 0, 1);
