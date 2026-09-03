import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Box } from "../../../theme/ui";

export default memo(({ src, isPlaying }) => {
  const video = useRef(null);
  const timer = useRef();
  const [switching, setSwitching] = useState(false);
  const transition = useCallback(() => {
    if (!video.current?.duration) return;
    setSwitching(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { current } = video;
      current.currentTime = Math.random() * Math.max(0.1, current.duration - 0.5);
      Promise.resolve(current.play()).catch(() => {});
      setSwitching(false);
    }, 180);
  }, []);
  useEffect(() => {
    transition();
    return () => clearTimeout(timer.current);
  }, [src, isPlaying, transition]);
  return (
    <Box
      as="video"
      ref={video}
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
