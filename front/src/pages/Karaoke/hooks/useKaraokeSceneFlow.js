import { useCallback, useEffect, useRef, useState } from "react";
import { setGlobalRouteBlackout } from "../../../utils/route-blackout";

const waitForScene = (milliseconds) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const waitForMediaReady = (element) => {
  if (!element || element.readyState >= 3) return Promise.resolve();
  element.load?.();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      window.clearTimeout(timer);
      element.removeEventListener("canplay", finish);
      element.removeEventListener("error", finish);
      resolve();
    };
    element.addEventListener("canplay", finish, { once: true });
    element.addEventListener("error", finish, { once: true });
    timer = window.setTimeout(finish, 2200);
  });
};

export default function useKaraokeSceneFlow({
  analysisRecordingIdRef,
  autoStartRequested,
  hideControls,
  instrumentalRef,
  isPlaying,
  isRadioPlaying,
  navigate,
  setRecordingActive,
  songId,
  stop,
  togglePlay,
  turnOffRadio,
  turnOnRadio,
  vocalsRef
}) {
  const sceneTransitionRef = useRef(false);
  const resumeRadioOnPauseRef = useRef(false);
  const hasStartedPlaybackRef = useRef(false);
  const stageActionTimerRef = useRef(null);
  const autoStartedSongRef = useRef(null);
  const [stageActionsVisible, setStageActionsVisible] = useState(true);
  const [sceneBlackout, setSceneBlackout] = useState(autoStartRequested);
  const [sceneIntroVisible, setSceneIntroVisible] = useState(false);
  const [sceneTransitioning, setSceneTransitioning] = useState(autoStartRequested);

  useEffect(() => {
    hasStartedPlaybackRef.current = false;
    autoStartedSongRef.current = null;
  }, [songId]);

  useEffect(() => {
    if (!autoStartRequested) return undefined;
    const timer = window.setTimeout(() => setGlobalRouteBlackout(false), 80);
    return () => window.clearTimeout(timer);
  }, [autoStartRequested]);

  const revealStageActions = useCallback(() => {
    setStageActionsVisible(true);
    if (stageActionTimerRef.current) window.clearTimeout(stageActionTimerRef.current);
    stageActionTimerRef.current = window.setTimeout(() => {
      stageActionTimerRef.current = null;
      setStageActionsVisible(false);
    }, 1800);
  }, []);

  useEffect(() => {
    revealStageActions();
    return () => {
      if (stageActionTimerRef.current) window.clearTimeout(stageActionTimerRef.current);
    };
  }, [revealStageActions]);

  const preloadSongMedia = useCallback(
    () =>
      Promise.all(
        [instrumentalRef.current, vocalsRef.current].filter(Boolean).map(waitForMediaReady)
      ),
    [instrumentalRef, vocalsRef]
  );

  const runIntroTransition = useCallback(
    async (action) => {
      if (sceneTransitionRef.current) return false;
      sceneTransitionRef.current = true;
      setSceneTransitioning(true);
      hideControls();
      setStageActionsVisible(false);
      setSceneIntroVisible(false);
      setSceneBlackout(true);
      const preparation = preloadSongMedia().catch(() => false);
      try {
        await waitForScene(420);
        setSceneIntroVisible(true);
        await waitForScene(1350);
        setSceneIntroVisible(false);
        await waitForScene(180);
        await preparation;
        setSceneBlackout(false);
        await waitForScene(520);
        await Promise.resolve(action());
      } finally {
        setSceneIntroVisible(false);
        setSceneBlackout(false);
        await waitForScene(120);
        sceneTransitionRef.current = false;
        setSceneTransitioning(false);
      }
      return true;
    },
    [hideControls, preloadSongMedia]
  );

  const startSongWithIntro = useCallback(() => {
    resumeRadioOnPauseRef.current = isRadioPlaying;
    turnOffRadio({ remember: false });
    return runIntroTransition(async () => {
      const started = await togglePlay({ forcePlaying: true });
      if (started) hasStartedPlaybackRef.current = true;
      return started;
    });
  }, [isRadioPlaying, runIntroTransition, togglePlay, turnOffRadio]);

  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      const paused = await togglePlay({ forcePlaying: false });
      if (paused && resumeRadioOnPauseRef.current) {
        setRecordingActive(false);
        turnOnRadio({ remember: false, fadeIn: true }).catch(() => {});
      }
      return paused;
    }
    if (hasStartedPlaybackRef.current) {
      turnOffRadio({ remember: false });
      return togglePlay({ forcePlaying: true });
    }
    return startSongWithIntro();
  }, [isPlaying, setRecordingActive, startSongWithIntro, togglePlay, turnOffRadio, turnOnRadio]);

  const navigateToLibraryFromBlackout = useCallback(
    (analysisId = null) => {
      navigate("/", {
        replace: true,
        state: { fromKaraokeFade: true, analysisRecordingId: analysisId || null }
      });
    },
    [navigate]
  );

  const handleStop = useCallback(async () => {
    if (sceneTransitionRef.current) return false;
    sceneTransitionRef.current = true;
    setSceneTransitioning(true);
    hideControls();
    setStageActionsVisible(false);
    setSceneIntroVisible(false);
    setSceneBlackout(true);
    await waitForScene(430);
    const stopped = await stop();
    if (!stopped) {
      sceneTransitionRef.current = false;
      setSceneTransitioning(false);
      setSceneBlackout(false);
      setStageActionsVisible(true);
      return false;
    }
    hasStartedPlaybackRef.current = false;
    const analysisId = analysisRecordingIdRef.current;
    setGlobalRouteBlackout(true);
    await waitForScene(40);
    navigateToLibraryFromBlackout(analysisId);
    return true;
  }, [analysisRecordingIdRef, hideControls, navigateToLibraryFromBlackout, stop]);

  useEffect(() => {
    if (!autoStartRequested || !songId || autoStartedSongRef.current === songId) return undefined;
    let cancelled = false;
    let attempts = 0;
    let timerId = null;
    const tryAutoStart = () => {
      if (cancelled) return;
      if (instrumentalRef.current) {
        timerId = null;
        autoStartedSongRef.current = songId;
        void startSongWithIntro();
        return;
      }
      attempts += 1;
      if (attempts < 40) timerId = window.setTimeout(tryAutoStart, 120);
      else {
        timerId = null;
        setSceneBlackout(false);
        setSceneTransitioning(false);
      }
    };
    timerId = window.setTimeout(tryAutoStart, 80);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [autoStartRequested, instrumentalRef, songId, startSongWithIntro]);

  return {
    handleStop,
    handleTogglePlay,
    navigateToLibraryFromBlackout,
    revealStageActions,
    sceneBlackout,
    sceneIntroVisible,
    sceneTransitioning,
    stageActionsVisible
  };
}
