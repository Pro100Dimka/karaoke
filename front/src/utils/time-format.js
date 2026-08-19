export function formatClockTime(seconds, { padMinutes = false } = {}) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const minutes = Math.floor(Math.max(0, safeSeconds) / 60);
  const remainder = Math.floor(Math.max(0, safeSeconds) % 60);
  const minutesText = padMinutes ? String(minutes).padStart(2, "0") : String(minutes);

  return `${minutesText}:${String(remainder).padStart(2, "0")}`;
}
