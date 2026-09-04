import { Box } from "../../../theme/ui";
import * as platform from "../../../utils/platform";
import SceneIntro from "./intro";
import KaraokeLyrics from "./karaoke-lyrics";
import PianoRoll from "./piano-roll";
import usePitchDetection from "./usePitchDetection";
import SceneVideo from "./video";

export default function KaraokePerformanceStage({
  currentTime,
  currentTimeRef,
  lyricsSync,
  sceneBlackout,
  sceneIntroVisible,
  sceneIntro,
  songId,
  isPlaying,
  keyShift,
  monitorInputDeviceId,
  getLocalVoiceStream,
  hasSongClip = false,
  showLyrics,
  showNotes,
  notes = []
}) {
  const pitch = usePitchDetection({
    isPlaying: isPlaying && showNotes && notes.length > 0,
    monitorInputDeviceId,
    getLocalVoiceStream
  });

  const sceneVideo = !hasSongClip && platform.mediaUrl();

  return (
    <Box
      as="section"
      data-role="performance-stage"
      data-playing={isPlaying || undefined}
      sx={{
        position: "absolute",
        inset: 0,
        overflow: "hidden"
        // background: hasSongClip ? "transparent" : "var(--color-bg-deep)"
      }}
    >
      {sceneVideo && <SceneVideo src={sceneVideo} isPlaying={isPlaying} />}

      {showNotes && !!notes.length && (
        <PianoRoll
          notes={notes}
          currentTime={currentTime}
          currentTimeRef={currentTimeRef}
          isPlaying={isPlaying}
          keyShift={keyShift}
          {...pitch}
        />
      )}

      {showLyrics && (
        <KaraokeLyrics
          lyricsSync={lyricsSync}
          currentTime={currentTime}
          currentTimeRef={currentTimeRef}
          isPlaying={isPlaying}
        />
      )}

      <Box
        aria-hidden
        data-role="scene-blackout"
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 8,
          background: "var(--color-bg-deep)",
          opacity: +sceneBlackout,
          pointerEvents: sceneBlackout ? "auto" : "none",
          transition: "opacity var(--motion-duration-slow) var(--motion-easing-standard)"
        }}
      />

      <SceneIntro visible={sceneIntroVisible} songId={songId} scene={sceneIntro} />
    </Box>
  );
}
