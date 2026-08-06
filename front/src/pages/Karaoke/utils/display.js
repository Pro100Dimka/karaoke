export function formatCompactKey(key) {
  return String(key || "—")
    .replace(/\s*(major|maj)\b/gi, "maj")
    .replace(/\s*(minor|min)\b/gi, "m")
    .replace(/\s+/g, "")
    .replace(/mmaj$/i, "maj");
}
