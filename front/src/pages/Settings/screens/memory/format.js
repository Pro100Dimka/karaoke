export function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0.0 МБ";
  return `${(value / 1024 ** 2).toFixed(1)} МБ`;
}
