import { useCallback, useEffect, useRef, useState } from "react";

const CONTROLS_VISIBLE_MS = 2200;
const VISIBILITY_CHECK_MS = 250;

export default function useKaraokeControls({ autoHideEnabled = true } = {}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const lastActivityRef = useRef(Date.now());
  const lastPointerRef = useRef(null);
  const effectiveAutoHide = autoHideEnabled;

  const showControls = useCallback(
    () => {
      lastActivityRef.current = Date.now();
      setControlsVisible(true);
    },
    // Stryker disable next-line ArrayDeclaration: stable ref and React setter.
    []
  );

  const hideControls = useCallback(
    () => {
      setControlsVisible(false);
    },
    // Stryker disable next-line ArrayDeclaration: React state setter is stable.
    []
  );

  useEffect(() => {
    if (!effectiveAutoHide) return undefined;

    const watcher = window.setInterval(() => {
      setControlsVisible(Date.now() - lastActivityRef.current < CONTROLS_VISIBLE_MS);
    }, VISIBILITY_CHECK_MS);

    return () => window.clearInterval(watcher);
  }, [effectiveAutoHide]);

  useEffect(
    () => {
      document.addEventListener("fullscreenchange", showControls);
      return () => document.removeEventListener("fullscreenchange", showControls);
    },
    // Stryker disable next-line ArrayDeclaration: showControls has stable identity.
    [showControls]
  );

  useEffect(() => {
    showControls();
  }, [effectiveAutoHide, showControls]);

  const revealControls = useCallback(
    (event) => {
      // Scene transitions call hideControls() unconditionally (to black out the
      // UI during the intro/outro animation) regardless of this preference, so
      // reveal-on-activity must be equally unconditional. Gating it on
      // autoHideEnabled used to mean: once autoHideConsole was turned off, any
      // hideControls() call (every song start/stop) permanently hid the entire
      // console -- moving the mouse could never bring it back, since neither
      // this handler nor the (also disabled) auto-hide watcher would ever call
      // showControls() again.
      if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const position = `${event.clientX}:${event.clientY}`;
        if (lastPointerRef.current === position) return false;
        lastPointerRef.current = position;
      }
      showControls();
      return true;
    },
    [showControls]
  );

  return { controlsVisible, hideControls, revealControls, showControls };
}
