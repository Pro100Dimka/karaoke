import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { useRadio } from "../../contexts/radio";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { getErrorMessage } from "../../utils/errors";
import useAudioOutputRouting from "./hooks/useAudioOutputRouting";
import useFullscreen from "./hooks/useFullscreen";
import useKaraokeControls from "./hooks/useKaraokeControls";
import useKaraokeHotkeys from "./hooks/useKaraokeHotkeys";
import useKaraokeMediaSync from "./hooks/useKaraokeMediaSync";
import useKaraokePreferences from "./hooks/useKaraokePreferences";
import useKaraokeResult from "./hooks/useKaraokeResult";
import useKaraokeSceneFlow from "./hooks/useKaraokeSceneFlow";
import useKaraokeStageLayout from "./hooks/useKaraokeStageLayout";
import useKaraokeTransport from "./hooks/useKaraokeTransport";
import useMelodyGuide from "./hooks/useMelodyGuide";
import useMicrophoneSettings from "./hooks/useMicrophoneSettings";
import usePitchDetection from "./hooks/usePitchDetection";
import KaraokeLoadState from "./karaoke-load-state";
import KaraokeView from "./karaoke-view";
import { getYouTubeVideoId, lyricsSyncLines, normalizeNotes, transposeKey } from "./utils/data";
import { formatCompactKey } from "./utils/display";
import { getLyricDisplayState } from "./utils/lyrics";
import { getMicrophoneLevel } from "./utils/transport";

// Lyric highlighting uses only word start/end values from lyricsSync.json.
// songMap remains independent and supplies melody notes to the editor/player.

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
  const { room: onlineRoomState, syncUi: syncRoomUi } = onlineRoom;
  const onlineParticipantCount = onlineRoom.participants.length;
  const {
    isPlaying: isRadioPlaying,
    setRecordingActive,
    toggle: toggleRadio,
    turnOff: turnOffRadio,
    turnOn: turnOnRadio
  } = useRadio();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: songs, error: songsError } = usePolling(
    api.listSongs,
    POLLING_INTERVALS.settings,
    []
  );
  const songId = location.state?.songId || null;
  const song = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || []).find((s) => s.status === "done");
  const { result, loading: resultLoading, error: resultError } = useKaraokeResult(song);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const youTubeClipRef = useRef(null);
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
  const [recordingError, setRecordingError] = useState(null);
  useEffect(() => {
    // A paused recording session must not block the background radio. Only
    // suspend radio output while karaoke playback is actually running.
    setRecordingActive(Boolean(recordingSessionId) && isPlaying);
    return () => setRecordingActive(false);
  }, [isPlaying, recordingSessionId, setRecordingActive]);
  const autoStartRequested = Boolean(location.state?.autoPlay);
  const { isFullscreen } = useFullscreen();
  const { controlsVisible, hideControls, revealControls, showControls } = useKaraokeControls({
    autoHideEnabled: autoHideConsole,
    isFullscreen
  });
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const playbackEndedRef = useRef(null);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: directOutputDevices } = usePolling(
    () => api.listAudioOutputDevices(),
    POLLING_INTERVALS.devices,
    []
  );
  const { data: audioSettings } = usePolling(
    () => api.getAudioSettings(),
    POLLING_INTERVALS.devices,
    []
  );
  const { data: signal } = usePolling(
    () => api.getSignalQuality(),
    POLLING_INTERVALS.karaokeSignal,
    []
  );
  const microphoneLevel = getMicrophoneLevel(signal);
  const microphoneSettings = useMicrophoneSettings({ audioSettings, onError: setRecordingError });
  const { microphoneVolume, setMicrophoneVolume, microphoneEffects, setMicrophoneEffects } =
    microphoneSettings;
  useEffect(() => {
    if (!onlineRoomState) return;
    syncRoomUi({ participantEffects: microphoneEffects });
  }, [microphoneEffects, onlineParticipantCount, onlineRoomState, syncRoomUi]);
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
    directOutputDeviceId,
    directOutputDevices,
    instrumentalRef,
    setDirectOutputDeviceId,
    updateMicrophone,
    videoRef,
    vocalsRef
  });
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [song?.id]);

  const songMap = result?.song_map;
  const lyrics = useMemo(() => lyricsSyncLines(result?.lyrics_sync), [result?.lyrics_sync]);
  const notes = useMemo(
    () =>
      normalizeNotes(
        Array.isArray(songMap?.display_notes)
          ? songMap.display_notes
          : (result?.game_notes ?? result?.reference_notes)
      ),
    [songMap, result]
  );
  const { startMelodyGuide, updateMelodyGuide, silenceMelodyGuide } = useMelodyGuide({
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
  const { currentLine, upcomingLine, nextLine } = getLyricDisplayState(lyrics, lyricTime);
  const { sendYouTubeCommand, syncSecondaryMedia } = useKaraokeMediaSync({
    currentTimeRef,
    instrumentalRef,
    isPlaying,
    keyShift,
    melodyVolume,
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
  const { sungMidi, isPitchDetected, isPitchAttacking, pitchRestProgress } = usePitchDetection({
    isPlaying,
    monitorInputDeviceId,
    monitoringEnabled
  });
  const { returnToLibrary, seekTo, skip, stop, togglePlay } = useKaraokeTransport({
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
  const {
    handleStop,
    handleTogglePlay,
    navigateToLibraryFromBlackout,
    revealStageActions,
    sceneBlackout,
    sceneIntroVisible,
    sceneTransitioning,
    stageActionsVisible
  } = useKaraokeSceneFlow({
    analysisRecordingIdRef,
    autoStartRequested,
    hideControls,
    instrumentalRef,
    isPlaying,
    isRadioPlaying,
    navigate,
    setRecordingActive,
    songId: song?.id,
    stop,
    togglePlay,
    turnOffRadio,
    turnOnRadio,
    vocalsRef
  });
  playbackEndedRef.current = handleStop;
  useKaraokeHotkeys({
    scopeRef: containerRef,
    currentTime,
    duration,
    onTogglePlay: handleTogglePlay,
    onSeek: seekTo,
    onStop: handleStop
  });
  useKaraokeStageLayout(containerRef);
  const isBlocked =
    Boolean(songsError) ||
    !songs ||
    !song ||
    song.status !== "done" ||
    resultLoading ||
    Boolean(resultError) ||
    !result;
  if (isBlocked) {
    return (
      <KaraokeLoadState
        songs={songs}
        songsError={songsError}
        song={song}
        songId={songId}
        result={result}
        resultLoading={resultLoading}
        resultError={resultError}
      />
    );
  }
  const rawBaseTempo = Number(result?.music?.tempo ?? song.tempo_override);
  const baseTempo = Number.isFinite(rawBaseTempo) && rawBaseTempo > 0 ? rawBaseTempo : 120;
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
    updateMicrophone({ reverb: preset.reverb, echo: preset.echo, delay: preset.delay });
  };
  const handleAnalysisClose = () => {
    updateAnalysisRecordingId(null);
    navigateToLibraryFromBlackout();
  };
  const handleEffectChange = (key, value) => {
    setEffectPreset("custom");
    setMicrophoneEffects((effects) => ({ ...effects, [key]: value }));
    updateMicrophone({ [key]: value });
  };
  const handleMonitoringChange = async (enabled) => {
    try {
      if (onlineRoomState) {
        const active = await onlineRoom.setLocalMonitoring(enabled);
        setMonitoringEnabled(enabled ? active : false);
        return;
      }
      const action = enabled ? api.startDirectMonitoring : api.stopDirectMonitoring;
      const updated = await action();
      setMonitoringEnabled(Boolean(updated?.monitoring_enabled));
      globalThis.dispatchEvent?.(new CustomEvent("audio-settings-changed", { detail: updated }));
    } catch (error) {
      setRecordingError(
        translateSaved("Не удалось изменить прослушивание микрофона: {0}", {
          0: getErrorMessage(error)
        })
      );
    }
  };
  return (
    <KaraokeView
      containerRef={containerRef}
      className={`karaoke-stage ${isPlaying ? "karaoke-is-playing" : ""} ${!controlsVisible || sceneTransitioning ? "karaoke-ui-hidden" : ""}`}
      onMouseMove={() => {
        if (sceneTransitioning) return;
        revealStageActions();
        revealControls();
      }}
      mediaProps={{
        instrumentalRef,
        isPlaying,
        musicVolume,
        sendYouTubeCommand,
        song,
        speed,
        syncSecondaryMedia,
        videoRef,
        vocalVolume,
        vocalsRef,
        youTubeClipRef,
        youTubeVideoId
      }}
      recordingError={recordingError}
      analysisRecordingId={analysisRecordingId}
      onAnalysisClose={handleAnalysisClose}
      stageActionProps={{
        autoHideConsole,
        controlsVisible,
        hideControls,
        isPlaying,
        isRadioPlaying,
        returnToLibrary,
        sceneTransitioning,
        showControls,
        stageActionsVisible,
        toggleRadio
      }}
      performanceProps={{
        currentLine,
        currentTime: lyricTime,
        isPitchAttacking,
        isPitchDetected,
        isPlaying,
        keyShift,
        lyrics,
        nextLine,
        noteRangeMax: song.note_range_max,
        noteRangeMin: song.note_range_min,
        notes,
        pitchRestProgress,
        sceneBlackout,
        sceneIntroVisible,
        sceneIntro: {
          title: song.title,
          artist: song.artist,
          genre: song.genre,
          key: compactKey,
          tempo: currentTempo,
          difficulty: song.difficulty_override
        },
        songId: song.id,
        showLyrics,
        showNotes,
        songTitle: song.title,
        sungMidi,
        upcomingLine
      }}
      consoleProps={{
        song,
        currentTime,
        duration,
        microphoneLevel,
        volumes: {
          microphone: microphoneVolume,
          music: musicVolume,
          vocal: vocalVolume,
          melody: melodyVolume
        },
        onVolumeChange: {
          microphone: setMicrophoneVolume,
          music: setMusicVolume,
          vocal: setVocalVolume,
          melody: setMelodyVolume
        },
        onMicrophoneCommit: (value) => updateMicrophone({ volume: value }),
        microphoneEffects,
        onEffectChange: handleEffectChange,
        isPlaying,
        onSkip: skip,
        onTogglePlay: handleTogglePlay,
        onStop: handleStop,
        currentTempo,
        onTempoChange: changeTempo,
        compactKey,
        keyShift,
        onKeyShiftChange: setKeyShift,
        showNotes,
        onToggleNotes: () => setShowNotes((value) => !value),
        showLyrics,
        onToggleLyrics: () => setShowLyrics((value) => !value),
        onOpenAppSettings,
        autoHideEnabled: autoHideConsole,
        onAutoHideChange: setAutoHideConsole,
        onClose: hideControls,
        effectPreset,
        onApplyEffectPreset: applyEffectPreset,
        monitoringEnabled,
        onMonitoringChange: handleMonitoringChange,
        onSeek: seekTo
      }}
    />
  );
}
