import { useCallback, useEffect, useRef } from "react";
import { playbackGain } from "../utils/data";
import {
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../utils/transport";

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
      youTubeClipRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*"
      );
    },
    [youTubeClipRef]
  );

  const syncSecondaryMedia = useCallback(
    (position, force = false) => {
      [vocalsRef.current, videoRef.current].forEach((media) => {
        if (!media || !Number.isFinite(media.duration)) return;
        if (force || shouldSyncMedia(media.currentTime, position)) {
          media.currentTime = getSecondaryMediaPosition(
            position,
            media.duration
          );
        }
      });
      if (force) sendYouTubeCommand("seekTo", [position, true]);
    },
    [sendYouTubeCommand, videoRef, vocalsRef]
  );

  useEffect(() => {
    const instrumental = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!instrumental || !vocals) return undefined;

    const handleMetadata = () => setDuration(instrumental.duration || 0);
    const handleEnded = () => {
      vocals.pause();
      videoRef.current?.pause();
      sendYouTubeCommand("pauseVideo");
      silenceMelodyGuide();
      setIsPlaying(false);
    };

    instrumental.addEventListener("loadedmetadata", handleMetadata);
    instrumental.addEventListener("ended", handleEnded);
    return () => {
      instrumental.removeEventListener("loadedmetadata", handleMetadata);
      instrumental.removeEventListener("ended", handleEnded);
    };
  }, [
    instrumentalRef,
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
    const updatePosition = () => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position)) {
        currentTimeRef.current = position;
        setCurrentTime(position);
        updateMelodyGuide(position);
        const now = performance.now();
        if (now - lastSecondarySyncRef.current > 450) {
          syncSecondaryMedia(position);
          lastSecondarySyncRef.current = now;
        }
      }
      animationFrameId = requestAnimationFrame(updatePosition);
    };

    updatePosition();
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    currentTimeRef,
    instrumentalRef,
    isPlaying,
    setCurrentTime,
    syncSecondaryMedia,
    updateMelodyGuide
  ]);

  useEffect(() => {
    if (instrumentalRef.current) {
      instrumentalRef.current.volume = playbackGain(musicVolume);
    }
  }, [instrumentalRef, musicVolume]);

  useEffect(() => {
    if (browserMonitorRef.current) {
      browserMonitorRef.current.gainNode.gain.value = microphoneVolume;
    }
  }, [browserMonitorRef, microphoneVolume]);

  useEffect(() => {
    browserMonitorRef.current?.effects?.apply(microphoneEffects);
  }, [browserMonitorRef, microphoneEffects]);

  useEffect(() => {
    if (vocalsRef.current) {
      vocalsRef.current.volume = playbackGain(vocalVolume);
    }
  }, [vocalVolume, vocalsRef]);

  useEffect(() => {
    if (isPlaying && melodyVolume > 0) {
      startMelodyGuide().catch(() => {});
    } else {
      silenceMelodyGuide();
    }
  }, [
    isPlaying,
    keyShift,
    melodyVolume,
    silenceMelodyGuide,
    startMelodyGuide
  ]);

  useEffect(() => {
    [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
      (media) => {
        if (media) media.playbackRate = speed;
      }
    );
    sendYouTubeCommand("setPlaybackRate", [speed]);
  }, [instrumentalRef, sendYouTubeCommand, speed, videoRef, vocalsRef]);

  return { sendYouTubeCommand, syncSecondaryMedia };
}
