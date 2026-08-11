const TIME_KEYS = {
  start: ["start", "start_sec", "start_time", "begin", "from"],
  end: ["end", "end_sec", "end_time", "finish", "to"]
};

function readFiniteTime(source, keys) {
  if (!source || typeof source !== "object") return null;

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
    .sort((a, b) => a.start - b.start || a.end - b.end || a.__sourceIndex - b.__sourceIndex);
}

export function getLyricDisplayState(lyrics, currentTime) {
  const safeLyrics = getSafeLyrics(lyrics);
  const parsedTime = Number(currentTime);
  const time = Number.isFinite(parsedTime) ? parsedTime : 0;

  // If broken source data contains overlapping lines, prefer the line that
  // started most recently. This prevents the UI from sticking to an older line.
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

export function buildLyricWordTimings(line) {
  const sourceLine = line && typeof line === "object" ? line : {};
  const parsedStart = readFiniteTime(sourceLine, TIME_KEYS.start);
  const parsedEnd = readFiniteTime(sourceLine, TIME_KEYS.end);
  const startTime = parsedStart ?? 0;
  const endTime = Math.max(startTime, parsedEnd ?? startTime);
  const duration = endTime - startTime;

  const declaredWords = Array.isArray(sourceLine.words)
    ? sourceLine.words
        .filter((word) => word && typeof word === "object")
        .map((word) => ({
          ...word,
          text: String(word.text ?? word.word ?? "").trim()
        }))
        .filter((word) => word.text)
    : [];

  const words = declaredWords.length
    ? declaredWords
    : String(sourceLine.text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((text) => ({ text }));

  if (!words.length) return [];

  const totalWeight =
    words.reduce((sum, word) => sum + Math.max(word.text.length, 1), 0) || 1;
  let passedWeight = 0;
  let previousEnd = startTime;

  return words.map((word, index) => {
    const wordWeight = Math.max(word.text.length, 1);
    const fallbackStart =
      startTime + (passedWeight / totalWeight) * duration;
    const fallbackEnd =
      startTime + ((passedWeight + wordWeight) / totalWeight) * duration;

    const rawStart = readFiniteTime(word, TIME_KEYS.start);
    const rawEnd = readFiniteTime(word, TIME_KEYS.end);

    // Clamp backend timings to the line and keep them monotonic. One malformed
    // word must never make karaoke highlighting jump backwards or outside line.
    let start = rawStart ?? fallbackStart;
    start = Math.max(startTime, Math.min(endTime, start));
    start = Math.max(previousEnd, start);

    let end = rawEnd ?? fallbackEnd;
    end = Math.max(start, Math.min(endTime, end));

    // A bad/zero-length declared interval gets the proportional fallback when
    // there is still room in the line.
    if (end <= start && endTime > start) {
      end = Math.max(start, Math.min(endTime, fallbackEnd));
    }

    // Last word is allowed to reach the line boundary exactly.
    if (index === words.length - 1 && rawEnd === null) end = endTime;

    passedWeight += wordWeight;
    previousEnd = end;

    return { ...word, start, end };
  });
}

export function getLyricFill(currentTime, start, end) {
  const safeCurrent = Number(currentTime);
  const safeStart = Number(start);
  const safeEnd = Number(end);

  if (!Number.isFinite(safeCurrent) || !Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) {
    return 0;
  }

  if (safeEnd <= safeStart) return safeCurrent >= safeEnd ? 1 : 0;

  const progress = (safeCurrent - safeStart) / (safeEnd - safeStart);
  return Math.max(0, Math.min(1, progress));
}
