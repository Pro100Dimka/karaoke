export const START_TIME_KEYS = ["start", "start_sec", "start_time", "begin", "from"];
export const END_TIME_KEYS = ["end", "end_sec", "end_time", "finish", "to"];

export function readFiniteTime(source, ...keys) {
  for (const key of keys) {
    const raw = source[key];
    if ([null, ""].includes(raw)) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return null;
}
