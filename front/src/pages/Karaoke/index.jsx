import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { useRadio } from "../../contexts/radio";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved as t } from "../../i18n/runtime";
import { queryKeys } from "../../query-client";
import { POLLING_INTERVALS } from "../../runtime-config";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../../utils/audioSettingsEvents";
import { getErrorMessage } from "../../utils/errors";
import { flattenLyricsNotes, shiftLyricsSync } from "../../utils/lyrics-sync";
import { clamp } from "../../utils/math";
import useAudioOutputRouting from "./hooks/useAudioOutputRouting";
import useKaraokeControls from "./hooks/useKaraokeControls";
import useKaraokeHotkeys from "./hooks/useKaraokeHotkeys";
import useKaraokeMediaSync from "./hooks/useKaraokeMediaSync";
import useKaraokePreferences from "./hooks/useKaraokePreferences";
import useKaraokeResult from "./hooks/useKaraokeResult";
import useKaraokeRoomEffects from "./hooks/useKaraokeRoomEffects";
import useKaraokeRoomPreferences from "./hooks/useKaraokeRoomPreferences";
import useKaraokeSceneFlow from "./hooks/useKaraokeSceneFlow";
import useKaraokeStageLayout from "./hooks/useKaraokeStageLayout";
import useKaraokeTransport from "./hooks/useKaraokeTransport";
import useMelodyGuide from "./hooks/useMelodyGuide";
import useMicrophoneSettings from "./hooks/useMicrophoneSettings";
import usePlaybackMachine from "./hooks/usePlaybackMachine";
import useRoutedSong from "./hooks/useRoutedSong";
import KaraokeLoadState from "./karaoke-load-state";
import KaraokeView from "./karaoke-view";
import { transposeKey } from "./utils/data";
import { formatCompactKey } from "./utils/display";
import { getMicrophoneLevel } from "./utils/transport";

const noop = () => {};

const usePoll = (request, interval, queryKey) => usePolling(request, interval, [], { queryKey });

function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const notifyAudio = (detail) =>
  globalThis.dispatchEvent?.(new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail }));

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
  const { room, roomUi, participants = [], setLocalMonitoring, syncUi } = onlineRoom;
  const roomProps = { room, participantCount: participants.length, syncUi };

  const {
    isPlaying: isRadioPlaying,
    setRecordingActive,
    toggle: toggleRadio,
    turnOff: turnOffRadio,
    turnOn: turnOnRadio
  } = useRadio();

  const location = useLocation();
  const navigate = useNavigate();

  const { data: songs, error: songsError } = usePoll(
    api.listSongs,
    POLLING_INTERVALS.settings,
    queryKeys.songs
  );

  const songId = location.state?.songId ?? null;
  const song = useRoutedSong(songs, songId);
  const { result, loading: resultLoading, error: resultError } = useKaraokeResult(song);
  const lyricsSync = result?.lyrics_sync;

  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const playbackEndedRef = useRef(null);
  const effectMutationRef = useRef(0);
  const mediaRefs = { instrumentalRef, vocalsRef, videoRef };

  const playback = usePlaybackMachine();
  const { isPlaying, reset: resetPlayback, setPlaying } = playback;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentTimeRef = useLatest(currentTime);
  const durationRef = useLatest(duration);

  const preferences = useKaraokePreferences();
  const {
    musicVolume,
    setMusicVolume,
    vocalVolume,
    setVocalVolume,
    melodyVolume,
    setMelodyVolume,
    previewPreference,
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
    setEffectPreset,
    timingOffsets,
    setTimingOffsets
  } = preferences;

  useKaraokeRoomPreferences({ ...roomProps, preferences, roomUi });

  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const [recordingError, setRecordingError] = useState(null);
  const analysisRecordingIdRef = useRef(null);

  const setAnalysisId = useCallback((value) => {
    setAnalysisRecordingId((previous) => {
      const next = typeof value === "function" ? value(previous) : value;
      analysisRecordingIdRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    setRecordingActive(Boolean(recordingSessionId) && isPlaying);
    return () => setRecordingActive(false);
  }, [isPlaying, recordingSessionId, setRecordingActive]);

  const { controlsVisible, hideControls, revealControls, showControls } = useKaraokeControls({
    autoHideEnabled: autoHideConsole
  });

  const { data: directOutputDevices } = usePoll(
    api.listAudioOutputDevices,
    POLLING_INTERVALS.devices,
    ["audio-output-devices"]
  );

  const { data: audioSettings } = usePoll(
    api.getAudioSettings,
    POLLING_INTERVALS.devices,
    queryKeys.audioSettings
  );

  const { data: signal } = usePoll(api.getSignalQuality, POLLING_INTERVALS.karaokeSignal, [
    "signal-quality"
  ]);

  const {
    audioDriver,
    directOutputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled,
    setMonitoringEnabled,
    monitorInputDeviceId,
    microphoneVolume,
    setMicrophoneVolume,
    microphoneEffects,
    setMicrophoneEffects,
    updateMicrophone,
    updateMicrophoneEffects
  } = useMicrophoneSettings({ audioSettings, onError: setRecordingError });

  useKaraokeRoomEffects({
    ...roomProps,
    volume: microphoneVolume,
    effects: microphoneEffects
  });

  const monitoringRef = useLatest(monitoringEnabled);
  const [roomMonitoring, setRoomMonitoring] = useState(false);
  const effectiveMonitoring = room ? roomMonitoring : monitoringEnabled;

  const setNativeMonitoring = useCallback(
    (updated) => {
      const enabled = Boolean(updated?.monitoring_enabled);

      monitoringRef.current = enabled;
      setMonitoringEnabled(enabled);
      notifyAudio(updated);

      return updated;
    },
    [setMonitoringEnabled]
  );

  const releaseMonitoring = useCallback(async () => {
    if (roomMonitoring) {
      setRoomMonitoring(false);
      await Promise.resolve(setLocalMonitoring(false)).catch(noop);
    }

    return monitoringRef.current ? setNativeMonitoring(await api.stopDirectMonitoring()) : null;
  }, [roomMonitoring, setLocalMonitoring, setNativeMonitoring]);

  useEffect(() => {
    if (!room) setRoomMonitoring(false);
  }, [room]);

  useEffect(
    () => () => {
      if (monitoringRef.current) Promise.resolve(api.releaseDirectMonitoring()).catch(noop);
      Promise.resolve(setLocalMonitoring(false)).catch(noop);
    },
    [setLocalMonitoring]
  );

  useAudioOutputRouting({
    ...mediaRefs,
    audioDriver,
    audioSettings,
    directOutputDeviceId,
    directOutputDevices,
    setDirectOutputDeviceId,
    updateMicrophone
  });

  useEffect(() => {
    resetPlayback();
    setCurrentTime(0);
    setDuration(0);
  }, [resetPlayback, song?.id]);

  const sourceNotes = useMemo(() => flattenLyricsNotes(lyricsSync), [lyricsSync]);

  const timingKey = [
    song?.id ?? "",
    lyricsSync?.bpm ?? "",
    lyricsSync?.duration ?? "",
    lyricsSync?.words?.[0]?.start ?? ""
  ].join("|");

  const embeddedOffset = clamp(Number(lyricsSync?.alignment?.offset_seconds) || 0, -10, 10);
  const savedOffset = Number(timingOffsets?.[timingKey]);
  const lyricsOffset = Number.isFinite(savedOffset) ? savedOffset : embeddedOffset;
  const runtimeOffset = lyricsOffset - embeddedOffset;

  const displayLyricsSync = useMemo(
    () => shiftLyricsSync(lyricsSync, runtimeOffset),
    [lyricsSync, runtimeOffset]
  );

  const displayNotes = useMemo(() => flattenLyricsNotes(displayLyricsSync), [displayLyricsSync]);

  const { startMelodyGuide, updateMelodyGuide, silenceMelodyGuide } = useMelodyGuide({
    notes: sourceNotes,
    volume: melodyVolume,
    keyShift,
    currentTimeRef
  });

  const [clipAvailable, setClipAvailable] = useState(false);

  useEffect(() => {
    setClipAvailable(false);
  }, [song?.id, song?.video_url]);

  const { sendYouTubeCommand, syncSecondaryMedia } = useKaraokeMediaSync({
    ...mediaRefs,
    currentTimeRef,
    isPlaying,
    keyShift,
    melodyVolume,
    musicVolume,
    onPlaybackEndedRef: playbackEndedRef,
    setCurrentTime,
    setDuration,
    setIsPlaying: setPlaying,
    silenceMelodyGuide,
    songId: song?.id,
    speed,
    startMelodyGuide,
    updateMelodyGuide,
    vocalVolume
  });

  const { returnToLibrary, seekTo, skip, stop, togglePlay } = useKaraokeTransport({
    ...mediaRefs,
    currentTime,
    duration,
    durationRef,
    isPlaying,
    microphoneEffects,
    microphoneVolume,
    musicVolume,
    speed,
    navigate,
    onlineRoom,
    recordingSessionId,
    sendYouTubeCommand,
    setAnalysisRecordingId: setAnalysisId,
    setCurrentTime,
    setIsPlaying: setPlaying,
    playback,
    releaseMonitoring,
    setRecordingError,
    setRecordingSessionId,
    silenceMelodyGuide,
    song,
    startMelodyGuide,
    syncSecondaryMedia,
    vocalVolume
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
    autoStartRequested: Boolean(location.state?.autoPlay),
    roomPrepared: Boolean(location.state?.roomPrepared),
    hideControls,
    instrumentalRef,
    isPlaying,
    isRadioPlaying,
    navigate,
    returnToLibrary,
    setRecordingActive,
    showControls,
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

  if (
    songsError ||
    !songs ||
    !song ||
    song.status !== "done" ||
    resultLoading ||
    resultError ||
    !result
  ) {
    return (
      <KaraokeLoadState
        {...{ songs, songsError, song, songId, result, resultLoading, resultError }}
      />
    );
  }

  const bpm = Number(lyricsSync?.bpm);
  const baseTempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const currentTempo = Math.max(1, Math.round(baseTempo * (Number(speed) || 1)));

  const compactKey = lyricsSync?.key
    ? formatCompactKey(transposeKey(lyricsSync.key, keyShift))
    : "";

  const changeTempo = (delta) => {
    setSpeed(clamp((currentTempo + delta) / baseTempo, 0.5, 1.5));
  };

  const changeLyricsOffset = (value) => {
    const next = clamp(Math.round(Number(value) * 10) / 10, -10, 10);
    if (Number.isFinite(next)) setTimingOffsets({ ...timingOffsets, [timingKey]: next });
  };

  const saveEffects = async (preset, effects) => {
    const previous = effectPreset;
    const sequence = ++effectMutationRef.current;

    setEffectPreset(preset);

    if (
      (await updateMicrophoneEffects(effects)) === null &&
      sequence === effectMutationRef.current
    ) {
      setEffectPreset(previous);
    }
  };

  const handleMonitoringChange = async (enabled) => {
    try {
      if (room) {
        if (monitoringRef.current) {
          setNativeMonitoring(await api.stopDirectMonitoring());
        }

        const active = await setLocalMonitoring(enabled, {
          volume: microphoneVolume,
          ...microphoneEffects
        });

        setRoomMonitoring(Boolean(active));
        return;
      }

      setNativeMonitoring(
        await (enabled ? api.startDirectMonitoring() : api.stopDirectMonitoring())
      );
    } catch (error) {
      setRecordingError(
        t("karaoke.failedToChangeMicrophoneListening", {
          0: getErrorMessage(error)
        })
      );
    }
  };

  return (
    <KaraokeView
      containerRef={containerRef}
      isPlaying={isPlaying}
      controlsVisible={controlsVisible && !sceneTransitioning}
      onMouseMove={(event) => {
        if (!sceneTransitioning && revealControls(event)) revealStageActions();
      }}
      mediaProps={{
        ...mediaRefs,
        isPlaying,
        musicVolume,
        song,
        speed,
        syncSecondaryMedia,
        vocalVolume,
        onClipAvailabilityChange: setClipAvailable
      }}
      recordingError={recordingError || preferences.persistenceError}
      analysisRecordingId={analysisRecordingId}
      onAnalysisClose={() => {
        setAnalysisId(null);
        navigateToLibraryFromBlackout();
      }}
      stageActionProps={{
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
        getLocalVoiceStream: room ? onlineRoom.getLocalVoiceStream : undefined,
        currentTime,
        currentTimeRef,
        isPlaying,
        keyShift,
        lyricsSync: displayLyricsSync,
        monitorInputDeviceId,
        monitoringEnabled: effectiveMonitoring,
        hasSongClip: clipAvailable,
        notes: displayNotes,
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
        showNotes
      }}
      consoleProps={{
        song,
        currentTime,
        duration,
        microphoneLevel: getMicrophoneLevel(signal),
        volumes: {
          microphone: microphoneVolume,
          music: musicVolume,
          vocal: vocalVolume,
          melody: melodyVolume
        },
        onVolumeChange: {
          microphone: setMicrophoneVolume,
          music: (value) => previewPreference("musicVolume", value),
          vocal: (value) => previewPreference("vocalVolume", value),
          melody: (value) => previewPreference("melodyVolume", value)
        },
        onVolumeCommit: {
          microphone: (value) => updateMicrophone({ volume: value }),
          music: setMusicVolume,
          vocal: setVocalVolume,
          melody: setMelodyVolume
        },
        microphoneEffects,
        onEffectChange: (key, value) =>
          setMicrophoneEffects((effects) => ({ ...effects, [key]: value })),
        onEffectCommit: (key, value) => saveEffects("custom", { [key]: value }),
        isPlaying,
        onSkip: skip,
        onTogglePlay: handleTogglePlay,
        onStop: handleStop,
        currentTempo,
        onTempoChange: changeTempo,
        compactKey,
        keyShift,
        onKeyShiftChange: setKeyShift,
        lyricsOffset,
        onLyricsOffsetChange: changeLyricsOffset,
        showNotes,
        onToggleNotes: () => setShowNotes(!showNotes),
        showLyrics,
        onToggleLyrics: () => setShowLyrics(!showLyrics),
        onOpenAppSettings,
        autoHideEnabled: autoHideConsole,
        onAutoHideChange: setAutoHideConsole,
        onClose: hideControls,
        effectPreset,
        onApplyEffectPreset: ({ id, echo, reverb, delay }) =>
          saveEffects(id, { echo, reverb, delay }),
        monitoringEnabled: effectiveMonitoring,
        onMonitoringChange: handleMonitoringChange,
        onSeek: seekTo
      }}
    />
  );
}
