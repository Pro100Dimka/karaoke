import { getLyricFill } from "../../utils/lyrics";

const percent = (value) => `${Math.round(value * 100)}%`;
const clamp = (value) => Math.max(0, Math.min(1, value));

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
          style={{ "--character-fill": percent(clamp(progress - index)) }}
        >
          {character}
        </span>
      ))}
    </span>
  );
}

function KaraokeWord({ word, currentTime }) {
  const syllables = Array.isArray(word?.syllables) ? word.syllables : [];

  if (!syllables.length) {
    return (
      <TimedText
        text={word?.text || word?.word || ""}
        start={word?.start}
        end={word?.end}
        currentTime={currentTime}
        className="karaoke-lyric-word"
      />
    );
  }

  const wordText = String(word?.text || word?.word || "");
  const joined = syllables.map((item) => String(item?.text || "")).join("");
  const suffix = wordText.startsWith(joined) ? wordText.slice(joined.length) : "";

  return (
    <span className="karaoke-lyric-word">
      {syllables.map((syllable, index) => (
        <TimedText
          key={`syllable-${syllable.index ?? index}`}
          text={`${syllable.text || ""}${index === syllables.length - 1 ? suffix : ""}`}
          start={syllable.start}
          end={syllable.end}
          currentTime={currentTime}
          className="karaoke-lyric-syllable"
        />
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
      {words.length ? (
        words.map((word, index) => (
          <KaraokeWord
            key={`${word.index ?? index}-${word.text ?? word.word ?? ""}`}
            word={word}
            currentTime={currentTime}
          />
        ))
      ) : (
        <TimedText
          text={line?.text || ""}
          start={line?.start}
          end={line?.end}
          currentTime={currentTime}
          className="karaoke-lyric-word"
        />
      )}
    </div>
  );
}
