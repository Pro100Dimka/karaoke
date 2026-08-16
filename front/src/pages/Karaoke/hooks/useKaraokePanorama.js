import { useEffect, useRef, useState } from "react";
import { KARAOKE_THEMES, shuffleThemes } from "../../../assets/karaoke/themes";
import { createPanoramaPath } from "../utils/data";
import { getPanoramaPosition } from "../utils/panorama";

const PANORAMA_CYCLE_MS = 240_000;

export default function useKaraokePanorama(songId, isPlaying) {
  const panoramaRef = useRef(null);
  const clockRef = useRef(0);
  const pathRef = useRef(null);
  const themeQueueRef = useRef(null);
  pathRef.current ??= createPanoramaPath();
  themeQueueRef.current ??= shuffleThemes();
  const appliedSongRef = useRef(songId);
  const [activeTheme, setActiveTheme] = useState(
    () => themeQueueRef.current.pop() || KARAOKE_THEMES[0]
  );

  useEffect(() => {
    if (!songId || appliedSongRef.current === songId) return;
    appliedSongRef.current = songId;

    if (!themeQueueRef.current.length) themeQueueRef.current = shuffleThemes();

    setActiveTheme(themeQueueRef.current.pop());
    clockRef.current = 0;
    pathRef.current = createPanoramaPath();
  }, [songId]);

  useEffect(() => {
    const panorama = panoramaRef.current;
    if (!panorama || !isPlaying) return undefined;

    let frameId;
    let lastFrame = 0;
    const frameInterval =
      document.documentElement.dataset.performance === "reduced" ? 1000 / 15 : 0;
    const startedAt = performance.now() - clockRef.current;
    const path = pathRef.current;

    const move = (now) => {
      if (now - lastFrame < frameInterval) {
        frameId = requestAnimationFrame(move);
        return;
      }
      lastFrame = now;
      const elapsed = now - startedAt;
      const { x, y } = getPanoramaPosition(elapsed, PANORAMA_CYCLE_MS, path);
      panorama.style.setProperty("--panorama-x", `-${x.toFixed(3)}cqh`);
      panorama.style.setProperty("--panorama-y", `${y.toFixed(3)}%`);
      clockRef.current = elapsed;
      frameId = requestAnimationFrame(move);
    };

    frameId = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  return { activeTheme, panoramaRef };
}
