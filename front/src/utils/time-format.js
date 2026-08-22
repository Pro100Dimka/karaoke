export function formatClockTime(seconds, { padMinutes = false } = {}) {
  const value = Number(seconds);
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = String(Math.floor(safe / 60));
  return `${padMinutes ? minutes.padStart(2, "0") : minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}
