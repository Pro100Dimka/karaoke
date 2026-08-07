import KaraokeLyricLine from "./karaoke-lyric-line";
import MelodyRoll from "./melody-roll";

const SCENE_VIDEO_URL = new URL(
  "../../../../assets/karaoke/videoplayback.mp4",
  import.meta.url
).href;

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
    currentTime,
    lyrics,
    nextLine,
    sceneBlackout,
    sceneVideoRef,
    showLyrics,
    showNotes,
    notes,
    onSceneVideoReady
  } = props;

  return (
    <div className="karaoke-performance-stage karaoke-video-stage">
      <video
        ref={sceneVideoRef}
        className="karaoke-scene-video"
        src={SCENE_VIDEO_URL}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={onSceneVideoReady}
        aria-hidden="true"
      />

      <div
        className={`karaoke-scene-blackout ${sceneBlackout ? "is-visible" : ""}`}
        aria-hidden="true"
      />

      {showNotes && notes.length > 0 && <MelodyRoll {...props} />}
      {showLyrics && (
        <Lyrics
          {...props}
          lyrics={lyrics}
          currentTime={currentTime}
          nextLine={nextLine}
        />
      )}
    </div>
  );
}
