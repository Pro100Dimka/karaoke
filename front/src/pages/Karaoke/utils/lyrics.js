const TIME_KEYS = {
  start: ["start", "start_sec", "start_time", "begin", "from"],
  end: ["end", "end_sec", "end_time", "finish", "to"]
};

function readFiniteTime(source, keys) {
  for (const key of keys) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return null;
}

function normalizeLine(line, sourceIndex) {
  if (!line || typeof line !== "object") return null;

  const start = readFiniteTime(line, TIME_KEYS.start);
  const end = readFiniteTime(line, TIME_KEYS.end);
  if (start === null || end === null || end < start) return null;

  return {
    ...line,
    start,
    end,
    __sourceIndex: sourceIndex
  };
}

function getSafeLyrics(lyrics) {
  return (Array.isArray(lyrics) ? lyrics : [])
    .map(normalizeLine)
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.start - b.start || a.end - b.end || a.__sourceIndex - b.__sourceIndex
    );
}

export function getLyricDisplayState(lyrics, currentTime) {
  const safeLyrics = getSafeLyrics(lyrics);
  const parsedTime = Number(currentTime);
  const time = Number.isFinite(parsedTime) ? parsedTime : 0;

  let currentLineIndex = -1;
  for (let index = 0; index < safeLyrics.length; index += 1) {
    const line = safeLyrics[index];
    if (line.start > time) break;
    if (time < line.end) currentLineIndex = index;
  }

  const currentLine = safeLyrics[currentLineIndex] || null;
  const upcomingLineIndex = safeLyrics.findIndex((line) => line.start > time);
  const upcomingLine = safeLyrics[upcomingLineIndex] || null;
  const primaryLineIndex = currentLine ? currentLineIndex : upcomingLineIndex;
  const nextLine =
    primaryLineIndex >= 0 ? safeLyrics[primaryLineIndex + 1] || null : null;

  return { currentLineIndex, currentLine, upcomingLine, nextLine };
}

export function getLyricFill(currentTime, start, end) {
  const safeCurrent = Number(currentTime);
  const safeStart = Number(start);
  const safeEnd = Number(end);

  if (
    !Number.isFinite(safeCurrent) ||
    !Number.isFinite(safeStart) ||
    !Number.isFinite(safeEnd)
  ) {
    return 0;
  }

  if (safeEnd <= safeStart) return safeCurrent >= safeEnd ? 1 : 0;

  const progress = (safeCurrent - safeStart) / (safeEnd - safeStart);
  return Math.max(0, Math.min(1, progress));
}
