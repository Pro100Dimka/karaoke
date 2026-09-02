import { useCallback, useEffect, useRef, useState } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { setGlobalRouteBlackout } from "../../../utils/route-blackout";

const waitForScene = (milliseconds) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const AUTO_START_POLL_MS = 120;
const AUTO_START_READY_TIMEOUT_MS = 30_000;
const AUTO_START_RETRIES = 2;

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
  const sceneTransitionRef = useRef(false);
  const resumeRadioOnPauseRef = useRef(false);
  const hasStartedPlaybackRef = useRef(false);
  const stageActionTimerRef = useRef(null);
  const autoStartedSongRef = useRef(null);
  const autoStartInFlightRef = useRef(null);
  const roomRevealedSongRef = useRef(null);
  const [stageActionsVisible, setStageActionsVisible] = useState(true);
  const [sceneBlackout, setSceneBlackout] = useState(autoStartRequested || roomPrepared);
  const [sceneIntroVisible, setSceneIntroVisible] = useState(false);
  const [sceneTransitioning, setSceneTransitioning] = useState(autoStartRequested || roomPrepared);

  useEffect(() => {
    hasStartedPlaybackRef.current = false;
    autoStartedSongRef.current = null;
    autoStartInFlightRef.current = null;
    roomRevealedSongRef.current = null;
  }, [songId]);

  useEffect(() => {
    if (!autoStartRequested && !roomPrepared) return undefined;
    const timer = window.setTimeout(() => setGlobalRouteBlackout(false), 80);
    return () => window.clearTimeout(timer);
  }, [autoStartRequested, roomPrepared]);

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
      let result = false;
      let controlsRestored = false;
      const restoreControls = () => {
        if (controlsRestored) return;
        controlsRestored = true;
        sceneTransitionRef.current = false;
        setSceneTransitioning(false);
        showControls();
        revealStageActions();
      };
      try {
        await waitForScene(420);
        setSceneIntroVisible(true);
        await waitForScene(1350);
        setSceneIntroVisible(false);
        await waitForScene(180);
        await preparation;
        setSceneBlackout(false);
        await waitForScene(520);
        // Electron may leave HTMLMediaElement.play() pending indefinitely. The
        // intro itself is already complete, so controls must not remain locked
        // while the transport negotiates playback.
        restoreControls();
        result = await Promise.resolve(action());
      } finally {
        setSceneIntroVisible(false);
        setSceneBlackout(false);
        await waitForScene(120);
        restoreControls();
      }
      // `action()` returns undefined (not `false`) when it bailed out early
      // because the page had already unmounted mid-transition (e.g. the
      // instrumental ref is gone) -- that must count as "did not start",
      // otherwise the caller thinks playback began and skips restoring radio
      // playback that was paused for the intro.
      return Boolean(result);
    },
    [hideControls, preloadSongMedia, revealStageActions, showControls]
  );

  const startSongWithIntro = useCallback(async () => {
    resumeRadioOnPauseRef.current = isRadioPlaying;
    turnOffRadio({ remember: false });
    const started = await runIntroTransition(() => togglePlay({ forcePlaying: true }));
    if (started) hasStartedPlaybackRef.current = true;
    else if (resumeRadioOnPauseRef.current)
      turnOnRadio({ remember: false, fadeIn: true }).catch(() => {});
    return started;
  }, [isRadioPlaying, runIntroTransition, togglePlay, turnOffRadio, turnOnRadio]);
  const startSongWithIntroRef = useLatestRef(startSongWithIntro);

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
    if (returnToLibrary) await returnToLibrary({ alreadyStopped: true, analysisId });
    else navigateToLibraryFromBlackout(analysisId);
    return true;
  }, [analysisRecordingIdRef, hideControls, navigateToLibraryFromBlackout, returnToLibrary, stop]);

  useEffect(() => {
    if (!autoStartRequested || !songId || autoStartedSongRef.current === songId) return undefined;
    let cancelled = false;
    let attempts = 0;
    let failures = 0;
    let timerId = null;
    const schedule = (delay = AUTO_START_POLL_MS) => {
      timerId = window.setTimeout(tryAutoStart, delay);
    };
    const tryAutoStart = () => {
      if (cancelled) return;
      const instrumental = instrumentalRef.current;
      if (instrumental?.readyState >= 3) {
        if (autoStartInFlightRef.current === songId) return;
        timerId = null;
        autoStartInFlightRef.current = songId;
        startSongWithIntroRef.current().then((started) => {
          if (autoStartInFlightRef.current === songId) autoStartInFlightRef.current = null;
          if (cancelled) return;
          if (started) {
            autoStartedSongRef.current = songId;
            return;
          }
          failures += 1;
          if (failures <= AUTO_START_RETRIES) schedule(600);
        });
        return;
      }
      attempts += 1;
      if (attempts * AUTO_START_POLL_MS < AUTO_START_READY_TIMEOUT_MS) schedule();
      else {
        timerId = null;
        setSceneBlackout(false);
        setSceneTransitioning(false);
        showControls();
      }
    };
    timerId = window.setTimeout(tryAutoStart, 80);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [autoStartRequested, instrumentalRef, showControls, songId, startSongWithIntroRef]);

  useEffect(() => {
    // A guest's karaoke playback is driven by the room's own transport sync,
    // not by this hook -- but they should still see the same fade-in/performer
    // reveal the host gets instead of the song just appearing instantly, so
    // this replays the same intro visuals without forcing playback itself.
    if (autoStartRequested || !roomPrepared || !songId || roomRevealedSongRef.current === songId)
      return undefined;
    roomRevealedSongRef.current = songId;
    let cancelled = false;
    runIntroTransition(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [autoStartRequested, roomPrepared, runIntroTransition, songId]);

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
