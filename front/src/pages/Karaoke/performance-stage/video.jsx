import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Box } from "../../../theme/ui";

const play = (video) => Promise.resolve().then(() => video.play()).catch(() => {});

export default memo(function SceneVideo({ src, isPlaying }) {
  const ref = useRef(null);
  const timer = useRef(null);
  const [switching, setSwitching] = useState(false);

  const transition = useCallback(() => {
    const video = ref.current;
    clearTimeout(timer.current);

    if (!video || !isPlaying) {
      video?.pause();
      setSwitching(false);
      return;
    }

    if (!Number.isFinite(video.duration) || video.duration <= 0) return;

    setSwitching(true);
    timer.current = setTimeout(() => {
      const current = ref.current;
      if (!current || !isPlaying) return setSwitching(false);

      try {
        current.currentTime = Math.random() * Math.max(0.1, current.duration - 0.5);
        play(current);
      } finally {
        setSwitching(false);
      }
    }, 180);
  }, [isPlaying]);

  useEffect(() => {
    transition();
    return () => clearTimeout(timer.current);
  }, [src, transition]);

  return (
    <Box
      as="video"
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      data-switching={switching || undefined}
      onLoadedMetadata={transition}
      sx={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: switching ? 0 : 1,
        transition: "opacity var(--motion-duration-normal) var(--motion-easing-standard)"
      }}
    />
  );
});
