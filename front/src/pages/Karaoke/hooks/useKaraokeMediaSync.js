import { useCallback, useEffect, useRef } from "react";
import { playbackGain } from "../utils/data";
import { getSecondaryMediaPosition, shouldSyncMedia } from "../utils/transport";

const YOUTUBE_NO_COOKIE_ORIGIN = "https://www.youtube-nocookie.com";
// The rAF loop below runs at ~60fps to keep currentTimeRef and the melody
// guide frame-accurate, but nothing on screen needs React state updated that
// often: the lyrics/piano-roll overlays already read currentTimeRef directly
// in their own rAF loops (and are memoized against the currentTime prop
// while playing), and the timeline/timecode in the console is just a number
// and a progress bar -- both look identical to a viewer whether they update
// 60 times a second or 10. Throttling setCurrentTime this way keeps the
// whole Karaoke page from re-rendering (and reallocating its many derived
// prop objects/callbacks) on every single animation frame.
const REACT_SYNC_INTERVAL_MS = 100;

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
  vocalsRef,
  youTubeClipRef
}) {
  const lastSecondarySyncRef = useRef(0);
  const lastReactSyncRef = useRef(0);

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
    // Karaoke/index.jsx renders a loading placeholder instead of <KaraokeMedia>
    // until the song result finishes fetching, which can land in a render
    // *after* this effect's songId dependency already changed -- so on the
    // commit where songId first resolves, instrumentalRef.current is still
    // null, this effect bails out, and songId never changes again to trigger
    // a retry. That permanently starved duration/timeupdate listeners while
    // the unrelated rAF-driven currentTime loop kept working (it re-reads
    // instrumentalRef.current live every frame instead of capturing it once),
    // which is why the timecode text ticked up but the timeline never moved
    // or became seekable. Poll for the element instead of giving up once.
    let detachListeners;
    let cancelRetry = () => {};

    const attach = () => {
      const instrumental = instrumentalRef.current;
      const vocals = vocalsRef.current;
      if (!instrumental) {
        if (typeof globalThis.requestAnimationFrame === "function") {
          const frame = globalThis.requestAnimationFrame(attach);
          cancelRetry = () => globalThis.cancelAnimationFrame(frame);
        } else {
          const timer = globalThis.setTimeout(attach, 16);
          cancelRetry = () => globalThis.clearTimeout(timer);
        }
        return;
      }

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
      detachListeners = () => {
        metadataEvents.forEach((event) => instrumental.removeEventListener(event, handleMetadata));
        instrumental.removeEventListener("ended", handleEnded);
        instrumental.removeEventListener("timeupdate", handleTimeUpdate);
      };
    };

    attach();
    return () => {
      cancelRetry();
      detachListeners?.();
    };
  }, [
    currentTimeRef,
    instrumentalRef,
    onPlaybackEndedRef,
    sendYouTubeCommand,
    setCurrentTime,
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
        updateMelodyGuide(numericPosition);
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - lastReactSyncRef.current >= REACT_SYNC_INTERVAL_MS) {
          setCurrentTime(numericPosition);
          lastReactSyncRef.current = now;
        }
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
