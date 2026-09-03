import { useCallback, useEffect, useRef, useState } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import useMountedRef from "../../../hooks/useMountedRef";
import { setGlobalRouteBlackout } from "../../../utils/route-blackout";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AUTO_START_POLL_MS = 120;
const AUTO_START_TIMEOUT_MS = 30_000;
const AUTO_START_RETRIES = 2;

const waitForMedia = (element) => {
  if (!element || element.readyState >= 3) return Promise.resolve();
  element.load?.();

  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      element.removeEventListener("canplay", done);
      element.removeEventListener("error", done);
      resolve();
    };
    element.addEventListener("canplay", done, { once: true });
    element.addEventListener("error", done, { once: true });
    timer = setTimeout(done, 2200);
  });
};

const safe = (value) => Promise.resolve(value).catch(() => false);

export default function useKaraokeSceneFlow({
  analysisRecordingIdRef,
  autoStartRequested,
  roomPrepared,
  hideControls,
  instrumentalRef,
  isPlaying,
  isRadioPlaying,
  navigate,
  returnToLibrary,
  setRecordingActive,
  showControls,
  songId,
  stop,
  togglePlay,
  turnOffRadio,
  turnOnRadio,
  vocalsRef
}) {
  const mounted = useMountedRef();
  const transition = useRef(0);
  const transitioning = useRef(false);
  const resumeRadio = useRef(false);
  const hasStarted = useRef(false);
  const stageTimer = useRef(null);
  const autoStarted = useRef(null);
  const autoStarting = useRef(null);
  const roomRevealed = useRef(null);
  const [stageActionsVisible, setStageActionsVisible] = useState(true);
  const [sceneBlackout, setSceneBlackout] = useState(autoStartRequested || roomPrepared);
  const [sceneIntroVisible, setSceneIntroVisible] = useState(false);
  const [sceneTransitioning, setSceneTransitioning] = useState(autoStartRequested || roomPrepared);

  const isCurrent = useCallback(
    (id) => mounted.current && transition.current === id,
    [mounted]
  );

  useEffect(() => {
    transition.current += 1;
    transitioning.current = false;
    hasStarted.current = false;
    autoStarted.current = null;
    autoStarting.current = null;
    roomRevealed.current = null;
    setSceneIntroVisible(false);
    setSceneBlackout(autoStartRequested || roomPrepared);
    setSceneTransitioning(autoStartRequested || roomPrepared);
  }, [autoStartRequested, roomPrepared, songId]);

  useEffect(() => {
    if (!autoStartRequested && !roomPrepared) return;
    const timer = setTimeout(() => setGlobalRouteBlackout(false), 80);
    return () => clearTimeout(timer);
  }, [autoStartRequested, roomPrepared]);

  const revealStageActions = useCallback(() => {
    setStageActionsVisible(true);
    clearTimeout(stageTimer.current);
    stageTimer.current = setTimeout(() => {
      stageTimer.current = null;
      if (mounted.current) setStageActionsVisible(false);
    }, 1800);
  }, [mounted]);

  useEffect(() => {
    revealStageActions();
    return () => clearTimeout(stageTimer.current);
  }, [revealStageActions]);

  const preloadMedia = useCallback(
    () => Promise.all([instrumentalRef.current, vocalsRef.current].filter(Boolean).map(waitForMedia)),
    [instrumentalRef, vocalsRef]
  );

  const runIntroTransition = useCallback(
    async (action) => {
      if (transitioning.current) return false;
      transitioning.current = true;
      const id = ++transition.current;
      const active = () => isCurrent(id);
      let restored = false;

      const restore = () => {
        if (restored || !active()) return;
        restored = true;
        transitioning.current = false;
        setSceneTransitioning(false);
        showControls();
        revealStageActions();
      };

      setSceneTransitioning(true);
      hideControls();
      setStageActionsVisible(false);
      setSceneIntroVisible(false);
      setSceneBlackout(true);
      const preparation = safe(preloadMedia());

      try {
        await wait(420);
        if (!active()) return false;
        setSceneIntroVisible(true);

        await wait(1350);
        if (!active()) return false;
        setSceneIntroVisible(false);

        await wait(180);
        if (!active()) return false;
        await preparation;
        if (!active()) return false;
        setSceneBlackout(false);

        await wait(520);
        if (!active()) return false;
        restore();
        return Boolean(await action());
      } catch {
        return false;
      } finally {
        if (active()) {
          setSceneIntroVisible(false);
          setSceneBlackout(false);
          await wait(120);
          restore();
        }
      }
    },
    [hideControls, isCurrent, preloadMedia, revealStageActions, showControls]
  );

  const startSongWithIntro = useCallback(async () => {
    resumeRadio.current = isRadioPlaying;
    turnOffRadio({ remember: false });
    const started = await runIntroTransition(() => togglePlay({ forcePlaying: true }));
    if (started) hasStarted.current = true;
    else if (resumeRadio.current && mounted.current) {
      safe(turnOnRadio({ remember: false, fadeIn: true }));
    }
    return started;
  }, [isRadioPlaying, mounted, runIntroTransition, togglePlay, turnOffRadio, turnOnRadio]);
  const startSongRef = useLatestRef(startSongWithIntro);

  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      const paused = await togglePlay({ forcePlaying: false });
      if (paused && resumeRadio.current) {
        setRecordingActive(false);
        safe(turnOnRadio({ remember: false, fadeIn: true }));
      }
      return paused;
    }

    if (!hasStarted.current) return startSongWithIntro();
    turnOffRadio({ remember: false });
    return togglePlay({ forcePlaying: true });
  }, [isPlaying, setRecordingActive, startSongWithIntro, togglePlay, turnOffRadio, turnOnRadio]);

  const navigateFromBlackout = useCallback(
    (analysisId = null) =>
      navigate("/", {
        replace: true,
        state: { fromKaraokeFade: true, analysisRecordingId: analysisId || null }
      }),
    [navigate]
  );

  const handleStop = useCallback(async () => {
    if (transitioning.current) return false;
    transitioning.current = true;
    const id = ++transition.current;
    const active = () => isCurrent(id);

    setSceneTransitioning(true);
    hideControls();
    setStageActionsVisible(false);
    setSceneIntroVisible(false);
    setSceneBlackout(true);

    try {
      await wait(430);
      if (!active()) return false;

      const stopped = await stop();
      if (!active()) return false;
      if (!stopped) {
        transitioning.current = false;
        setSceneTransitioning(false);
        setSceneBlackout(false);
        setStageActionsVisible(true);
        return false;
      }

      hasStarted.current = false;
      const analysisId = analysisRecordingIdRef.current;
      setGlobalRouteBlackout(true);
      await wait(40);
      if (!active()) return false;

      if (returnToLibrary) await returnToLibrary({ alreadyStopped: true, analysisId });
      else navigateFromBlackout(analysisId);
      return true;
    } catch {
      if (active()) {
        transitioning.current = false;
        setSceneTransitioning(false);
        setSceneBlackout(false);
        setStageActionsVisible(true);
      }
      return false;
    }
  }, [analysisRecordingIdRef, hideControls, isCurrent, navigateFromBlackout, returnToLibrary, stop]);

  useEffect(() => {
    if (!autoStartRequested || !songId || autoStarted.current === songId) return;

    let cancelled = false;
    let attempts = 0;
    let failures = 0;
    let timer;
    const schedule = (delay = AUTO_START_POLL_MS) => {
      timer = setTimeout(tryStart, delay);
    };
    const tryStart = () => {
      if (cancelled) return;

      if (instrumentalRef.current?.readyState >= 3) {
        if (autoStarting.current === songId) return;
        autoStarting.current = songId;
        safe(startSongRef.current()).then((started) => {
          if (autoStarting.current === songId) autoStarting.current = null;
          if (cancelled) return;
          if (started) autoStarted.current = songId;
          else if (++failures <= AUTO_START_RETRIES) schedule(600);
        });
        return;
      }

      attempts += 1;
      if (attempts * AUTO_START_POLL_MS < AUTO_START_TIMEOUT_MS) schedule();
      else {
        setSceneBlackout(false);
        setSceneTransitioning(false);
        transitioning.current = false;
        showControls();
      }
    };

    schedule(80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoStartRequested, instrumentalRef, showControls, songId, startSongRef]);

  useEffect(() => {
    if (autoStartRequested || !roomPrepared || !songId || roomRevealed.current === songId) return;

    let cancelled = false;
    safe(runIntroTransition(() => !cancelled)).then((shown) => {
      if (!cancelled && shown) roomRevealed.current = songId;
    });
    return () => {
      cancelled = true;
    };
  }, [autoStartRequested, roomPrepared, runIntroTransition, songId]);

  useEffect(
    () => () => {
      transition.current += 1;
      transitioning.current = false;
      clearTimeout(stageTimer.current);
    },
    []
  );

  return {
    handleStop,
    handleTogglePlay,
    navigateToLibraryFromBlackout: navigateFromBlackout,
    revealStageActions,
    sceneBlackout,
    sceneIntroVisible,
    sceneTransitioning,
    stageActionsVisible
  };
}
