import { buildLyricWordTimings, getLyricFill } from "../../utils/lyrics";

const percent = (value) => `${Math.round(value * 100)}%`;
const clamp = (value) => Math.max(0, Math.min(1, value));

function LyricWord({ word, currentTime }) {
  const fill = getLyricFill(currentTime, word.start, word.end);
  const characters = Array.from(word.text);
  const progress = fill * characters.length;
  return (
    <span
      className="karaoke-lyric-word"
      style={{ "--lyric-fill": percent(fill) }}
    >
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="karaoke-lyric-character"
          style={{ "--character-fill": percent(clamp(progress - index)) }}
        >
          {character}
        </span>
      ))}
    </span>
  );
}

export default function KaraokeLyricLine({ line, currentTime, className }) {
  return (
    <div className={className}>
      {buildLyricWordTimings(line).map((word, index) => (
        <LyricWord
          key={`${word.text}-${index}`}
          word={word}
          currentTime={currentTime}
        />
      ))}
    </div>
  );
}
