import { buildLyricWordTimings, getLyricFill } from "../utils/lyrics";

export default function KaraokeLyricLine({ line, currentTime, className }) {
  const words = buildLyricWordTimings(line);

  return (
    <div className={className}>
      {words.map((word, index) => {
        const { start: wordStart, end: wordEnd } = word;
        const fill = getLyricFill(currentTime, wordStart, wordEnd);
        const characters = Array.from(word.text);
        const characterProgress = fill * characters.length;

        return (
          <span
            className="karaoke-lyric-word"
            style={{ "--lyric-fill": `${Math.round(fill * 100)}%` }}
            key={`${word.text}-${index}`}
          >
            {characters.map((character, characterIndex) => (
              <span
                className="karaoke-lyric-character"
                style={{
                  "--character-fill": `${Math.round(
                    Math.max(
                      0,
                      Math.min(1, characterProgress - characterIndex)
                    ) * 100
                  )}%`
                }}
                key={`${character}-${characterIndex}`}
              >
                {character}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
