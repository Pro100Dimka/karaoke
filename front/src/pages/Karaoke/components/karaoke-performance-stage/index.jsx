import { useCallback, useEffect, useRef, useState } from "react";
import SongCoverArt from "../../../../components/SongCoverArt";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Box, Card, Chip, Stack, Typography } from "../../../../theme/ui";
import * as platform from "../../../../utils/platform";
import useKaraokePanorama from "../../hooks/useKaraokePanorama";
import usePitchDetection from "../../hooks/usePitchDetection";
import AuroraWorld from "./aurora-world";
import KaraokeLyrics from "./karaoke-lyrics";
import MelodyRoll from "./melody-roll";

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
  monitoringEnabled,
  getLocalVoiceStream,
  hasSongClip = false,
  showLyrics,
  showNotes,
  notes = []
}) {
  const { activeTheme, panoramaRef } = useKaraokePanorama(songId, isPlaying);
  // Pitch detection publishes React state on every voiced/rest transition
  // (and while singing, up to ~66 times a second to animate the pursued
  // note). Calling the hook here instead of in Karaoke/index.jsx keeps that
  // churn scoped to this stage -- the console, transport controls and
  // hotkeys wiring above no longer re-render on every pitch sample.
  const { sungMidi, isPitchDetected } = usePitchDetection({
    isPlaying,
    monitorInputDeviceId,
    monitoringEnabled,
    getLocalVoiceStream
  });
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const [switching, setSwitching] = useState(false);
  const sceneVideo = platform.mediaUrl();
  const jump = useCallback(() => {
    const video = videoRef.current;
    if (video?.duration > 1)
      video.currentTime = Math.random() * Math.max(0.1, video.duration - 0.5);
    Promise.resolve(video?.play()).catch(() => {});
  }, []);
  const transition = useCallback(() => {
    if (!videoRef.current?.duration) return;
    setSwitching(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      jump();
      setSwitching(false);
    }, 180);
  }, [jump]);
  useEffect(() => {
    transition();
  }, [isPlaying, sceneVideo, transition]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const seed = [...String(songId || "karaoke")].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 997,
    17
  );
  return (
    <Box
      as="section"
      data-role="performance-stage"
      data-playing={isPlaying || undefined}
      sx={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: hasSongClip ? "transparent" : "var(--color-bg-deep)"
      }}
    >
      {!hasSongClip && sceneVideo ? (
        <Box
          as="video"
          ref={videoRef}
          data-switching={switching || undefined}
          src={sceneVideo}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={transition}
          aria-hidden="true"
          sx={{
            position: "absolute",
            inset: 0,
            inlineSize: "100%",
            blockSize: "100%",
            objectFit: "cover",
            opacity: switching ? 0 : 1,
            transition: "opacity var(--motion-duration-normal) var(--motion-easing-standard)"
          }}
        />
      ) : !hasSongClip ? (
        <>
          <Box
            ref={panoramaRef}
            data-role="panorama"
            aria-hidden="true"
            sx={{
              position: "absolute",
              inset: 0,
              backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--color-bg-deep) 8%, transparent), var(--color-bg-deep)), url("${activeTheme.image}")`,
              backgroundPosition: "calc(50% + var(--panorama-x, 0px)) var(--panorama-y, 50%)",
              backgroundSize: "cover"
            }}
          />
          <AuroraWorld seed={seed} />
        </>
      ) : null}
      {showNotes && notes.length > 0 && (
        <MelodyRoll
          notes={notes}
          currentTime={currentTime}
          currentTimeRef={currentTimeRef}
          isPlaying={isPlaying}
          isPitchDetected={isPitchDetected}
          keyShift={keyShift}
          sungMidi={sungMidi}
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
        aria-hidden="true"
        data-role="scene-blackout"
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 8,
          background: "var(--color-bg-deep)",
          opacity: sceneBlackout ? 1 : 0,
          pointerEvents: sceneBlackout ? "auto" : "none",
          transition: "opacity var(--motion-duration-slow) var(--motion-easing-standard)"
        }}
      />
      <Stack
        aria-hidden={!sceneIntroVisible}
        align="center"
        justify="center"
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 9,
          opacity: sceneIntroVisible ? 1 : 0,
          pointerEvents: "none",
          transform: sceneIntroVisible ? "none" : "scale(.98)",
          transition:
            "opacity var(--motion-duration-slow) var(--motion-easing-standard), transform var(--motion-duration-slow) var(--motion-easing-spring)"
        }}
      >
        <Card variant="laser" tilt={false}>
          <Stack direction="row">
            {songId && <SongCoverArt song={{ id: songId }} sx={{ flex: 1 }} />}
            <Stack align="center" justify="space-between" py="var(--space-8)" sx={{ flex: 4 }}>
              <Typography variant="h6" tone="muted">
                {t("karaoke.nowItWillSound")}
              </Typography>
              <Typography variant="h2">{sceneIntro?.title || t("karaoke.karaoke")}</Typography>
              {sceneIntro?.artist && (
                <Typography variant="h5" tone="muted">
                  {sceneIntro.artist}
                </Typography>
              )}
              <Stack direction="row" justify="center" wrap gap="var(--space-2)">
                {[
                  sceneIntro?.genre,
                  sceneIntro?.key,
                  sceneIntro?.tempo && t("common.bpm", { 0: sceneIntro.tempo }),
                  sceneIntro?.difficulty
                ]
                  .filter(Boolean)
                  .map((value) => (
                    <Chip key={value} size="lg">
                      {value}
                    </Chip>
                  ))}
              </Stack>
            </Stack>
          </Stack>
        </Card>
      </Stack>
    </Box>
  );
}
