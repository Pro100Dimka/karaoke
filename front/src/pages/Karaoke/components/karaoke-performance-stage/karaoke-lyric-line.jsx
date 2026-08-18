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
  const matchIndex = wordText.indexOf(joined);

  // Syllables are expected to reconstruct the word exactly. When they don't
  // (e.g. leading punctuation such as an em dash/quote stripped only on the
  // backend's syllable splitter, or a genuinely mismatched split), never drop
  // the mismatched characters from the screen: a word that is actively being
  // sung must not silently vanish. Fall back to word-level highlighting,
  // which stays correct even though it loses per-syllable granularity.
  if (matchIndex === -1) {
    return (
      <TimedText
        text={wordText}
        start={word?.start}
        end={word?.end}
        currentTime={currentTime}
        className="karaoke-lyric-word"
      />
    );
  }

  const prefix = wordText.slice(0, matchIndex);
  const suffix = wordText.slice(matchIndex + joined.length);

  return (
    <span className="karaoke-lyric-word">
      {prefix && (
        <TimedText
          text={prefix}
          start={word?.start}
          end={syllables[0]?.start ?? word?.start}
          currentTime={currentTime}
          className="karaoke-lyric-syllable"
        />
      )}
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
