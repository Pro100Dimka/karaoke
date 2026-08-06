import { useEffect, useRef, useState } from "react";

const CONTROLS_VISIBLE_MS = 2200;
const VISIBILITY_CHECK_MS = 250;

export default function useKaraokeControls() {
  const [controlsVisible, setControlsVisible] = useState(true);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const watcher = window.setInterval(() => {
      setControlsVisible(
        Date.now() - lastActivityRef.current < CONTROLS_VISIBLE_MS
      );
    }, VISIBILITY_CHECK_MS);

    return () => window.clearInterval(watcher);
  }, []);

  useEffect(() => {
    const showControls = () => {
      lastActivityRef.current = Date.now();
      setControlsVisible(true);
    };

    document.addEventListener("fullscreenchange", showControls);
    return () => document.removeEventListener("fullscreenchange", showControls);
  }, []);

  const revealControls = () => {
    lastActivityRef.current = Date.now();
    setControlsVisible(true);
  };

  return { controlsVisible, revealControls };
}
