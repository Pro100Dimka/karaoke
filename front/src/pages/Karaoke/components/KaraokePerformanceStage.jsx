import AuroraWorld from "./AuroraWorld";
import KaraokeLyricLine from "./KaraokeLyricLine";
import MelodyRoll from "./MelodyRoll";

export default function KaraokePerformanceStage({
  activeTheme,
  auroraSeed,
  currentLine,
  currentTime,
  isPitchAttacking,
  isPitchDetected,
  isPlaying,
  keyShift,
  lyrics,
  nextLine,
  noteRangeMax,
  noteRangeMin,
  notes,
  panoramaRef,
  pitchRestProgress,
  showLyrics,
  showNotes,
  songTitle,
  sungMidi,
  upcomingLine
}) {
  return (
    <div
      className={`karaoke-performance-stage karaoke-aurora-stage ${isPlaying ? "is-playing" : ""}`}
    >
      <div
        ref={panoramaRef}
        className="karaoke-panoramic-sky"
        style={{ "--panorama-image": `url(${activeTheme.image})` }}
        aria-hidden="true"
      />
      <AuroraWorld seed={auroraSeed} />

      {showNotes && notes.length > 0 && (
        <MelodyRoll
          notes={notes}
          currentTime={currentTime}
          sungMidi={sungMidi}
          isPitchDetected={isPitchDetected}
          isPitchAttacking={isPitchAttacking}
          pitchRestProgress={pitchRestProgress}
          keyShift={keyShift}
          songTitle={songTitle}
          noteRangeMin={noteRangeMin}
          noteRangeMax={noteRangeMax}
        />
      )}

      {showLyrics && (
        <div className="karaoke-lyrics">
          {lyrics.length === 0 && (
            <p className="text-muted">Синхронизированный текст недоступен</p>
          )}
          {currentLine ? (
            <KaraokeLyricLine
              key={`${currentLine.start}-${currentLine.text}`}
              line={currentLine}
              currentTime={currentTime}
              className="karaoke-lyric karaoke-lyric-current"
            />
          ) : upcomingLine ? (
            <KaraokeLyricLine
              key={`${upcomingLine.start}-${upcomingLine.text}`}
              line={upcomingLine}
              currentTime={currentTime}
              className="karaoke-lyric karaoke-lyric-current karaoke-lyric-upcoming"
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
      )}
    </div>
  );
}
