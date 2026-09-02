import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { useRadio } from "../../contexts/radio";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved } from "../../i18n/runtime";
import { queryKeys } from "../../query-client";
import { POLLING_INTERVALS } from "../../runtime-config";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../../utils/audioSettingsEvents";
import { getErrorMessage } from "../../utils/errors";
import { flattenLyricsNotes, shiftLyricsSync } from "../../utils/lyrics-sync";
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

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
  const {
    room: onlineRoomState,
    setLocalMonitoring: setRoomLocalMonitoring,
    syncUi: syncRoomUi
  } = onlineRoom;
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
    [],
    { queryKey: queryKeys.songs }
  );
  const songId = location.state?.songId || null;
  const song = useRoutedSong(songs, songId);
  const { result, loading: resultLoading, error: resultError } = useKaraokeResult(song);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const playback = usePlaybackMachine();
  const { isPlaying } = playback;
  const resetPlayback = playback.reset;
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const karaokePreferences = useKaraokePreferences();
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
  } = karaokePreferences;
  useKaraokeRoomPreferences({
    participantCount: onlineParticipantCount,
    preferences: karaokePreferences,
    room: onlineRoomState,
    roomUi: onlineRoom.roomUi,
    syncUi: syncRoomUi
  });
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
  const roomPrepared = Boolean(location.state?.roomPrepared);
  const { controlsVisible, hideControls, revealControls, showControls } = useKaraokeControls({
    autoHideEnabled: autoHideConsole
  });
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const playbackEndedRef = useRef(null);
  const effectPresetMutationRef = useRef(0);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: directOutputDevices } = usePolling(
    () => api.listAudioOutputDevices(),
    POLLING_INTERVALS.devices,
    [],
    { queryKey: ["audio-output-devices"] }
  );
  const { data: audioSettings } = usePolling(
    () => api.getAudioSettings(),
    POLLING_INTERVALS.devices,
    [],
    { queryKey: queryKeys.audioSettings }
  );
  const { data: signal } = usePolling(
    () => api.getSignalQuality(),
    POLLING_INTERVALS.karaokeSignal,
    [],
    { queryKey: ["signal-quality"] }
  );
  const microphoneLevel = getMicrophoneLevel(signal);
  const microphoneSettings = useMicrophoneSettings({ audioSettings, onError: setRecordingError });
  const { microphoneVolume, setMicrophoneVolume, microphoneEffects, setMicrophoneEffects } =
    microphoneSettings;
  useKaraokeRoomEffects({
    room: onlineRoomState,
    participantCount: onlineParticipantCount,
    volume: microphoneVolume,
    effects: microphoneEffects,
    syncUi: syncRoomUi
  });
  const {
    audioDriver,
    directOutputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled,
    setMonitoringEnabled,
    monitorInputDeviceId
  } = microphoneSettings;
  const { updateMicrophone, updateMicrophoneEffects } = microphoneSettings;
  const [roomMonitoringEnabled, setRoomMonitoringEnabled] = useState(false);
  const effectiveMonitoringEnabled = onlineRoomState ? roomMonitoringEnabled : monitoringEnabled;
  const monitoringEnabledRef = useRef(monitoringEnabled);
  monitoringEnabledRef.current = monitoringEnabled;
  const releaseMonitoring = useCallback(async () => {
    if (roomMonitoringEnabled) {
      await setRoomLocalMonitoring(false);
      setRoomMonitoringEnabled(false);
    }
    if (!monitoringEnabledRef.current) return null;
    const updated = await api.stopDirectMonitoring();
    monitoringEnabledRef.current = false;
    setMonitoringEnabled(false);
    globalThis.dispatchEvent?.(new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail: updated }));
    return updated;
  }, [roomMonitoringEnabled, setMonitoringEnabled, setRoomLocalMonitoring]);
  useEffect(
    () => () => {
      // Back, window navigation and error exits must also release the native
      // output device so Library recordings can play immediately.
      if (monitoringEnabledRef.current) api.releaseDirectMonitoring();
      setRoomLocalMonitoring(false);
    },
    [setRoomLocalMonitoring]
  );
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
    resetPlayback();
    setCurrentTime(0);
    setDuration(0);
  }, [resetPlayback, song?.id]);

  const lyricsSync = result?.lyrics_sync;
  const sourceNotes = useMemo(() => flattenLyricsNotes(lyricsSync), [lyricsSync]);
  const timingPreferenceKey = [
    song?.id ?? "",
    lyricsSync?.bpm ?? "",
    lyricsSync?.duration ?? "",
    lyricsSync?.words?.[0]?.start ?? ""
  ].join("|");
  const embeddedLyricsOffset = Math.max(
    -10,
    Math.min(10, Number(lyricsSync?.alignment?.offset_seconds) || 0)
  );
  const savedLyricsOffset = Number(timingOffsets?.[timingPreferenceKey]);
  const lyricsOffset = Number.isFinite(savedLyricsOffset)
    ? savedLyricsOffset
    : embeddedLyricsOffset;
  const runtimeLyricsOffset = lyricsOffset - embeddedLyricsOffset;
  const displayLyricsSync = useMemo(
    () => shiftLyricsSync(lyricsSync, runtimeLyricsOffset),
    [lyricsSync, runtimeLyricsOffset]
  );
  const displayNotes = useMemo(() => flattenLyricsNotes(displayLyricsSync), [displayLyricsSync]);
  const { startMelodyGuide, updateMelodyGuide, silenceMelodyGuide } = useMelodyGuide({
    notes: sourceNotes,
    volume: melodyVolume,
    keyShift,
    currentTimeRef
  });
  const [clipAvailable, setClipAvailable] = useState(false);
  useEffect(() => setClipAvailable(false), [song?.id, song?.video_url]);

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
    setIsPlaying: playback.setPlaying,
    silenceMelodyGuide,
    songId: song?.id,
    speed,
    startMelodyGuide,
    updateMelodyGuide,
    videoRef,
    vocalVolume,
    vocalsRef
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
    setIsPlaying: playback.setPlaying,
    playback,
    releaseMonitoring,
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
    roomPrepared,
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
  const rawBaseTempo = Number(lyricsSync?.bpm);
  const baseTempo = Number.isFinite(rawBaseTempo) && rawBaseTempo > 0 ? rawBaseTempo : 120;
  const currentTempo = Math.max(1, Math.round(baseTempo * speed));
  const compactKey = formatCompactKey(transposeKey(lyricsSync.key, keyShift));
  const changeTempo = (delta) => {
    const nextTempo = Math.max(1, currentTempo + delta);
    setSpeed(Math.max(0.5, Math.min(1.5, nextTempo / baseTempo)));
  };
  const changeLyricsOffset = (value) => {
    const next = Math.max(-10, Math.min(10, Math.round(Number(value) * 10) / 10));
    if (!Number.isFinite(next) || !song?.id) return;
    setTimingOffsets({ ...timingOffsets, [timingPreferenceKey]: next });
  };
  const applyEffectPreset = async (preset) => {
    const previousPreset = effectPreset;
    const mutationSequence = effectPresetMutationRef.current + 1;
    effectPresetMutationRef.current = mutationSequence;
    setEffectPreset(preset.id);
    const updated = await updateMicrophoneEffects({
      reverb: preset.reverb,
      echo: preset.echo,
      delay: preset.delay
    });
    if (updated === null && mutationSequence === effectPresetMutationRef.current) {
      setEffectPreset(previousPreset);
    }
  };
  const handleAnalysisClose = () => {
    updateAnalysisRecordingId(null);
    navigateToLibraryFromBlackout();
  };
  const handleEffectChange = (key, value) => {
    setMicrophoneEffects((effects) => ({ ...effects, [key]: value }));
  };
  const handleEffectCommit = async (key, value) => {
    const previousPreset = effectPreset;
    const mutationSequence = effectPresetMutationRef.current + 1;
    effectPresetMutationRef.current = mutationSequence;
    setEffectPreset("custom");
    const updated = await updateMicrophoneEffects({ [key]: value });
    if (updated === null && mutationSequence === effectPresetMutationRef.current) {
      setEffectPreset(previousPreset);
    }
  };
  const handleMonitoringChange = async (enabled) => {
    try {
      if (onlineRoomState) {
        // The room already owns a realtime, processed microphone stream.
        // Monitoring that stream in Web Audio avoids a second capture and the
        // large Windows/PortAudio round trip heard on ordinary USB headsets.
        if (monitoringEnabledRef.current) {
          const updated = await api.stopDirectMonitoring();
          monitoringEnabledRef.current = false;
          setMonitoringEnabled(false);
          globalThis.dispatchEvent?.(
            new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail: updated })
          );
        }
        const active = await setRoomLocalMonitoring(enabled, {
          volume: microphoneVolume,
          ...microphoneEffects
        });
        setRoomMonitoringEnabled(active);
        return;
      }
      const action = enabled ? api.startDirectMonitoring : api.stopDirectMonitoring;
      const updated = await action();
      setMonitoringEnabled(Boolean(updated?.monitoring_enabled));
      globalThis.dispatchEvent?.(
        new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail: updated })
      );
    } catch (error) {
      setRecordingError(
        translateSaved("karaoke.failedToChangeMicrophoneListening", {
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
        if (sceneTransitioning) return;
        if (!revealControls(event)) return;
        revealStageActions();
      }}
      mediaProps={{
        instrumentalRef,
        isPlaying,
        musicVolume,
        song,
        speed,
        syncSecondaryMedia,
        videoRef,
        vocalVolume,
        vocalsRef,
        onClipAvailabilityChange: setClipAvailable
      }}
      recordingError={recordingError || karaokePreferences.persistenceError}
      analysisRecordingId={analysisRecordingId}
      onAnalysisClose={handleAnalysisClose}
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
        getLocalVoiceStream: onlineRoomState ? onlineRoom.getLocalVoiceStream : undefined,
        currentTime,
        currentTimeRef,
        isPlaying,
        keyShift,
        lyricsSync: displayLyricsSync,
        monitorInputDeviceId,
        monitoringEnabled: effectiveMonitoringEnabled,
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
        microphoneLevel,
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
        onEffectChange: handleEffectChange,
        onEffectCommit: handleEffectCommit,
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
        onApplyEffectPreset: applyEffectPreset,
        monitoringEnabled: effectiveMonitoringEnabled,
        onMonitoringChange: handleMonitoringChange,
        onSeek: seekTo
      }}
    />
  );
}
