import AuroraWorld from "./aurora-world";
import KaraokeLyricLine from "./karaoke-lyric-line";
import MelodyRoll from "./melody-roll";

function Lyrics({ lyrics, currentLine, upcomingLine, nextLine, currentTime }) {
  const activeLine = currentLine || upcomingLine;
  const activeClassName = [
    "karaoke-lyric karaoke-lyric-current",
    !currentLine && upcomingLine ? "karaoke-lyric-upcoming" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="karaoke-lyrics">
      {!lyrics.length && (
        <p className="text-muted">Синхронизированный текст недоступен</p>
      )}

      {activeLine ? (
        <KaraokeLyricLine
          key={`${activeLine.start}-${activeLine.text}`}
          line={activeLine}
          currentTime={currentTime}
          className={activeClassName}
        />
      ) : (
        lyrics.length > 0 && (
          <div className="karaoke-lyric karaoke-lyric-current">
            Песня завершена
          </div>
        )
      )}

      {nextLine && (
        <KaraokeLyricLine
          line={nextLine}
          currentTime={currentTime}
          className="karaoke-lyric karaoke-lyric-next"
        />
      )}
    </div>
  );
}

export default function KaraokePerformanceStage(props) {
  const {
    activeTheme,
    auroraSeed,
    currentTime,
    isPlaying,
    lyrics,
    notes,
    panoramaRef,
    showLyrics,
    showNotes
  } = props;

  return (
    <div
      className={`karaoke-performance-stage karaoke-aurora-stage ${
        isPlaying ? "is-playing" : ""
      }`}
    >
      <div
        ref={panoramaRef}
        className="karaoke-panoramic-sky"
        style={{ "--panorama-image": `url(${activeTheme.image})` }}
        aria-hidden="true"
      />
      <AuroraWorld seed={auroraSeed} />

      {showNotes && notes.length > 0 && <MelodyRoll {...props} />}
      {showLyrics && (
        <Lyrics {...props} lyrics={lyrics} currentTime={currentTime} />
      )}
    </div>
  );
}
