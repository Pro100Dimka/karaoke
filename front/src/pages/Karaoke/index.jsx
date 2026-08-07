import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Radio, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { IconButton } from "../../components/ui";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { useRadio } from "../../contexts/radio";
import { usePolling } from "../../hooks/usePolling";
import KaraokeConsole from "./components/console";
import KaraokeMedia from "./components/karaoke-media";
import KaraokePerformanceStage from "./components/karaoke-performance-stage";
import useAudioOutputRouting from "./hooks/useAudioOutputRouting";
import useKaraokeControls from "./hooks/useKaraokeControls";
import useKaraokeHotkeys from "./hooks/useKaraokeHotkeys";
import useKaraokeMediaSync from "./hooks/useKaraokeMediaSync";
import useKaraokePreferences from "./hooks/useKaraokePreferences";
import useKaraokeResult from "./hooks/useKaraokeResult";
import useKaraokeStageLayout from "./hooks/useKaraokeStageLayout";
import useKaraokeTransport from "./hooks/useKaraokeTransport";
import useMelodyGuide from "./hooks/useMelodyGuide";
import useMicrophoneSettings from "./hooks/useMicrophoneSettings";
import usePitchDetection from "./hooks/usePitchDetection";
import MicrophoneSettingsModal from "./modals/microphone-settings-modal";
import PerformanceAnalysisModal from "./modals/performance-analysis-modal";
import {
  getYouTubeVideoId,
  normalizeLyrics,
  normalizeNotes,
  transposeKey
} from "./utils/data";
import { formatCompactKey } from "./utils/display";
import { getLyricDisplayState } from "./utils/lyrics";
import { getMicrophoneLevel } from "./utils/transport";

// Karaoke data is normalized at the UI boundary so playback and visual
// components operate on one predictable shape. Pure transformations live in
// utils/data.js and are covered by regression tests.

const setGlobalRouteBlackout = (visible) => {
  window.dispatchEvent(
    new CustomEvent("app:route-blackout", { detail: { visible } })
  );
};

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
  const {
    isPlaying: isRadioPlaying,
    setRecordingActive,
    toggle: toggleRadio,
    turnOff: turnOffRadio,
    turnOn: turnOnRadio
  } = useRadio();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: songs } = usePolling(api.listSongs, 15000, []);
  const songId = location.state?.songId || null;
  const song = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || []).find((s) => s.status === "done");

  const result = useKaraokeResult(song);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const youTubeClipRef = useRef(null);
  const sceneVideoRef = useRef(null);
  const sceneTransitionRef = useRef(false);
  const resumeRadioOnPauseRef = useRef(false);
  const hasStartedPlaybackRef = useRef(false);
  const stageActionTimerRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const {
    musicVolume,
    setMusicVolume,
    vocalVolume,
    setVocalVolume,
    melodyVolume,
    setMelodyVolume,
    speed,
    setSpeed,
    keyShift,
    setKeyShift,
    showLyrics,
    setShowLyrics,
    showNotes,
    setShowNotes,
    autoHideConsole,
    setAutoHideConsole,
    effectPreset,
    setEffectPreset
  } = useKaraokePreferences();
  // ВАЖНО: keyShift сейчас смещает только отображаемую линию мелодии
  // (транспонирует ноты на экране), а НЕ реальный питч аудио — честный
  // питч-шифтинг воспроизведения в браузере требует DSP-библиотеки вроде
  // SoundTouch-js/Rubberband и здесь не реализован. Если нужен настоящий
  // сдвиг тональности звука — это отдельная задача.
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const analysisRecordingIdRef = useRef(null);
  const updateAnalysisRecordingId = useCallback((value) => {
    if (typeof value === "function") {
      setAnalysisRecordingId((previous) => {
        const next = value(previous);
        analysisRecordingIdRef.current = next;
        return next;
      });
      return;
    }
    analysisRecordingIdRef.current = value;
    setAnalysisRecordingId(value);
  }, []);
  const [microphoneOpen, setMicrophoneOpen] = useState(false);
  const [microphoneSettingsView, setMicrophoneSettingsView] = useState("music");
  const [recordingError, setRecordingError] = useState(null);

  useEffect(() => {
    // A paused recording session must not block the background radio. Only
    // suspend radio output while karaoke playback is actually running.
    setRecordingActive(Boolean(recordingSessionId) && isPlaying);
    return () => setRecordingActive(false);
  }, [isPlaying, recordingSessionId, setRecordingActive]);
  const [stageActionsVisible, setStageActionsVisible] = useState(true);
  const autoStartRequested = Boolean(location.state?.autoPlay);
  const [sceneBlackout, setSceneBlackout] = useState(autoStartRequested);
  const [sceneIntroVisible, setSceneIntroVisible] = useState(false);
  const [sceneTransitioning, setSceneTransitioning] = useState(autoStartRequested);
  const autoStartedSongRef = useRef(null);
  const {
    controlsVisible,
    hideControls,
    revealControls,
    showControls
  } = useKaraokeControls({ autoHideEnabled: autoHideConsole });

  useEffect(() => {
    if (!autoStartRequested) return undefined;

    // Library keeps an app-level black layer mounted across the route change.
    // Karaoke already starts with its own blackout, so hand off the cover only
    // after this route has painted once.
    const timer = window.setTimeout(() => setGlobalRouteBlackout(false), 80);
    return () => window.clearTimeout(timer);
  }, [autoStartRequested]);

  const randomizeSceneVideo = useCallback(() => {
    const video = sceneVideoRef.current;
    if (!video) return;
    const videoDuration = Number(video.duration);
    if (Number.isFinite(videoDuration) && videoDuration > 1) {
      video.currentTime = Math.random() * Math.max(0.1, videoDuration - 0.5);
    }
    const playResult = video.play?.();
    playResult?.catch?.(() => {});
  }, []);

  const revealStageActions = useCallback(() => {
    setStageActionsVisible(true);
    if (stageActionTimerRef.current) {
      window.clearTimeout(stageActionTimerRef.current);
    }
    stageActionTimerRef.current = window.setTimeout(() => {
      setStageActionsVisible(false);
    }, 1800);
  }, []);

  useEffect(() => {
    revealStageActions();
    return () => {
      if (stageActionTimerRef.current) {
        window.clearTimeout(stageActionTimerRef.current);
      }
    };
  }, [revealStageActions]);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const browserMonitorRef = useRef(null);
  const playbackEndedRef = useRef(null);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: directOutputDevices } = usePolling(
    () => (microphoneOpen ? api.listAudioOutputDevices() : Promise.resolve([])),
    30000,
    [microphoneOpen]
  );
  const { data: audioSettings } = usePolling(
    () => api.getAudioSettings(),
    30000,
    []
  );
  const { data: signal } = usePolling(
    () => (microphoneOpen ? api.getSignalQuality() : Promise.resolve(null)),
    1200,
    [microphoneOpen]
  );

  const microphoneLevel = getMicrophoneLevel(signal);
  const microphoneSettings = useMicrophoneSettings({
    audioSettings,
    onError: setRecordingError
  });
  const {
    microphoneVolume,
    setMicrophoneVolume,
    microphoneEffects,
    setMicrophoneEffects
  } = microphoneSettings;
  const {
    audioDriver,
    directOutputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled,
    setMonitoringEnabled
  } = microphoneSettings;
  const { monitorInputDeviceId, updateMicrophone } = microphoneSettings;

  useAudioOutputRouting({
    audioDriver,
    audioSettings,
    browserMonitorRef,
    directOutputDeviceId,
    directOutputDevices,
    instrumentalRef,
    microphoneOpen,
    setDirectOutputDeviceId,
    updateMicrophone,
    videoRef,
    vocalsRef
  });

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    hasStartedPlaybackRef.current = false;
  }, [song?.id]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(
    () => normalizeNotes(result?.reference_notes),
    [result]
  );
  const { startMelodyGuide, updateMelodyGuide, silenceMelodyGuide } =
    useMelodyGuide({
      notes,
      volume: melodyVolume,
      keyShift,
      currentTimeRef
    });
  const youTubeVideoId = getYouTubeVideoId(song?.video_url);

  // Lyrics and melody use the same instrumental clock.  A former global
  // "anchor" delay shifted every word by up to half a second even when the
  // word-level alignment was already correct for the current song.
  const lyricTime = currentTime;

  const { currentLine, upcomingLine, nextLine } = getLyricDisplayState(
    lyrics,
    lyricTime
  );

  const { sendYouTubeCommand, syncSecondaryMedia } = useKaraokeMediaSync({
    browserMonitorRef,
    currentTimeRef,
    instrumentalRef,
    isPlaying,
    keyShift,
    melodyVolume,
    microphoneEffects,
    microphoneVolume,
    musicVolume,
    onPlaybackEndedRef: playbackEndedRef,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    silenceMelodyGuide,
    songId: song?.id,
    speed,
    startMelodyGuide,
    updateMelodyGuide,
    videoRef,
    vocalVolume,
    vocalsRef,
    youTubeClipRef
  });

  const { sungMidi, isPitchDetected, isPitchAttacking, pitchRestProgress } =
    usePitchDetection({
      browserMonitorRef,
      isPlaying,
      monitorInputDeviceId,
      monitoringEnabled
    });

  const { preparePlayback, returnToLibrary, seekTo, skip, stop, togglePlay } =
    useKaraokeTransport({
      browserMonitorRef,
      currentTime,
      duration,
      durationRef,
      instrumentalRef,
      isPlaying,
      microphoneEffects,
      microphoneVolume,
      musicVolume,
      navigate,
      onlineRoom,
      recordingSessionId,
      sendYouTubeCommand,
      setAnalysisRecordingId: updateAnalysisRecordingId,
      setCurrentTime,
      setIsPlaying,
      setMonitoringEnabled,
      setRecordingError,
      setRecordingSessionId,
      silenceMelodyGuide,
      song,
      startMelodyGuide,
      syncSecondaryMedia,
      videoRef,
      vocalVolume,
      vocalsRef
    });

  const waitForScene = useCallback(
    (milliseconds) =>
      new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
    []
  );

  const preloadSongMedia = useCallback(async () => {
    const media = [instrumentalRef.current, vocalsRef.current].filter(Boolean);
    await Promise.all(
      media.map((element) => {
        if (element.readyState >= 3) return Promise.resolve();
        element.load?.();
        return new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            element.removeEventListener("canplay", finish);
            element.removeEventListener("error", finish);
            resolve();
          };
          element.addEventListener("canplay", finish, { once: true });
          element.addEventListener("error", finish, { once: true });
          window.setTimeout(finish, 2200);
        });
      })
    );
  }, []);

  const runSceneTransition = useCallback(
    async (
      action,
      { showIntro = false, actionAfterReveal = false, prepareAction = null } = {}
    ) => {
      if (sceneTransitionRef.current) return false;
      sceneTransitionRef.current = true;
      setSceneTransitioning(true);
      hideControls();
      setStageActionsVisible(false);
      setSceneIntroVisible(false);
      setSceneBlackout(true);
      const preparation = prepareAction
        ? Promise.resolve().then(prepareAction).catch(() => false)
        : Promise.resolve(true);

      try {
        await waitForScene(420);
        randomizeSceneVideo();

        if (showIntro) {
          setSceneIntroVisible(true);
          await waitForScene(1350);
          setSceneIntroVisible(false);
          await waitForScene(180);
        }

        await preparation;

        if (!actionAfterReveal) {
          await Promise.resolve(action());
        }

        setSceneBlackout(false);
        // The reveal is deliberately cinematic. Playback begins only after the
        // scene is fully visible, never while the screen is still fading out.
        await waitForScene(2400);

        if (actionAfterReveal) {
          await Promise.resolve(action());
        }
      } finally {
        setSceneIntroVisible(false);
        setSceneBlackout(false);
        await waitForScene(120);
        sceneTransitionRef.current = false;
        setSceneTransitioning(false);
      }
      return true;
    },
    [hideControls, randomizeSceneVideo, waitForScene]
  );

  const startSongWithIntro = useCallback(() => {
    resumeRadioOnPauseRef.current = isRadioPlaying;
    turnOffRadio({ remember: false });
    return runSceneTransition(
      async () => {
        const started = await togglePlay({ forcePlaying: true });
        if (started) hasStartedPlaybackRef.current = true;
        return started;
      },
      {
        showIntro: true,
        actionAfterReveal: true,
        prepareAction: () => Promise.all([preloadSongMedia(), preparePlayback()])
      }
    );
  }, [
    isRadioPlaying,
    preloadSongMedia,
    preparePlayback,
    runSceneTransition,
    togglePlay,
    turnOffRadio
  ]);

  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      const paused = await togglePlay({ forcePlaying: false });
      if (paused && resumeRadioOnPauseRef.current) {
        // Release the radio synchronously instead of waiting for the React
        // effect that follows setIsPlaying(false).
        setRecordingActive(false);
        turnOnRadio({ remember: false, fadeIn: true }).catch(() => {});
      }
      return paused;
    }

    // Resume is immediate: no cinematic blackout is repeated after Pause.
    if (hasStartedPlaybackRef.current) {
      turnOffRadio({ remember: false });
      return togglePlay({ forcePlaying: true });
    }

    return startSongWithIntro();
  }, [
    isPlaying,
    setRecordingActive,
    startSongWithIntro,
    togglePlay,
    turnOffRadio,
    turnOnRadio
  ]);

  const navigateToLibraryFromBlackout = useCallback((analysisId = null) => {
    navigate("/", {
      replace: true,
      state: {
        fromKaraokeFade: true,
        analysisRecordingId: analysisId || null
      }
    });
  }, [navigate]);

  const handleStop = useCallback(async () => {
    if (sceneTransitionRef.current) return false;

    sceneTransitionRef.current = true;
    setSceneTransitioning(true);
    hideControls();
    setStageActionsVisible(false);
    setSceneIntroVisible(false);
    setSceneBlackout(true);

    // Fade the live scene out first. Saving the take and starting analysis then
    // happens while the screen is already black, so the end of a performance
    // feels like one continuous transition instead of a hard UI change.
    await waitForScene(430);

    const stopped = await stop();
    if (stopped) hasStartedPlaybackRef.current = false;

    const analysisId = analysisRecordingIdRef.current;

    // Keep one blackout mounted outside the routed pages themselves. This
    // survives Karaoke unmounting and prevents the themed body from flashing
    // for a frame before Library mounts.
    setGlobalRouteBlackout(true);
    await waitForScene(40);

    // Switch routes while the stage is fully black. Library receives the
    // recording id and opens the analysis modal there, so the user is already
    // back in Library underneath the result instead of being stranded on the
    // Karaoke route until the modal is closed.
    navigateToLibraryFromBlackout(analysisId);
    return stopped;
  }, [hideControls, navigateToLibraryFromBlackout, stop, waitForScene]);

  useEffect(() => {
    if (!autoStartRequested || !song?.id || autoStartedSongRef.current === song.id) {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let timerId = null;

    const tryAutoStart = () => {
      if (cancelled) return;
      if (instrumentalRef.current && vocalsRef.current) {
        autoStartedSongRef.current = song.id;
        startSongWithIntro();
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        timerId = window.setTimeout(tryAutoStart, 120);
      } else {
        setSceneBlackout(false);
        setSceneTransitioning(false);
      }
    };

    timerId = window.setTimeout(tryAutoStart, 80);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [autoStartRequested, song?.id, startSongWithIntro]);

  playbackEndedRef.current = () => handleStop();

  useKaraokeHotkeys({
    currentTime,
    duration,
    onTogglePlay: handleTogglePlay,
    onSeek: seekTo,
    onStop: handleStop
  });

  useKaraokeStageLayout(containerRef);

  if (!song) {
    return (
      <div className="panel">
        <p className="text-muted">
          Нет готовой песни для воспроизведения. Сначала обработайте песню в
          Библиотеке.
        </p>
      </div>
    );
  }
  if (song.status !== "done") {
    return (
      <div className="panel">
        <p className="text-muted">
          «{song.title}» ещё не обработана — статус: {song.status}.
        </p>
      </div>
    );
  }

  const baseTempo = Number(result?.music?.tempo || song.tempo_override || 120);
  const currentTempo = Math.max(1, Math.round(baseTempo * speed));
  const compactKey = formatCompactKey(
    transposeKey(song.key_override || result?.music?.key || "C", keyShift)
  );
  const changeTempo = (delta) => {
    const nextTempo = Math.max(1, currentTempo + delta);
    setSpeed(Math.max(0.5, Math.min(1.5, nextTempo / baseTempo)));
  };
  const applyEffectPreset = (preset) => {
    setEffectPreset(preset.id);
    setMicrophoneEffects((effects) => ({
      ...effects,
      reverb: preset.reverb,
      echo: preset.echo,
      delay: preset.delay
    }));
  };

  return (
    <div
      ref={containerRef}
      className={`karaoke-stage ${isPlaying ? "karaoke-is-playing" : ""} ${!controlsVisible || sceneTransitioning ? "karaoke-ui-hidden" : ""}`}
      onMouseMove={() => {
        if (sceneTransitioning) return;
        revealStageActions();
        revealControls();
      }}
    >
      <KaraokeMedia
        instrumentalRef={instrumentalRef}
        isPlaying={isPlaying}
        musicVolume={musicVolume}
        sendYouTubeCommand={sendYouTubeCommand}
        song={song}
        speed={speed}
        syncSecondaryMedia={syncSecondaryMedia}
        videoRef={videoRef}
        vocalVolume={vocalVolume}
        vocalsRef={vocalsRef}
        youTubeClipRef={youTubeClipRef}
        youTubeVideoId={youTubeVideoId}
      />

      {microphoneOpen && (
        <MicrophoneSettingsModal
          view={microphoneSettingsView}
          effects={microphoneEffects}
          keyShift={keyShift}
          speed={speed}
          songKey={transposeKey(song?.key_override, keyShift)}
          onClose={() => setMicrophoneOpen(false)}
          onEffectsChange={(key, value) =>
            setMicrophoneEffects((effects) => ({ ...effects, [key]: value }))
          }
          onEffectCommit={(key, value) => updateMicrophone({ [key]: value })}
          onKeyShiftChange={setKeyShift}
          onSpeedChange={setSpeed}
          onOpenAudioSettings={onOpenAppSettings}
        />
      )}

      {recordingError && (
        <p className="karaoke-recording-error">{recordingError}</p>
      )}
      {analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={analysisRecordingId}
          onClose={() => {
            updateAnalysisRecordingId(null);
            navigateToLibraryFromBlackout();
          }}
          onDone={() => {
            updateAnalysisRecordingId(null);
            navigateToLibraryFromBlackout();
          }}
          onDeleted={() => {
            updateAnalysisRecordingId(null);
            navigateToLibraryFromBlackout();
          }}
        />
      )}

      <div
        className={`karaoke-stage-actions ${stageActionsVisible && !sceneTransitioning ? "is-visible" : ""}`}
        aria-label="Навигация караоке"
      >
        <IconButton
          unstyled
          className="karaoke-stage-action"
          icon={ArrowLeft}
          size={25}
          label="Назад в библиотеку"
          onClick={returnToLibrary}
        />
        {!autoHideConsole && (
          <IconButton
            unstyled
            className={`karaoke-stage-action ${controlsVisible ? "is-active" : ""}`}
            icon={SlidersHorizontal}
            size={25}
            label={controlsVisible ? "Скрыть консоль" : "Показать консоль"}
            aria-pressed={controlsVisible}
            onClick={controlsVisible ? hideControls : showControls}
          />
        )}
        {!isPlaying && (
          <IconButton
            unstyled
            className={`karaoke-stage-action karaoke-stage-radio ${isRadioPlaying ? "is-active" : ""}`}
            icon={Radio}
            size={24}
            label={isRadioPlaying ? "Выключить радио" : "Включить радио"}
            aria-pressed={isRadioPlaying}
            onClick={toggleRadio}
          />
        )}
      </div>

      <KaraokePerformanceStage
        currentLine={currentLine}
        currentTime={lyricTime}
        isPitchAttacking={isPitchAttacking}
        isPitchDetected={isPitchDetected}
        isPlaying={isPlaying}
        keyShift={keyShift}
        lyrics={lyrics}
        nextLine={nextLine}
        noteRangeMax={song.note_range_max}
        noteRangeMin={song.note_range_min}
        notes={notes}
        pitchRestProgress={pitchRestProgress}
        sceneBlackout={sceneBlackout}
        sceneIntroVisible={sceneIntroVisible}
        sceneIntro={{
          title: song.title,
          artist: song.artist,
          genre: song.genre,
          key: compactKey,
          tempo: currentTempo,
          difficulty: song.difficulty_override
        }}
        sceneVideoRef={sceneVideoRef}
        onSceneVideoReady={randomizeSceneVideo}
        showLyrics={showLyrics}
        showNotes={showNotes}
        songTitle={song.title}
        sungMidi={sungMidi}
        upcomingLine={upcomingLine}
      />

      <KaraokeConsole
        song={song}
        currentTime={currentTime}
        duration={duration}
        microphoneLevel={microphoneLevel}
        volumes={{
          microphone: microphoneVolume,
          music: musicVolume,
          vocal: vocalVolume,
          melody: melodyVolume
        }}
        onVolumeChange={{
          microphone: setMicrophoneVolume,
          music: setMusicVolume,
          vocal: setVocalVolume,
          melody: setMelodyVolume
        }}
        onMicrophoneCommit={(value) => updateMicrophone({ volume: value })}
        microphoneEffects={microphoneEffects}
        onEffectChange={(key, value) => {
          setEffectPreset("custom");
          setMicrophoneEffects((effects) => ({ ...effects, [key]: value }));
        }}
        isPlaying={isPlaying}
        onSkip={skip}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        currentTempo={currentTempo}
        onTempoChange={changeTempo}
        compactKey={compactKey}
        keyShift={keyShift}
        onKeyShiftChange={setKeyShift}
        microphoneOpen={microphoneOpen}
        microphoneSettingsView={microphoneSettingsView}
        showNotes={showNotes}
        onToggleNotes={() => setShowNotes((value) => !value)}
        showLyrics={showLyrics}
        onToggleLyrics={() => setShowLyrics((value) => !value)}
        onOpenAppSettings={onOpenAppSettings}
        autoHideEnabled={autoHideConsole}
        onAutoHideChange={setAutoHideConsole}
        onClose={hideControls}
        effectPreset={effectPreset}
        onApplyEffectPreset={applyEffectPreset}
        onSeek={seekTo}
      />
    </div>
  );
}
