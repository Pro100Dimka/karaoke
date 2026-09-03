import { useCallback, useEffect, useRef, useState } from "react";

const VISIBLE_MS = 2200;

export default function useKaraokeControls({ autoHideEnabled = true } = {}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const lastActivity = useRef(Date.now());
  const lastPointer = useRef([NaN, NaN]);
  const manuallyHidden = useRef(false);

  const showControls = useCallback((manual = false) => {
    if (manual) manuallyHidden.current = false;
    if (manuallyHidden.current) return;
    lastActivity.current = Date.now();
    setControlsVisible(true);
  }, []);

  const hideControls = useCallback((manual = false) => {
    if (manual) manuallyHidden.current = true;
    setControlsVisible(false);
  }, []);

  useEffect(() => {
    if (!autoHideEnabled) return;
    const timer = setInterval(() => {
      if (!manuallyHidden.current) {
        setControlsVisible(Date.now() - lastActivity.current < VISIBLE_MS);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [autoHideEnabled]);

  useEffect(() => {
    const reveal = () => showControls(true);
    globalThis.document?.addEventListener?.("fullscreenchange", reveal);
    return () => globalThis.document?.removeEventListener?.("fullscreenchange", reveal);
  }, [showControls]);

  useEffect(() => showControls(true), [autoHideEnabled, showControls]);

  const revealControls = useCallback(
    (event) => {
      if (manuallyHidden.current) return false;

      if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        const [x, y] = lastPointer.current;
        if (x === event.clientX && y === event.clientY) return false;
        lastPointer.current = [event.clientX, event.clientY];
      }

      showControls();
      return true;
    },
    [showControls]
  );

  return { controlsVisible, hideControls, revealControls, showControls };
}
