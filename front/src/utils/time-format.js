export function formatClockTime(seconds, { padMinutes = false } = {}) {
  const numeric = Number(seconds);
  const safe = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  const minutes = String(Math.floor(safe / 60));
  return `${padMinutes ? minutes.padStart(2, "0") : minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}
