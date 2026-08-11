import { useCallback, useEffect, useRef, useState } from "react";

const CONTROLS_VISIBLE_MS = 2200;
const VISIBILITY_CHECK_MS = 250;

export default function useKaraokeControls({ autoHideEnabled = true } = {}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const lastActivityRef = useRef(Date.now());

  const showControls = useCallback(() => {
    lastActivityRef.current = Date.now();
    setControlsVisible(true);
  }, []);

  const hideControls = useCallback(() => {
    setControlsVisible(false);
  }, []);

  useEffect(() => {
    if (!autoHideEnabled) {
      setControlsVisible(true);
      return undefined;
    }

    const watcher = window.setInterval(() => {
      setControlsVisible(
        Date.now() - lastActivityRef.current < CONTROLS_VISIBLE_MS
      );
    }, VISIBILITY_CHECK_MS);

    return () => window.clearInterval(watcher);
  }, [autoHideEnabled]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", showControls);
    return () => document.removeEventListener("fullscreenchange", showControls);
  }, [showControls]);

  useEffect(() => {
    showControls();
  }, [autoHideEnabled, showControls]);

  const revealControls = useCallback(() => {
    if (!autoHideEnabled) return;
    showControls();
  }, [autoHideEnabled, showControls]);

  return {
    controlsVisible,
    hideControls,
    revealControls,
    showControls
  };
}
