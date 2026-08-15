import { useCallback, useEffect, useRef } from "react";
import { playbackGain } from "../utils/data";
import { getSecondaryMediaPosition, shouldSyncMedia } from "../utils/transport";

const YOUTUBE_NO_COOKIE_ORIGIN = "https://www.youtube-nocookie.com";

export default function useKaraokeMediaSync({
  browserMonitorRef,
  currentTimeRef,
  instrumentalRef,
  isPlaying,
  keyShift,
  melodyVolume,
  microphoneEffects,
  microphoneVolume,
  musicVolume,
  onPlaybackEndedRef,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  silenceMelodyGuide,
  songId,
  speed,
  startMelodyGuide,
  updateMelodyGuide,
  videoRef,
  vocalVolume,
  vocalsRef,
  youTubeClipRef
}) {
  const lastSecondarySyncRef = useRef(0);

  const sendYouTubeCommand = useCallback(
    (func, args = []) => {
      const frame = youTubeClipRef.current;
      const target = frame?.contentWindow;
      if (!target || typeof func !== "string" || !func.trim()) return false;
      let targetOrigin = "https://www.youtube.com";
      try {
        const { origin } = new URL(frame.src, globalThis.location.href);
        if (origin === YOUTUBE_NO_COOKIE_ORIGIN) targetOrigin = origin;
      } catch {
        // Keep the trusted default origin for malformed or not-yet-set src.
      }
      target.postMessage(
        JSON.stringify({ event: "command", func: func.trim(), args }),
        targetOrigin
      );
      return true;
    },
    [youTubeClipRef]
  );

  const syncSecondaryMedia = useCallback(
    (position, force = false) => {
      [vocalsRef.current, videoRef.current].filter(Boolean).forEach((media) => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return;
        if (force || shouldSyncMedia(media.currentTime, position)) {
          try {
            media.currentTime = getSecondaryMediaPosition(position, media.duration);
          } catch {
            // Media may become unavailable while sources are being replaced.
          }
        }
      });
      if (force) sendYouTubeCommand("seekTo", [position, true]);
    },
    [sendYouTubeCommand, videoRef, vocalsRef]
  );

  useEffect(() => {
    const instrumental = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!instrumental) return undefined;

    const handleMetadata = () => {
      const nextDuration = Number(instrumental.duration);
      setDuration(Number.isFinite(nextDuration) ? Math.max(0, nextDuration) : 0);
    };
    const handleTimeUpdate = () => {
      const position = Number(instrumental.currentTime);
      if (!Number.isFinite(position) || position < 0) return;
      currentTimeRef.current = position;
      setCurrentTime(position);
    };
    const handleEnded = () => {
      if (onPlaybackEndedRef.current) {
        Promise.resolve(onPlaybackEndedRef.current()).catch(() => {});
        return;
      }
      vocals?.pause();
      videoRef.current?.pause();
      sendYouTubeCommand("pauseVideo");
      silenceMelodyGuide();
      setIsPlaying(false);
    };

    const metadataEvents = ["loadedmetadata", "durationchange"];
    metadataEvents.forEach((event) => instrumental.addEventListener(event, handleMetadata));
    instrumental.addEventListener("ended", handleEnded);
    instrumental.addEventListener("timeupdate", handleTimeUpdate);
    // The element may already have metadata before this effect subscribes.
    handleMetadata();
    return () => {
      metadataEvents.forEach((event) => instrumental.removeEventListener(event, handleMetadata));
      instrumental.removeEventListener("ended", handleEnded);
      instrumental.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [
    currentTimeRef,
    instrumentalRef,
    onPlaybackEndedRef,
    sendYouTubeCommand,
    setDuration,
    setIsPlaying,
    silenceMelodyGuide,
    songId,
    videoRef,
    vocalsRef
  ]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    let animationFrameId;
    let active = true;
    const updatePosition = () => {
      if (!active) return;
      const position = instrumentalRef.current?.currentTime;
      const numericPosition = Number(position);
      if (Number.isFinite(numericPosition) && numericPosition >= 0) {
        currentTimeRef.current = numericPosition;
        setCurrentTime(numericPosition);
        updateMelodyGuide(numericPosition);
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - lastSecondarySyncRef.current > 450) {
          syncSecondaryMedia(numericPosition);
          lastSecondarySyncRef.current = now;
        }
      }
      animationFrameId = globalThis.requestAnimationFrame(updatePosition);
    };

    if (typeof globalThis.requestAnimationFrame !== "function") return undefined;
    updatePosition();
    return () => {
      active = false;
      if (animationFrameId != null) globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [
    currentTimeRef,
    instrumentalRef,
    isPlaying,
    setCurrentTime,
    syncSecondaryMedia,
    updateMelodyGuide
  ]);

  useEffect(() => {
    if (instrumentalRef.current) instrumentalRef.current.volume = playbackGain(musicVolume);
  }, [instrumentalRef, musicVolume]);

  useEffect(() => {
    const gain = browserMonitorRef.current?.gainNode?.gain;
    const value = Number(microphoneVolume);
    if (!gain || !Number.isFinite(value)) return;
    gain.value = Math.max(0, Math.min(1, value));
  }, [browserMonitorRef, microphoneVolume]);

  useEffect(() => {
    browserMonitorRef.current?.effects?.apply?.(microphoneEffects);
  }, [browserMonitorRef, microphoneEffects]);

  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = playbackGain(vocalVolume);
  }, [vocalVolume, vocalsRef]);

  useEffect(() => {
    if (isPlaying && melodyVolume > 0) startMelodyGuide().catch(() => {});
    else silenceMelodyGuide();
  }, [isPlaying, keyShift, melodyVolume, silenceMelodyGuide, startMelodyGuide]);

  useEffect(() => {
    const normalizedSpeed = Number(speed);
    const playbackRate =
      Number.isFinite(normalizedSpeed) && normalizedSpeed > 0
        ? Math.max(0.25, Math.min(4, normalizedSpeed))
        : 1;
    // Without this filter, the guarded setter's catch preserves identical
    // behavior for null media.
    // Stryker disable next-line MethodExpression
    [instrumentalRef.current, vocalsRef.current, videoRef.current]
      .filter(Boolean)
      .forEach((media) => {
        try {
          media.playbackRate = playbackRate;
        } catch {
          // A detached media element can reject rate changes.
        }
      });
    sendYouTubeCommand("setPlaybackRate", [playbackRate]);
  }, [instrumentalRef, sendYouTubeCommand, speed, videoRef, vocalsRef]);

  return { sendYouTubeCommand, syncSecondaryMedia };
}
