import { clamp01 } from "../../../../utils/math";
import { getLyricFill } from "../../utils/lyrics";

const percent = (value) => `${Math.round(value * 100)}%`;

function TimedText({ text, start, end, currentTime, className }) {
  const fill = getLyricFill(currentTime, start, end);
  const characters = Array.from(text || "");
  const progress = fill * characters.length;

  return (
    <span className={className} style={{ "--lyric-fill": percent(fill) }}>
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="karaoke-lyric-character"
          style={{ "--character-fill": percent(clamp01(progress - index)) }}
        >
          {character}
        </span>
      ))}
    </span>
  );
}

export default function KaraokeLyricLine({ line, currentTime, className }) {
  const words = Array.isArray(line?.words) ? line.words : [];
  const textLength = Array.from(line?.text || "").length;
  const scale = Math.max(0.48, Math.min(1, 28 / Math.max(28, textLength)));

  return (
    <div className={className} style={{ "--lyric-line-scale": scale }}>
      {words.map((word, index) => (
        <TimedText
          key={`${word.index ?? index}-${word.text}`}
          text={word.text}
          start={word.start}
          end={word.end}
          currentTime={currentTime}
          className="karaoke-lyric-word"
        />
      ))}
    </div>
  );
}
