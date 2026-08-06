import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { usePolling } from "../../hooks/usePolling";
import KaraokeConsole from "./components/console";
import KaraokeMedia from "./components/karaoke-media";
import KaraokePerformanceStage from "./components/karaoke-performance-stage";
import useAudioOutputRouting from "./hooks/useAudioOutputRouting";
import useKaraokeControls from "./hooks/useKaraokeControls";
import useKaraokeHotkeys from "./hooks/useKaraokeHotkeys";
import useKaraokeMediaSync from "./hooks/useKaraokeMediaSync";
import useKaraokePanorama from "./hooks/useKaraokePanorama";
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

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
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
    setShowNotes
  } = useKaraokePreferences();
  // ВАЖНО: keyShift сейчас смещает только отображаемую линию мелодии
  // (транспонирует ноты на экране), а НЕ реальный питч аудио — честный
  // питч-шифтинг воспроизведения в браузере требует DSP-библиотеки вроде
  // SoundTouch-js/Rubberband и здесь не реализован. Если нужен настоящий
  // сдвиг тональности звука — это отдельная задача.
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const [microphoneOpen, setMicrophoneOpen] = useState(false);
  const [microphoneSettingsView, setMicrophoneSettingsView] = useState("music");
  const [recordingError, setRecordingError] = useState(null);
  const [effectPreset, setEffectPreset] = useState("studio");
  const [auroraSeed] = useState(() => Math.floor(Math.random() * 997));
  const { activeTheme, panoramaRef: panoramaSkyRef } = useKaraokePanorama(
    song?.id,
    isPlaying
  );
  const { controlsVisible, revealControls } = useKaraokeControls();
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const browserMonitorRef = useRef(null);
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

  const { returnToLibrary, seekTo, skip, stop, togglePlay } =
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
      setAnalysisRecordingId,
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

  useKaraokeHotkeys({
    currentTime,
    duration,
    onTogglePlay: togglePlay,
    onSeek: seekTo,
    onStop: stop
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
      className={`karaoke-stage ${isPlaying ? "karaoke-is-playing" : ""} ${!controlsVisible ? "karaoke-ui-hidden" : ""}`}
      onMouseMove={revealControls}
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
          onClose={() => setAnalysisRecordingId(null)}
          onDone={() => {
            setAnalysisRecordingId(null);
            navigate("/");
          }}
          onDeleted={() => {
            setAnalysisRecordingId(null);
            navigate("/");
          }}
        />
      )}

      <KaraokePerformanceStage
        activeTheme={activeTheme}
        auroraSeed={auroraSeed}
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
        panoramaRef={panoramaSkyRef}
        pitchRestProgress={pitchRestProgress}
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
        onTogglePlay={() => togglePlay()}
        onStop={() => stop()}
        currentTempo={currentTempo}
        onTempoChange={changeTempo}
        compactKey={compactKey}
        keyShift={keyShift}
        onKeyShiftChange={setKeyShift}
        microphoneOpen={microphoneOpen}
        microphoneSettingsView={microphoneSettingsView}
        onOpenEffects={() => {
          setMicrophoneSettingsView("effects");
          setMicrophoneOpen(true);
        }}
        showNotes={showNotes}
        onToggleNotes={() => setShowNotes((value) => !value)}
        showLyrics={showLyrics}
        onToggleLyrics={() => setShowLyrics((value) => !value)}
        onReturn={returnToLibrary}
        onOpenAppSettings={onOpenAppSettings}
        effectPreset={effectPreset}
        onApplyEffectPreset={applyEffectPreset}
        onSeek={seekTo}
      />
    </div>
  );
}
