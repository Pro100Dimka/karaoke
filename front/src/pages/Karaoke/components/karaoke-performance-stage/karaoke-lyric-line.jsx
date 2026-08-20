import { getLyricFill } from "../../utils/lyrics";

const percent = (value) => `${value * 100}%`;

function TimedText({ text, start, end, currentTime, className }) {
  const fill = getLyricFill(currentTime, start, end);
  return (
    <span
      className={`${className} karaoke-lyric-character`}
      style={{ "--character-fill": percent(fill) }}
    >
      {text}
    </span>
  );
}

export default function KaraokeLyricLine({ line, currentTime, className }) {
  const words = Array.isArray(line?.words) ? line.words : [];

  return (
    <div className={className}>
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
