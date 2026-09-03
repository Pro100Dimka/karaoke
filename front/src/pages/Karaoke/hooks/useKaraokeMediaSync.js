import { useCallback, useEffect, useRef } from "react";
import { playbackGain } from "../utils/data";
import {
  classifyDrift,
  driftCorrectedRate,
  getSecondaryMediaPosition,
  normalizePlaybackRate
} from "../utils/transport";

const REACT_SYNC_MS = 100;
const SECONDARY_SYNC_MS = 450;

export default function useKaraokeMediaSync({
  currentTimeRef,
  instrumentalRef,
  isPlaying,
  keyShift,
  melodyVolume,
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
  vocalsRef
}) {
  const lastSecondarySync = useRef(0);
  const lastReactSync = useRef(0);

  const syncSecondaryMedia = useCallback(
    (position, force = false) => {
      const baseRate = normalizePlaybackRate(speed);

      [vocalsRef.current, videoRef.current].filter(Boolean).forEach((media) => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return;

        const target = getSecondaryMediaPosition(position, media.duration);
        const drift = media.currentTime - target;
        const correction = force ? "hard" : classifyDrift(drift);

        try {
          if (correction === "hard") media.currentTime = target;
          media.playbackRate =
            correction === "soft" || correction === "strong"
              ? driftCorrectedRate(baseRate, drift, correction)
              : baseRate;
        } catch {
          // source may be replaced while syncing
        }
      });
    },
    [speed, videoRef, vocalsRef]
  );

  useEffect(() => {
    let detach;
    let cancelRetry = () => {};

    const attach = () => {
      const instrumental = instrumentalRef.current;
      if (!instrumental) {
        if (globalThis.requestAnimationFrame) {
          const frame = requestAnimationFrame(attach);
          cancelRetry = () => cancelAnimationFrame(frame);
        } else {
          const timer = setTimeout(attach, 16);
          cancelRetry = () => clearTimeout(timer);
        }
        return;
      }

      const metadata = () => {
        const value = Number(instrumental.duration);
        setDuration(Number.isFinite(value) ? Math.max(0, value) : 0);
      };
      const timeUpdate = () => {
        const value = Number(instrumental.currentTime);
        if (!Number.isFinite(value) || value < 0) return;
        currentTimeRef.current = value;
        setCurrentTime(value);
      };
      const ended = () => {
        if (onPlaybackEndedRef.current) {
          Promise.resolve(onPlaybackEndedRef.current()).catch(() => {});
          return;
        }
        vocalsRef.current?.pause();
        videoRef.current?.pause();
        silenceMelodyGuide();
        setIsPlaying(false);
      };

      ["loadedmetadata", "durationchange"].forEach((event) =>
        instrumental.addEventListener(event, metadata)
      );
      instrumental.addEventListener("ended", ended);
      instrumental.addEventListener("timeupdate", timeUpdate);
      metadata();

      detach = () => {
        ["loadedmetadata", "durationchange"].forEach((event) =>
          instrumental.removeEventListener(event, metadata)
        );
        instrumental.removeEventListener("ended", ended);
        instrumental.removeEventListener("timeupdate", timeUpdate);
      };
    };

    attach();
    return () => {
      cancelRetry();
      detach?.();
    };
  }, [
    currentTimeRef,
    instrumentalRef,
    onPlaybackEndedRef,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    silenceMelodyGuide,
    songId,
    videoRef,
    vocalsRef
  ]);

  useEffect(() => {
    if (!isPlaying || !globalThis.requestAnimationFrame) return;

    let frame;
    let active = true;
    const update = () => {
      if (!active) return;

      const position = Number(instrumentalRef.current?.currentTime);
      if (Number.isFinite(position) && position >= 0) {
        currentTimeRef.current = position;
        updateMelodyGuide(position);

        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - lastReactSync.current >= REACT_SYNC_MS) {
          setCurrentTime(position);
          lastReactSync.current = now;
        }
        if (now - lastSecondarySync.current >= SECONDARY_SYNC_MS) {
          syncSecondaryMedia(position);
          lastSecondarySync.current = now;
        }
      }

      frame = requestAnimationFrame(update);
    };

    const resync = () => {
      if (globalThis.document?.visibilityState !== "visible") return;
      const position = Number(instrumentalRef.current?.currentTime);
      if (!Number.isFinite(position) || position < 0) return;

      currentTimeRef.current = position;
      setCurrentTime(position);
      const now = globalThis.performance?.now?.() ?? Date.now();
      lastReactSync.current = now;
      lastSecondarySync.current = now;
      syncSecondaryMedia(position, true);
    };

    globalThis.document?.addEventListener?.("visibilitychange", resync);
    frame = requestAnimationFrame(update);

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      globalThis.document?.removeEventListener?.("visibilitychange", resync);
    };
  }, [currentTimeRef, instrumentalRef, isPlaying, setCurrentTime, syncSecondaryMedia, updateMelodyGuide]);

  useEffect(() => {
    if (instrumentalRef.current) instrumentalRef.current.volume = playbackGain(musicVolume);
  }, [instrumentalRef, musicVolume]);

  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = playbackGain(vocalVolume);
  }, [vocalVolume, vocalsRef]);

  useEffect(() => {
    if (isPlaying && melodyVolume > 0) Promise.resolve(startMelodyGuide()).catch(() => {});
    else silenceMelodyGuide();
  }, [isPlaying, keyShift, melodyVolume, silenceMelodyGuide, startMelodyGuide]);

  useEffect(() => {
    const rate = normalizePlaybackRate(speed);
    [instrumentalRef.current, vocalsRef.current, videoRef.current].filter(Boolean).forEach((media) => {
      try {
        media.playbackRate = rate;
      } catch {
        // detached media can reject rate changes
      }
    });
  }, [instrumentalRef, speed, videoRef, vocalsRef]);

  return { syncSecondaryMedia };
}
