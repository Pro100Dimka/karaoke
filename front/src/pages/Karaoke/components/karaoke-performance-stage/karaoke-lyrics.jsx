import { translateSaved } from "../../../../i18n/runtime";

const WORD_PATTERN = /[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu;
const MIN_LINE_HOLD_SECONDS = 1.2;

function lyricLines({ text, words }) {
  if (typeof text !== "string" || !Array.isArray(words)) return [];
  let offset = 0;
  const lines = text.split(/\r?\n/).flatMap((source) => {
    const count = [...source.matchAll(WORD_PATTERN)].length;
    const lineWords = words.slice(offset, offset + count);
    offset += count;
    return lineWords.length ? [lineWords] : [];
  });
  return offset === words.length ? lines : [];
}

function fillPercent({ start, end }, currentTime) {
  if (currentTime <= start) return 0;
  if (currentTime >= end) return 100;
  return ((currentTime - start) / (end - start)) * 100;
}

export function noteFillPercent(word, currentTime) {
  const notes = Array.isArray(word.notes)
    ? word.notes
        .map((note) => ({
          start: Math.max(Number(word.start), Number(note.start)),
          end: Math.min(Number(word.end), Number(note.end))
        }))
        .filter(
          (note) =>
            Number.isFinite(note.start) && Number.isFinite(note.end) && note.end > note.start
        )
        .sort((left, right) => left.start - right.start)
    : [];
  if (notes.length === 0) return fillPercent(word, currentTime);
  if (currentTime <= notes[0].start) return 0;
  const total = notes.reduce((sum, note) => sum + note.end - note.start, 0);
  const sung = notes.reduce((sum, note) => {
    if (currentTime <= note.start) return sum;
    return sum + Math.min(currentTime, note.end) - note.start;
  }, 0);
  return Math.max(0, Math.min(100, (sung / total) * 100));
}

export default function KaraokeLyrics({ lyricsSync, currentTime }) {
  const lines = lyricLines(lyricsSync || {});
  if (lines.length === 0) {
    return (
      <div className="karaoke-lyrics">
        <p className="text-muted">{translateSaved("Синхронизированный текст недоступен")}</p>
      </div>
    );
  }

  const started = lines.findLastIndex((line) => line[0].start <= currentTime);
  let firstVisible = started >= 0 ? started : 0;
  if (firstVisible > 0) {
    const previous = lines[firstVisible - 1];
    const previousStart = previous[0].start;
    if (currentTime < previousStart + MIN_LINE_HOLD_SECONDS) firstVisible -= 1;
  }
  const visibleLines = lines.slice(firstVisible, firstVisible + 2);

  return (
    <div className="karaoke-lyrics">
      {visibleLines.map((words, lineIndex) => (
        <div
          key={firstVisible + lineIndex}
          className={`karaoke-lyric ${lineIndex === 0 ? "karaoke-lyric-current" : "karaoke-lyric-next"}`}
        >
          {words.map((word, wordIndex) => (
            <span
              key={`${word.index}-${wordIndex}`}
              className="karaoke-lyric-word karaoke-lyric-character"
              data-end={word.end}
              data-start={word.start}
              style={{ "--character-fill": `${noteFillPercent(word, currentTime)}%` }}
            >
              {word.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
