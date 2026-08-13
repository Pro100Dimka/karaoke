import { useCallback, useEffect, useRef, useState } from "react";
import { translateSaved } from "../../../../i18n/runtime";
import useKaraokePanorama from "../../hooks/useKaraokePanorama";
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
        <p className="text-muted">
          {translateSaved("Синхронизированный текст недоступен")}
        </p>
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
            {translateSaved("Песня завершена")}
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
    sceneIntroVisible,
    sceneIntro,
    songId,
    isPlaying,
    showLyrics,
    showNotes,
    notes
  } = props;
  const { activeTheme, panoramaRef } = useKaraokePanorama(songId, isPlaying);
  const sceneVideoRef = useRef(null);
  const sceneVideoTimerRef = useRef(null);
  const [sceneVideoFading, setSceneVideoFading] = useState(false);
  const sceneVideoUrl = globalThis.electronAPI?.getSceneVideoUrl?.() || "";
  const sceneSeed = String(songId || "karaoke")
    .split("")
    .reduce(
      (seed, character) => (seed * 31 + character.charCodeAt(0)) % 997,
      17
    );
  const changeSceneVideoPosition = useCallback(() => {
    const video = sceneVideoRef.current;
    if (!video) return;
    const videoDuration = Number(video.duration);
    if (Number.isFinite(videoDuration) && videoDuration > 1) {
      video.currentTime = Math.random() * Math.max(0.1, videoDuration - 0.5);
    }
    video.play().catch(() => {});
  }, []);
  const transitionSceneVideo = useCallback(() => {
    if (!sceneVideoRef.current?.duration) return;
    setSceneVideoFading(true);
    window.clearTimeout(sceneVideoTimerRef.current);
    sceneVideoTimerRef.current = window.setTimeout(() => {
      changeSceneVideoPosition();
      setSceneVideoFading(false);
    }, 180);
  }, [changeSceneVideoPosition]);
  useEffect(() => {
    transitionSceneVideo();
  }, [isPlaying, sceneVideoUrl, transitionSceneVideo]);
  useEffect(() => () => window.clearTimeout(sceneVideoTimerRef.current), []);
  return (
    <div
      className={`karaoke-performance-stage karaoke-video-stage ${isPlaying ? "is-playing" : "is-paused"}`}
    >
      {sceneVideoUrl ? (
        <video
          ref={sceneVideoRef}
          className={`karaoke-scene-video ${sceneVideoFading ? "is-switching" : ""}`}
          src={sceneVideoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={transitionSceneVideo}
          aria-hidden="true"
        />
      ) : (
        <>
          <div
            ref={panoramaRef}
            className="karaoke-panoramic-sky"
            style={{
              "--panorama-image": `url("${activeTheme.image}")`
            }}
            aria-hidden="true"
          />
          <AuroraWorld seed={sceneSeed} />
        </>
      )}

      <div
        className={`karaoke-scene-blackout ${sceneBlackout ? "is-visible" : ""}`}
        aria-hidden="true"
      />

      <div
        className={`karaoke-song-intro ${sceneIntroVisible ? "is-visible" : ""}`}
        aria-hidden={!sceneIntroVisible}
      >
        <div className="karaoke-song-intro-card">
          <span className="karaoke-song-intro-kicker">
            {translateSaved("Сейчас прозвучит")}
          </span>
          <strong>{sceneIntro?.title || translateSaved("Караоке")}</strong>
          {sceneIntro?.artist && (
            <span className="karaoke-song-intro-artist">
              {sceneIntro.artist}
            </span>
          )}
          <div className="karaoke-song-intro-meta">
            {sceneIntro?.genre && <span>{sceneIntro.genre}</span>}
            {sceneIntro?.key && <span>{sceneIntro.key}</span>}
            {sceneIntro?.tempo && <span>{sceneIntro.tempo} BPM</span>}
            {sceneIntro?.difficulty && <span>{sceneIntro.difficulty}</span>}
          </div>
        </div>
      </div>

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
