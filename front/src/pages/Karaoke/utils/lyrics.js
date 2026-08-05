export function getLyricDisplayState(lyrics, currentTime) {
  const safeLyrics = (Array.isArray(lyrics) ? lyrics : []).filter(
    (line) => line && typeof line === "object"
  );
  const time = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
  const currentLineIndex = safeLyrics.findIndex(
    (line) => time >= line.start && time < line.end
  );
  const currentLine = safeLyrics[currentLineIndex] || null;
  const upcomingLine = safeLyrics.find((line) => line.start > time) || null;
  const nextLine = currentLine
    ? safeLyrics[currentLineIndex + 1] || null
    : null;

  return { currentLineIndex, currentLine, upcomingLine, nextLine };
}

export function buildLyricWordTimings(line) {
  const sourceLine = line && typeof line === "object" ? line : {};
  const safeStart = Number(sourceLine.start);
  const safeEnd = Number(sourceLine.end);
  const startTime = Number.isFinite(safeStart) ? safeStart : 0;
  const endTime = Number.isFinite(safeEnd)
    ? Math.max(startTime, safeEnd)
    : startTime;
  const safeLine = { ...sourceLine, start: startTime, end: endTime };
  const declaredWords = Array.isArray(safeLine.words)
    ? safeLine.words.filter(
        (word) =>
          word &&
          typeof word === "object" &&
          typeof word.text === "string" &&
          word.text.trim()
      )
    : [];
  const words = declaredWords.length
    ? declaredWords
    : String(safeLine.text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((text) => ({ text }));
  const totalWeight =
    words.reduce((sum, word) => sum + Math.max(word.text.length, 1), 0) || 1;
  let passedWeight = 0;

  return words.map((word) => {
    const wordWeight = Math.max(word.text.length, 1);
    const weight = wordWeight / totalWeight;
    const declaredStart = Number(word.start);
    const declaredEnd = Number(word.end);
    const start = Number.isFinite(declaredStart)
      ? declaredStart
      : safeLine.start +
        (passedWeight / totalWeight) * (safeLine.end - safeLine.start);
    const end =
      Number.isFinite(declaredEnd) && declaredEnd > start
        ? declaredEnd
        : start + weight * (safeLine.end - safeLine.start);

    passedWeight += wordWeight;

    return { ...word, start, end };
  });
}

export function getLyricFill(currentTime, start, end) {
  const duration = Math.max(0.01, Number(end) - Number(start));
  const progress = (Number(currentTime) - Number(start)) / duration;
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
}
