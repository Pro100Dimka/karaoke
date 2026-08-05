import {
  ArrowLeft,
  AudioLines,
  Cog,
  Maximize,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Type,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { KARAOKE_THEMES, shuffleThemes } from "../../assets/karaoke/themes";
import Dropdown from "../../components/fields/dropdown";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { usePolling } from "../../hooks/usePolling";
import { getErrorMessage } from "../../utils/errors";
import KaraokeLyricLine from "./components/KaraokeLyricLine";
import MelodyRoll from "./components/MelodyRoll";
import MonitoringModePicker from "./components/MonitoringModePicker";
import PerformanceAnalysisModal from "./components/PerformanceAnalysisModal";
import SliderField from "./components/SliderField";
import WaveformTimeline from "./components/WaveformTimeline";
import { MONITORING_MODES } from "./config";
import useKaraokePreferences from "./hooks/useKaraokePreferences";
import useKaraokeResult from "./hooks/useKaraokeResult";
import {
  findMatchingBrowserOutput,
  findPreferredOutputDevice,
  groupBrowserAudioDevices,
  normalizeAudioEffects
} from "./utils/audio-settings";
import {
  createPanoramaPath,
  getYouTubeVideoId,
  normalizeLyrics,
  normalizeNotes,
  playbackGain,
  transposeKey,
  youTubeEmbedUrl
} from "./utils/data";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "./utils/devices";
import { formatTime } from "./utils/format";
import { getKaraokeStageLayout } from "./utils/layout";
import { getLyricDisplayState } from "./utils/lyrics";
import { getMelodyGuideState } from "./utils/melody-guide";
import { getPanoramaPosition } from "./utils/panorama";
import { detectMidiFromAnalyser } from "./utils/pitch";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "./utils/transport";

// Karaoke data is normalized at the UI boundary so playback and visual
// components operate on one predictable shape. Pure transformations live in
// utils/data.js and are covered by regression tests.

export default function Karaoke({ onOpenAppSettings }) {
  const onlineRoom = useOnlineRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: songs } = usePolling(api.listSongs, 15000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || []).find((s) => s.status === "done");

  const result = useKaraokeResult(song);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const youTubeClipRef = useRef(null);
  const containerRef = useRef(null);
  const melodyGuideRef = useRef(null);
  const melodyNotesRef = useRef([]);
  const melodyVolumeRef = useRef(0);
  const melodyKeyShiftRef = useRef(0);
  const transportOperationRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [sungMidi, setSungMidi] = useState(null);
  const [isPitchDetected, setIsPitchDetected] = useState(false);
  const [isPitchAttacking, setIsPitchAttacking] = useState(false);
  const [pitchRestProgress, setPitchRestProgress] = useState(1);
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
  const [recordingError, setRecordingError] = useState(null);
  const [microphoneVolume, setMicrophoneVolume] = useState(1);
  const [microphoneEffects, setMicrophoneEffects] = useState({
    reverb: 0,
    echo: 0,
    delay: 0
  });
  const [microphoneControlsOpen, setMicrophoneControlsOpen] = useState(false);
  const [audioDriver, setAudioDriver] = useState("auto");
  const [asioDriverName, setAsioDriverName] = useState("");
  const [audioBufferSize, setAudioBufferSize] = useState(64);
  const [directOutputDeviceId, setDirectOutputDeviceId] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [browserAudioDevices, setBrowserAudioDevices] = useState({
    inputs: [],
    outputs: []
  });
  const [monitorInputDeviceId, setMonitorInputDeviceId] = useState("default");
  const [monitorOutputDeviceId, setMonitorOutputDeviceId] = useState("default");
  const [monitorLatencyHint, setMonitorLatencyHint] = useState("interactive");
  const [monitorMode, setMonitorMode] = useState("direct");
  const [monitorModeOpen, setMonitorModeOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [auroraSeed] = useState(() => Math.floor(Math.random() * 997));
  const themeQueueRef = useRef(shuffleThemes());
  const appliedThemeSongRef = useRef(song?.id);
  const [activeTheme, setActiveTheme] = useState(
    () => themeQueueRef.current.pop() || KARAOKE_THEMES[0]
  );
  const panoramaSkyRef = useRef(null);
  const panoramaClockRef = useRef(0);
  const panoramaPathRef = useRef(createPanoramaPath());
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const controlsTimerRef = useRef(null);
  const lastControlsActivityRef = useRef(Date.now());
  const microphoneVolumeInitializedRef = useRef(false);
  const microphoneEffectsInitializedRef = useRef(false);
  const browserMonitorRef = useRef(null);
  const manualMonitoringRef = useRef(false);
  const monitorModeMenuRef = useRef(null);
  const lastSecondarySyncRef = useRef(0);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: devices } = usePolling(
    () => (microphoneOpen ? api.listAudioDevices() : Promise.resolve([])),
    30000,
    [microphoneOpen]
  );
  const { data: directOutputDevices } = usePolling(
    () => (microphoneOpen ? api.listAudioOutputDevices() : Promise.resolve([])),
    30000,
    [microphoneOpen]
  );
  const { data: asioDrivers } = usePolling(
    () => (microphoneOpen ? api.listAsioDrivers() : Promise.resolve([])),
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

  useEffect(() => {
    if (!song?.id || appliedThemeSongRef.current === song.id) return;
    appliedThemeSongRef.current = song.id;

    if (!themeQueueRef.current.length) {
      themeQueueRef.current = shuffleThemes();
    }
    setActiveTheme(themeQueueRef.current.pop() || KARAOKE_THEMES[0]);
    panoramaClockRef.current = 0;
    panoramaPathRef.current = createPanoramaPath();
  }, [song?.id]);

  useEffect(() => {
    const panorama = panoramaSkyRef.current;
    if (!panorama || !isPlaying) return undefined;
    let frameId;
    const startedAt = performance.now() - panoramaClockRef.current;
    const path = panoramaPathRef.current;
    // Background panoramas are decorative. Keep camera drift slow enough that
    // the visual scene feels alive without competing with lyrics or causing
    // motion discomfort during a full song.
    const cycleMs = 240_000;

    const move = (now) => {
      const elapsed = now - startedAt;
      // Integer harmonics make the 240-second path closed: frame 0 and the
      // final frame have identical position and velocity, so no loop is seen.
      const { x, y } = getPanoramaPosition(elapsed, cycleMs, path);
      panorama.style.setProperty("--panorama-x", `-${x.toFixed(3)}cqh`);
      panorama.style.setProperty("--panorama-y", `${y.toFixed(3)}%`);
      panoramaClockRef.current = elapsed;
      frameId = requestAnimationFrame(move);
    };

    frameId = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  useEffect(() => {
    if (
      audioSettings?.volume != null &&
      !microphoneVolumeInitializedRef.current
    ) {
      microphoneVolumeInitializedRef.current = true;
      setMicrophoneVolume(audioSettings.volume);
    }
  }, [audioSettings?.volume]);

  useEffect(() => {
    if (!audioSettings || microphoneEffectsInitializedRef.current) return;
    microphoneEffectsInitializedRef.current = true;
    setMicrophoneEffects(normalizeAudioEffects(audioSettings));
  }, [audioSettings]);

  useEffect(() => {
    if (audioSettings?.audio_driver) setAudioDriver(audioSettings.audio_driver);
    if (audioSettings?.asio_driver_name)
      setAsioDriverName(audioSettings.asio_driver_name);
    if (audioSettings?.buffer_size)
      setAudioBufferSize(audioSettings.buffer_size);
    if (audioSettings?.monitoring_enabled != null)
      setMonitoringEnabled(audioSettings.monitoring_enabled);
  }, [
    audioSettings?.audio_driver,
    audioSettings?.asio_driver_name,
    audioSettings?.buffer_size,
    audioSettings?.monitoring_enabled
  ]);

  useEffect(() => {
    setDirectOutputDeviceId(audioSettings?.output_device_id ?? "");
  }, [audioSettings?.output_device_id]);

  // Keep browser playback on the same physical interface as the ASIO monitor.
  // The ASIO bridge handles the microphone; HTML media uses the matching
  // Windows endpoint so both are heard through the Audient headphones output.
  useEffect(() => {
    if (
      !microphoneOpen ||
      audioDriver !== "asio" ||
      audioSettings?.output_device_id != null
    )
      return;
    const preferred = findPreferredOutputDevice(directOutputDevices);
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      updateMicrophone({ output_device_id: preferred.index });
    }
  }, [
    audioDriver,
    audioSettings?.output_device_id,
    directOutputDevices,
    directOutputDeviceId,
    microphoneOpen
  ]);

  useEffect(() => {
    if (
      !microphoneOpen ||
      !directOutputDeviceId ||
      !navigator.mediaDevices?.enumerateDevices
    )
      return;
    const selected = (directOutputDevices || []).find(
      (device) => String(device.index) === String(directOutputDeviceId)
    );
    if (!selected) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((entries) => {
        const output = findMatchingBrowserOutput(entries, selected);
        if (!output?.deviceId) return;
        [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
          (media) => media?.setSinkId?.(output.deviceId).catch(() => {})
        );
      })
      .catch(() => {});
  }, [directOutputDevices, directOutputDeviceId, microphoneOpen]);

  useEffect(
    () => () => {
      const monitor = browserMonitorRef.current;
      monitor?.stream.getTracks().forEach((track) => track.stop());
      monitor?.context.close();
      browserMonitorRef.current = null;
      const guide = melodyGuideRef.current;
      guide?.oscillator.stop();
      guide?.context.close();
      melodyGuideRef.current = null;
    },
    []
  );

  useEffect(() => {
    // Do not put this request in the component cleanup: React development
    // mode deliberately runs cleanups once while mounting.  That could race
    // with Play.  ``pagehide`` runs only for a real window/page shutdown.
    const releaseMonitorOnClose = () => {
      api.releaseDirectMonitoring();
    };
    window.addEventListener("pagehide", releaseMonitorOnClose);
    return () => window.removeEventListener("pagehide", releaseMonitorOnClose);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!monitorModeMenuRef.current?.contains(event.target))
        setMonitorModeOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMonitorModeOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!microphoneOpen || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((mediaDevices) => {
        setBrowserAudioDevices(groupBrowserAudioDevices(mediaDevices));
      })
      .catch(() => {});
  }, [microphoneOpen]);

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
  melodyNotesRef.current = notes;
  melodyVolumeRef.current = melodyVolume;
  melodyKeyShiftRef.current = keyShift;
  const youTubeVideoId = getYouTubeVideoId(song?.video_url);

  // Lyrics and melody use the same instrumental clock.  A former global
  // "anchor" delay shifted every word by up to half a second even when the
  // word-level alignment was already correct for the current song.
  const lyricTime = currentTime;

  const { currentLine, upcomingLine, nextLine } = getLyricDisplayState(
    lyrics,
    lyricTime
  );

  const sendYouTubeCommand = (func, args = []) => {
    youTubeClipRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  };

  const syncSecondaryMedia = (position, force = false) => {
    [vocalsRef.current, videoRef.current].forEach((media) => {
      if (!media || !Number.isFinite(media.duration)) return;
      if (force || shouldSyncMedia(media.currentTime, position)) {
        media.currentTime = getSecondaryMediaPosition(position, media.duration);
      }
    });
    if (force) sendYouTubeCommand("seekTo", [position, true]);
  };

  function updateMelodyGuide(position) {
    const guide = melodyGuideRef.current;
    if (!guide || guide.context.state === "closed") return;

    const now = guide.context.currentTime;
    const state = getMelodyGuideState({
      notes: melodyNotesRef.current,
      position,
      keyShift: melodyKeyShiftRef.current,
      volume: melodyVolumeRef.current
    });
    if (!state.active) {
      guide.gain.gain.setTargetAtTime(state.gain, now, 0.018);
      return;
    }

    guide.oscillator.frequency.setTargetAtTime(state.frequency, now, 0.012);
    guide.gain.gain.setTargetAtTime(state.gain, now, 0.015);
  }

  async function startMelodyGuide() {
    if (melodyVolumeRef.current <= 0 || !melodyNotesRef.current.length) return;

    let guide = melodyGuideRef.current;
    if (!guide || guide.context.state === "closed") {
      const context = new AudioContext({ latencyHint: "interactive" });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      guide = { context, oscillator, gain };
      melodyGuideRef.current = guide;
    }
    await guide.context.resume();
    updateMelodyGuide(currentTimeRef.current);
  }

  function silenceMelodyGuide() {
    const guide = melodyGuideRef.current;
    if (guide && guide.context.state !== "closed") {
      const now = guide.context.currentTime;
      guide.gain.gain.cancelScheduledValues(now);
      guide.gain.gain.setValueAtTime(0.0001, now);
    }
  }

  // Instrumental is the single time source. Vocal and video are gently
  // corrected from it so seeking and long playback cannot accumulate drift.
  useEffect(() => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return undefined;
    const onLoadedMeta = () => setDuration(instr.duration || 0);
    const onEnded = () => {
      // The instrumental track owns the transport clock. Do not let vocals,
      // video, or the synthetic melody continue after that clock has ended.
      voc.pause();
      videoRef.current?.pause();
      sendYouTubeCommand("pauseVideo");
      silenceMelodyGuide();
      setIsPlaying(false);
    };
    instr.addEventListener("loadedmetadata", onLoadedMeta);
    instr.addEventListener("ended", onEnded);
    return () => {
      instr.removeEventListener("loadedmetadata", onLoadedMeta);
      instr.removeEventListener("ended", onEnded);
    };
  }, [song?.id]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let animationFrameId;
    const updatePosition = () => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position)) {
        setCurrentTime(position);
        updateMelodyGuide(position);
        if (performance.now() - lastSecondarySyncRef.current > 450) {
          syncSecondaryMedia(position);
          lastSecondarySyncRef.current = performance.now();
        }
      }
      animationFrameId = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || !navigator.mediaDevices?.getUserMedia) {
      setSungMidi(null);
      setIsPitchDetected(false);
      setIsPitchAttacking(false);
      setPitchRestProgress(1);
      return undefined;
    }

    let cancelled = false;
    let animationFrameId = 0;
    let ownsStream = false;
    let ownsContext = false;
    let stream;
    let context;
    let lastMeasurementAt = 0;
    let lastAnimationAt = 0;
    let lastRenderAt = 0;
    let lastVoicedAt = 0;
    let targetMidi = null;
    let displayedMidi = null;
    let restStartedAt = 0;
    let attackUntil = 0;
    const recentMidi = [];

    const start = async () => {
      try {
        const monitor = browserMonitorRef.current;
        stream = monitor?.stream;
        context = monitor?.context;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              ...(monitorInputDeviceId !== "default"
                ? { deviceId: { exact: monitorInputDeviceId } }
                : {})
            }
          });
          ownsStream = true;
        }
        if (!context) {
          context = new AudioContext({ latencyHint: "interactive" });
          ownsContext = true;
        }
        if (cancelled) {
          if (ownsStream) stream.getTracks().forEach((track) => track.stop());
          if (ownsContext) context.close();
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.2;
        context.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        const updatePitch = (timestamp) => {
          if (cancelled) return;
          if (timestamp - lastMeasurementAt >= 35) {
            lastMeasurementAt = timestamp;
            const detectedMidi = detectMidiFromAnalyser(
              analyser,
              buffer,
              context.sampleRate
            );
            if (Number.isFinite(detectedMidi)) {
              // Individual autocorrelation readings can jump by a semitone or octave.
              // Use a short median window; the visible marker itself moves separately
              // at a capped, constant speed below.
              recentMidi.push(detectedMidi);
              if (recentMidi.length > 3) recentMidi.shift();
              const sortedMidi = [...recentMidi].sort(
                (left, right) => left - right
              );
              const medianMidi = sortedMidi[Math.floor(sortedMidi.length / 2)];
              targetMidi = Number.isFinite(targetMidi)
                ? targetMidi + (medianMidi - targetMidi) * 0.42
                : medianMidi;
              const wasResting =
                restStartedAt > 0 || !Number.isFinite(displayedMidi);
              lastVoicedAt = timestamp;
              restStartedAt = 0;
              if (wasResting) {
                // A new phrase must react immediately; only the return to rest is eased.
                displayedMidi = targetMidi;
                setSungMidi(targetMidi);
                attackUntil = timestamp + 130;
                setIsPitchAttacking(true);
              }
              setIsPitchDetected(true);
              setPitchRestProgress(0);
            }
          }
          if (timestamp - lastVoicedAt > 110) {
            targetMidi = null;
            if (!restStartedAt && Number.isFinite(displayedMidi)) {
              restStartedAt = timestamp;
              setIsPitchDetected(false);
              setIsPitchAttacking(false);
            }
          }
          if (attackUntil && timestamp >= attackUntil) {
            attackUntil = 0;
            setIsPitchAttacking(false);
          }
          if (Number.isFinite(targetMidi)) {
            const elapsedSeconds = Math.min(
              0.05,
              Math.max(0.001, (timestamp - lastAnimationAt) / 1000)
            );
            const maxStep = 22 * elapsedSeconds;
            const difference = targetMidi - displayedMidi;
            displayedMidi = Number.isFinite(displayedMidi)
              ? displayedMidi +
                Math.max(-maxStep, Math.min(maxStep, difference))
              : targetMidi;
            if (timestamp - lastRenderAt >= 15) {
              setSungMidi(displayedMidi);
              lastRenderAt = timestamp;
            }
          } else if (restStartedAt) {
            const restProgress = Math.min(1, (timestamp - restStartedAt) / 380);
            if (timestamp - lastRenderAt >= 32) {
              setPitchRestProgress(restProgress);
              lastRenderAt = timestamp;
            }
            if (restProgress >= 1) {
              displayedMidi = null;
              recentMidi.length = 0;
              setSungMidi(null);
              restStartedAt = 0;
            }
          }
          lastAnimationAt = timestamp;
          animationFrameId = requestAnimationFrame(updatePitch);
        };
        animationFrameId = requestAnimationFrame(updatePitch);
      } catch {
        if (!cancelled) {
          setSungMidi(null);
          setIsPitchDetected(false);
          setIsPitchAttacking(false);
          setPitchRestProgress(1);
        }
      }
    };

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
      if (ownsStream) stream?.getTracks().forEach((track) => track.stop());
      if (ownsContext) context?.close();
      setSungMidi(null);
      setIsPitchDetected(false);
      setIsPitchAttacking(false);
      setPitchRestProgress(1);
    };
  }, [isPlaying, monitorInputDeviceId, monitoringEnabled]);

  useEffect(() => {
    lastControlsActivityRef.current = Date.now();
    const watcher = window.setInterval(() => {
      setControlsVisible(Date.now() - lastControlsActivityRef.current < 2200);
    }, 250);
    return () => window.clearInterval(watcher);
  }, []);

  useEffect(() => {
    if (instrumentalRef.current)
      instrumentalRef.current.volume = playbackGain(musicVolume);
  }, [musicVolume]);
  useEffect(() => {
    if (browserMonitorRef.current) {
      browserMonitorRef.current.gainNode.gain.value = microphoneVolume;
    }
  }, [microphoneVolume]);
  useEffect(() => {
    browserMonitorRef.current?.effects?.apply(microphoneEffects);
  }, [microphoneEffects]);
  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = playbackGain(vocalVolume);
  }, [vocalVolume]);
  useEffect(() => {
    if (isPlaying && melodyVolume > 0) {
      startMelodyGuide().catch(() => {});
    } else {
      silenceMelodyGuide();
    }
  }, [isPlaying, melodyVolume, keyShift]);
  useEffect(() => {
    [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
      (el) => el && (el.playbackRate = speed)
    );
    sendYouTubeCommand("setPlaybackRate", [speed]);
  }, [speed]);

  const togglePlay = async ({ broadcast = true, forcePlaying = null } = {}) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return undefined;
    const operationId = ++transportOperationRef.current;
    const shouldPlay = forcePlaying == null ? !isPlaying : forcePlaying;
    if (!shouldPlay) {
      instr.pause();
      voc.pause();
      videoRef.current?.pause();
      sendYouTubeCommand("pauseVideo");
      silenceMelodyGuide();
      setIsPlaying(false);
      if (recordingSessionId)
        await api.pauseRecording(recordingSessionId).catch(() => {});
      if (broadcast && onlineRoom?.room) {
        onlineRoom.syncCommand(
          createPlayerSyncCommand("pause", song.id, instr.currentTime)
        );
      }
      return true;
    } else {
      // Create/resume Web Audio while this click is still a user gesture.
      const melodyStart = startMelodyGuide().catch(() => {});
      let activeRecordingId = recordingSessionId;
      try {
        if (recordingSessionId) {
          await api.resumeRecording(recordingSessionId);
        } else {
          const session = await api.startRecording(
            song.id,
            instr.currentTime,
            playbackGain(musicVolume),
            microphoneVolume,
            microphoneEffects.reverb,
            microphoneEffects.echo,
            microphoneEffects.delay
          );
          activeRecordingId = session.recording_session_id;
          setRecordingSessionId(activeRecordingId);
        }
        setRecordingError(null);
      } catch (error) {
        silenceMelodyGuide();
        setRecordingError(
          `Не удалось начать запись: ${getErrorMessage(error, "неизвестная ошибка")}`
        );
        return false;
      }
      if (operationId !== transportOperationRef.current) {
        if (activeRecordingId) {
          await api.pauseRecording(activeRecordingId).catch(() => {});
        }
        silenceMelodyGuide();
        return false;
      }
      syncSecondaryMedia(instr.currentTime, true);
      instr.volume = playbackGain(musicVolume);
      voc.volume = playbackGain(vocalVolume);
      sendYouTubeCommand("playVideo");
      try {
        await melodyStart;
        await instr.play();
        await Promise.allSettled(
          [voc.play(), videoRef.current?.play()].filter(Boolean)
        );
      } catch {
        setIsPlaying(false);
        return false;
      }
    }
    if (operationId !== transportOperationRef.current) return false;
    setIsPlaying(true);
    if (broadcast && onlineRoom?.room) {
      onlineRoom.syncCommand(
        createPlayerSyncCommand("play", song.id, instr.currentTime)
      );
    }
    return true;
  };

  const stop = async ({ broadcast = true } = {}) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return undefined;
    transportOperationRef.current += 1;
    instr.pause();
    voc.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
    instr.currentTime = 0;
    syncSecondaryMedia(0, true);
    setIsPlaying(false);
    setCurrentTime(0);
    if (broadcast && onlineRoom?.room) {
      onlineRoom.syncCommand(createPlayerSyncCommand("stop", song.id, 0));
    }
    if (recordingSessionId) {
      try {
        const recording = await api.stopRecording(recordingSessionId);
        setRecordingSessionId(null);
        setAnalysisRecordingId(recording.id);
      } catch (error) {
        setRecordingError(
          `Не удалось сохранить запись: ${getErrorMessage(error, "неизвестная ошибка")}`
        );
      }
    }
    // A monitor enabled by the user remains active after a take; only the
    // temporary recording monitor is released by Stop.
    if (manualMonitoringRef.current) return true;
    const monitor = browserMonitorRef.current;
    monitor?.stream.getTracks().forEach((track) => track.stop());
    monitor?.context.close();
    browserMonitorRef.current = null;
    setMonitoringEnabled(false);
    await api.stopDirectMonitoring().catch(() => {});
    return true;
  };

  const returnToLibrary = async () => {
    await stop({ broadcast: false });
    if (onlineRoom?.room) onlineRoom.syncCommand({ type: "open-library" });
    navigate("/");
  };

  const updateMicrophone = async (patch) => {
    try {
      const updated = await api.updateAudioSettings(patch);
      if (updated.volume != null) setMicrophoneVolume(updated.volume);
    } catch (error) {
      setRecordingError(
        `Не удалось сохранить настройки микрофона: ${getErrorMessage(error, "неизвестная ошибка")}`
      );
    }
  };

  const setDirectMonitoring = async (enabled) => {
    const activeMonitor = browserMonitorRef.current;
    activeMonitor?.stream.getTracks().forEach((track) => track.stop());
    activeMonitor?.context.close();
    browserMonitorRef.current = null;
    try {
      if (enabled) {
        await updateMicrophone({ volume: microphoneVolume });
        await api.startDirectMonitoring();
      } else {
        await api.stopDirectMonitoring();
      }
      manualMonitoringRef.current = enabled;
      setMonitoringEnabled(enabled);
    } catch (error) {
      manualMonitoringRef.current = false;
      setMonitoringEnabled(false);
      if (!enabled) await api.stopDirectMonitoring().catch(() => {});
      setRecordingError(
        `Не удалось включить прямое прослушивание: ${getErrorMessage(error, "неизвестная ошибка")}`
      );
    }
  };

  const microphoneLevel = getMicrophoneLevel(signal);

  const seekTo = (time, { broadcast = true } = {}) => {
    const instr = instrumentalRef.current;
    if (!instr) return;
    const position = clampPlaybackPosition(time, durationRef.current);
    instr.currentTime = position;
    syncSecondaryMedia(position, true);
    setCurrentTime(position);
    if (broadcast && onlineRoom?.room) {
      onlineRoom.syncCommand(
        createPlayerSyncCommand("seek", song.id, position)
      );
    }
  };

  const skip = (delta) =>
    seekTo(clampPlaybackPosition(currentTime + delta, duration));

  useEffect(() => {
    const command = onlineRoom?.roomCommand;
    if (
      command?.type !== "karaoke-player" ||
      !song?.id ||
      command.songId !== song.id ||
      !instrumentalRef.current
    )
      return;

    const position = Number(command.position);
    if (Number.isFinite(position)) seekTo(position, { broadcast: false });
    if (command.action === "play") {
      togglePlay({ broadcast: false, forcePlaying: true });
    } else if (command.action === "pause") {
      togglePlay({ broadcast: false, forcePlaying: false });
    } else if (command.action === "stop") {
      stop({ broadcast: false });
    }
  }, [onlineRoom?.roomCommand]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target.closest("input, select, textarea, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        seekTo(Math.max(0, currentTimeRef.current - 5));
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        seekTo(Math.min(durationRef.current, currentTimeRef.current + 5));
      } else if (event.code === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      clearTimeout(controlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const shell = document.querySelector(".karaoke-app-shell");
    const main = containerRef.current?.parentElement;
    const stage = containerRef.current;
    if (!shell || !main || !stage) return undefined;

    const syncStageAspect = () => {
      const currentExtra = Number.parseFloat(
        getComputedStyle(shell).getPropertyValue("--karaoke-nav-extra")
      );
      const layout = getKaraokeStageLayout({
        mainWidth: main.clientWidth,
        mainHeight: main.clientHeight,
        stageWidth: stage.clientWidth,
        stageHeight: stage.clientHeight,
        currentNavExtra: currentExtra
      });
      shell.style.setProperty("--karaoke-nav-extra", `${layout.navExtra}px`);
      stage.style.setProperty(
        "--karaoke-video-width",
        `${layout.videoWidth}px`
      );
      stage.style.setProperty(
        "--karaoke-video-height",
        `${layout.videoHeight}px`
      );
    };

    const observer = new ResizeObserver(syncStageAspect);
    observer.observe(main);
    observer.observe(stage);
    syncStageAspect();
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--karaoke-nav-extra");
      stage.style.removeProperty("--karaoke-video-width");
      stage.style.removeProperty("--karaoke-video-height");
    };
  }, []);

  const revealControls = () => {
    lastControlsActivityRef.current = Date.now();
    setControlsVisible(true);
  };

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

  return (
    <div
      ref={containerRef}
      className={`panel karaoke-stage ${!controlsVisible ? "karaoke-ui-hidden" : ""}`}
      onMouseMove={revealControls}
      style={{
        padding: 0,
        overflow: "visible",
        position: "relative",
        minHeight: "calc(100vh - 72px)"
      }}
    >
      <audio
        ref={instrumentalRef}
        src={api.getAudioTrackUrl(song.id, "instrumental")}
        preload="auto"
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = playbackGain(musicVolume);
        }}
      />
      <audio
        ref={vocalsRef}
        src={api.getAudioTrackUrl(song.id, "vocals")}
        preload="auto"
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = playbackGain(vocalVolume);
        }}
      />
      {youTubeVideoId ? (
        <iframe
          ref={youTubeClipRef}
          className="karaoke-video karaoke-youtube-video"
          src={youTubeEmbedUrl(youTubeVideoId)}
          title={`Клип: ${song.title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          onLoad={() => {
            sendYouTubeCommand("mute");
            sendYouTubeCommand("setPlaybackRate", [speed]);
            syncSecondaryMedia(instrumentalRef.current?.currentTime || 0, true);
            if (isPlaying) sendYouTubeCommand("playVideo");
          }}
        />
      ) : (
        song.video_url && (
          <video
            ref={videoRef}
            className="karaoke-video"
            src={song.video_url}
            preload="metadata"
            muted
            playsInline
          />
        )
      )}

      {microphoneOpen && (
        <div
          className="karaoke-settings-backdrop"
          onMouseDown={() => setMicrophoneOpen(false)}
        >
          <div
            className="microphone-panel karaoke-settings-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="microphone-panel-title">
              <Settings2 size={15} /> Настройки караоке
            </div>
            <button
              type="button"
              className="karaoke-settings-close"
              title="Закрыть настройки"
              onClick={() => setMicrophoneOpen(false)}
            >
              <X size={16} />
            </button>
            <div className="karaoke-settings-section">
              <div className="karaoke-settings-section-title">
                Отображение и воспроизведение
              </div>
              <div className="karaoke-settings-toggles">
                <button
                  type="button"
                  className={`btn ${showLyrics ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setShowLyrics((value) => !value)}
                >
                  <Type size={14} /> Текст
                </button>
                <button
                  type="button"
                  className={`btn ${showNotes ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setShowNotes((value) => !value)}
                >
                  <AudioLines size={14} /> Ноты
                </button>
                <div className="karaoke-setting-choice">
                  <span>Тональность</span>
                  <div className="karaoke-key-stepper">
                    <button
                      type="button"
                      aria-label="Понизить тональность"
                      disabled={keyShift <= -6}
                      onClick={() =>
                        setKeyShift((value) => Math.max(-6, value - 1))
                      }
                    >
                      −
                    </button>
                    <strong>
                      {transposeKey(song?.key_override, keyShift)}
                    </strong>
                    <button
                      type="button"
                      aria-label="Повысить тональность"
                      disabled={keyShift >= 6}
                      onClick={() =>
                        setKeyShift((value) => Math.min(6, value + 1))
                      }
                    >
                      +
                    </button>
                  </div>
                  <small>
                    {keyShift === 0
                      ? "Оригинальная"
                      : `${keyShift > 0 ? "+" : ""}${keyShift} полутонов`}
                  </small>
                </div>
              </div>
              <div className="karaoke-settings-sliders">
                <SliderField
                  label="Громкость музыки"
                  value={musicVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setMusicVolume}
                  display={`${Math.round(musicVolume * 100)}%`}
                />
                <SliderField
                  label="Громкость вокала"
                  value={vocalVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setVocalVolume}
                  display={`${Math.round(vocalVolume * 100)}%`}
                />
                <SliderField
                  label="Мелодия-ориентир"
                  value={melodyVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setMelodyVolume}
                  display={`${Math.round(melodyVolume * 100)}%`}
                />
                <div className="karaoke-setting-choice">
                  <span>Скорость</span>
                  <div
                    className="karaoke-speed-switch"
                    role="group"
                    aria-label="Скорость"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5].map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={speed === value ? "is-active" : ""}
                        onClick={() => setSpeed(value)}
                      >
                        {value === 1 ? "1×" : `${value}×`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="microphone-controls-launcher">
              <button
                type="button"
                className={`btn ${microphoneControlsOpen ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMicrophoneControlsOpen((open) => !open)}
              >
                <Settings2 size={15} />
                {microphoneControlsOpen
                  ? "Скрыть микрофон"
                  : "Микрофон и эффекты"}
              </button>
            </div>
            {microphoneControlsOpen && (
              <div className="microphone-controls-content">
                <div
                  className={
                    audioDriver === "asio" ? "advanced-audio-setting" : ""
                  }
                >
                  <span>Устройство ввода</span>
                  <Dropdown
                    id="karaoke-input-device"
                    value={audioSettings?.input_device_id ?? ""}
                    onChange={(value) =>
                      updateMicrophone({
                        input_device_id: value === "" ? null : Number(value)
                      })
                    }
                    options={createIndexedDeviceOptions(devices)}
                  />
                </div>
                <div className="audio-driver-setting">
                  <span>Аудиодрайвер</span>
                  <Dropdown
                    id="karaoke-audio-driver"
                    value={audioDriver}
                    disabled={monitoringEnabled}
                    onChange={async (value) => {
                      setAudioDriver(value);
                      await updateMicrophone({ audio_driver: value });
                    }}
                    options={[
                      { value: "auto", label: "Авто · Windows / PortAudio" },
                      ...((asioDrivers || []).length
                        ? [
                            {
                              value: "asio",
                              label: "ASIO · минимальная задержка"
                            }
                          ]
                        : [])
                    ]}
                  />
                  {!(asioDrivers || []).length && (
                    <small>
                      ASIO появится после установки драйвера аудиоинтерфейса.
                    </small>
                  )}
                </div>
                {audioDriver === "asio" && (
                  <div className="asio-driver-setting">
                    <span>ASIO-драйвер</span>
                    <Dropdown
                      id="karaoke-asio-driver"
                      value={asioDriverName}
                      disabled={monitoringEnabled}
                      onChange={async (value) => {
                        setAsioDriverName(value);
                        await updateMicrophone({ asio_driver_name: value });
                      }}
                      options={(asioDrivers || []).map((driver) => ({
                        value: driver.name,
                        label: driver.name
                      }))}
                    />
                    <small>
                      Для Audient выбран нативный драйвер аудиоинтерфейса.
                    </small>
                  </div>
                )}
                <div className="advanced-audio-setting">
                  <span>Буфер аудио</span>
                  <Dropdown
                    id="karaoke-audio-buffer"
                    value={audioBufferSize}
                    disabled={monitoringEnabled}
                    onChange={async (value) => {
                      const bufferSize = Number(value);
                      setAudioBufferSize(bufferSize);
                      await updateMicrophone({ buffer_size: bufferSize });
                    }}
                    options={createBufferSizeOptions()}
                  />
                </div>
                <div className="advanced-audio-setting">
                  <span>Выход прямого мониторинга</span>
                  <Dropdown
                    id="karaoke-direct-output"
                    value={directOutputDeviceId}
                    disabled={monitoringEnabled}
                    onChange={async (value) => {
                      const deviceId = value === "" ? null : Number(value);
                      setDirectOutputDeviceId(value);
                      await updateMicrophone({ output_device_id: deviceId });
                    }}
                    options={createIndexedDeviceOptions(
                      directOutputDevices,
                      "Системное устройство по умолчанию"
                    )}
                  />
                  <small>
                    Для минимальной задержки выберите выход того же
                    аудиоинтерфейса.
                  </small>
                </div>
                <div className="legacy-browser-monitoring">
                  <span>Вход для прослушивания</span>
                  <Dropdown
                    id="karaoke-monitor-input"
                    value={monitorInputDeviceId}
                    disabled={monitoringEnabled}
                    onChange={setMonitorInputDeviceId}
                    options={createBrowserDeviceOptions(
                      browserAudioDevices.inputs,
                      "Микрофон"
                    )}
                  />
                </div>
                <div className="legacy-browser-monitoring">
                  <span>Выход для прослушивания</span>
                  <Dropdown
                    id="karaoke-monitor-output"
                    value={monitorOutputDeviceId}
                    disabled={monitoringEnabled}
                    onChange={setMonitorOutputDeviceId}
                    options={createBrowserDeviceOptions(
                      browserAudioDevices.outputs,
                      "Аудиоустройство"
                    )}
                  />
                </div>
                <div className="legacy-browser-monitoring">
                  <span>Режим задержки</span>
                  <Dropdown
                    id="karaoke-latency-mode"
                    value={monitorLatencyHint}
                    disabled={monitoringEnabled}
                    onChange={setMonitorLatencyHint}
                    options={[
                      { value: "interactive", label: "Низкая задержка" },
                      { value: "balanced", label: "Автоматический" },
                      {
                        value: "playback",
                        label: "Стабильное воспроизведение"
                      }
                    ]}
                  />
                </div>
                <MonitoringModePicker
                  modes={MONITORING_MODES}
                  value={monitorMode}
                  isOpen={monitorModeOpen}
                  disabled={monitoringEnabled}
                  menuRef={monitorModeMenuRef}
                  onToggle={() => setMonitorModeOpen((open) => !open)}
                  onChange={(value) => {
                    setMonitorMode(value);
                    setMonitorModeOpen(false);
                  }}
                />
                <label
                  className="microphone-gain-setting"
                  htmlFor="microphone-volume"
                >
                  Громкость микрофона:{" "}
                  {Math.round((microphoneVolume / 4) * 100)}%
                  <input
                    id="microphone-volume"
                    type="range"
                    min="0"
                    max="4"
                    step="0.05"
                    value={microphoneVolume}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setMicrophoneVolume(value);
                      if (browserMonitorRef.current)
                        browserMonitorRef.current.gainNode.gain.value = value;
                    }}
                    onPointerUp={(event) =>
                      updateMicrophone({
                        volume: Number(event.currentTarget.value)
                      })
                    }
                    onKeyUp={(event) => {
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          event.key
                        )
                      ) {
                        updateMicrophone({
                          volume: Number(event.currentTarget.value)
                        });
                      }
                    }}
                  />
                </label>
                <label
                  className="microphone-monitoring"
                  htmlFor="microphone-monitoring-enabled"
                >
                  <input
                    id="microphone-monitoring-enabled"
                    type="checkbox"
                    checked={monitoringEnabled}
                    onChange={(event) =>
                      setDirectMonitoring(event.target.checked)
                    }
                  />
                  Прослушивать с этого устройства
                </label>
                <div className="microphone-level">
                  <div>
                    Уровень:{" "}
                    {signal
                      ? `${signal.rms_db} дБFS${signal.clipping ? " · перегрузка" : signal.silent ? " · тихо" : ""}`
                      : "проверяем…"}
                  </div>
                  <div className="microphone-level-track">
                    <div
                      className="microphone-level-fill"
                      style={{ width: `${microphoneLevel}%` }}
                    />
                  </div>
                  <span>{Math.round(microphoneLevel)}%</span>
                </div>
                <div className="microphone-effects">
                  <div className="microphone-effects-title">
                    Эффекты микрофона
                  </div>
                  <SliderField
                    label="Reverb"
                    value={microphoneEffects.reverb}
                    min={0}
                    max={1}
                    step={0.05}
                    display={`${Math.round(microphoneEffects.reverb * 100)}%`}
                    onChange={(value) => {
                      setMicrophoneEffects((effects) => ({
                        ...effects,
                        reverb: value
                      }));
                    }}
                    onCommit={(value) => updateMicrophone({ reverb: value })}
                  />
                  <SliderField
                    label="Echo"
                    value={microphoneEffects.echo}
                    min={0}
                    max={1}
                    step={0.05}
                    display={`${Math.round(microphoneEffects.echo * 100)}%`}
                    onChange={(value) => {
                      setMicrophoneEffects((effects) => ({
                        ...effects,
                        echo: value
                      }));
                    }}
                    onCommit={(value) => updateMicrophone({ echo: value })}
                  />
                  <SliderField
                    label="Delay"
                    value={microphoneEffects.delay}
                    min={0}
                    max={1}
                    step={0.05}
                    display={`${Math.round(microphoneEffects.delay * 100)}%`}
                    onChange={(value) => {
                      setMicrophoneEffects((effects) => ({
                        ...effects,
                        delay: value
                      }));
                    }}
                    onCommit={(value) => updateMicrophone({ delay: value })}
                  />
                  <small>
                    0% — эффект полностью выключен. Изменения слышны в
                    мониторинге; для ASIO они применяются после отпускания
                    ползунка.
                  </small>
                </div>
              </div>
            )}
          </div>
        </div>
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

      <div
        className={`karaoke-performance-stage karaoke-aurora-stage ${isPlaying ? "is-playing" : ""}`}
      >
        <div
          ref={panoramaSkyRef}
          className="karaoke-panoramic-sky"
          style={{ "--panorama-image": `url(${activeTheme.image})` }}
          aria-hidden="true"
        />
        <div className="karaoke-aurora-world" aria-hidden="true">
          <i className="aurora-nebula aurora-nebula--left" />
          <i className="aurora-nebula aurora-nebula--center" />
          <i className="aurora-nebula aurora-nebula--right" />
          <i className="aurora-cloud-texture aurora-cloud-texture--left" />
          <i className="aurora-cloud-texture aurora-cloud-texture--right" />
          <i className="aurora-solar-flare" />
          <i className="aurora-horizon-city" />
          <i className="aurora-grid-floor" />
          <i className="aurora-floor-pulse aurora-floor-pulse--one" />
          <i className="aurora-floor-pulse aurora-floor-pulse--two" />
          <i className="aurora-floor-pulse aurora-floor-pulse--three" />
          <i className="aurora-ring aurora-ring--one" />
          <i className="aurora-ring aurora-ring--two" />
          <i className="aurora-ring aurora-ring--three" />
          <i className="aurora-ribbon aurora-ribbon--one" />
          <i className="aurora-ribbon aurora-ribbon--two" />
          <i className="aurora-ribbon aurora-ribbon--three" />
          <i className="aurora-arc-pulse aurora-arc-pulse--one" />
          <i className="aurora-arc-pulse aurora-arc-pulse--two" />
          <i className="aurora-arc-pulse aurora-arc-pulse--three" />
          <i className="aurora-comet aurora-comet--one" />
          <i className="aurora-comet aurora-comet--two" />
          <i className="aurora-comet aurora-comet--three" />
          <div className="aurora-stars">
            {Array.from({ length: 96 }, (_, index) => (
              <i
                key={index}
                style={{
                  "--aurora-x": `${(index * 47 + auroraSeed) % 100}%`,
                  "--aurora-y": `${(index * 29 + auroraSeed * 3) % 92}%`,
                  "--aurora-delay": `${(index * -137) % 5800}ms`,
                  "--aurora-depth": `${1 + (index % 4)}`
                }}
              />
            ))}
          </div>
          <div className="aurora-particles">
            {Array.from({ length: 112 }, (_, index) => (
              <i
                key={index}
                style={{
                  "--particle-angle": `${(index * 137.5 + auroraSeed) % 360}deg`,
                  "--particle-distance": `${32 + ((index * 29) % 74)}vmax`,
                  "--particle-delay": `${(index * -211) % 6000}ms`,
                  "--particle-size": `${1 + (index % 6)}px`,
                  "--particle-color": [
                    "#ff5c99",
                    "#ff9d42",
                    "#c786ff",
                    "#fff3d5"
                  ][index % 4]
                }}
              />
            ))}
          </div>
        </div>
        {/* Piano-roll notes: visible pitch lanes make melody and intervals readable. */}
        {showNotes && notes.length > 0 && (
          <MelodyRoll
            notes={notes}
            currentTime={currentTime}
            sungMidi={sungMidi}
            isPitchDetected={isPitchDetected}
            isPitchAttacking={isPitchAttacking}
            pitchRestProgress={pitchRestProgress}
            keyShift={keyShift}
            songTitle={song.title}
            noteRangeMin={song.note_range_min}
            noteRangeMax={song.note_range_max}
          />
        )}

        {/* Large, high-contrast lyric cue, placed over the note stage. */}
        {showLyrics && (
          <div className="karaoke-lyrics">
            {lyrics.length === 0 && (
              <p className="text-muted">Синхронизированный текст недоступен</p>
            )}
            {currentLine ? (
              <KaraokeLyricLine
                key={`${currentLine.start}-${currentLine.text}`}
                line={currentLine}
                currentTime={lyricTime}
                className="karaoke-lyric karaoke-lyric-current"
              />
            ) : upcomingLine ? (
              <KaraokeLyricLine
                key={`${upcomingLine.start}-${upcomingLine.text}`}
                line={upcomingLine}
                currentTime={lyricTime}
                className="karaoke-lyric karaoke-lyric-current karaoke-lyric-upcoming"
              />
            ) : (
              lyrics.length > 0 && (
                <div className="karaoke-lyric karaoke-lyric-current">
                  {
                    "\u041f\u0435\u0441\u043d\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430"
                  }
                </div>
              )
            )}
            {nextLine && (
              <KaraokeLyricLine
                line={nextLine}
                currentTime={lyricTime}
                className="karaoke-lyric karaoke-lyric-next"
              />
            )}
          </div>
        )}
      </div>

      {/* Таймлайн + транспорт */}
      <div className="karaoke-transport-area">
        <div className="karaoke-timeline-row">
          <span className="mono karaoke-timecode">
            {formatTime(currentTime)}
          </span>
          <WaveformTimeline
            value={currentTime}
            duration={duration}
            onChange={seekTo}
          />
          <span className="mono karaoke-timecode karaoke-timecode-end">
            {formatTime(duration)}
          </span>
        </div>

        <div className="karaoke-playback-controls">
          <div className="karaoke-player-meta">
            <span>Мелодическая карта</span>
            <strong>{song.title}</strong>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Назад на 5 секунд"
            title="Назад на 5 секунд"
            onClick={() => skip(-5)}
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className="btn btn-primary karaoke-play-button"
            aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
            title={isPlaying ? "Пауза" : "Воспроизвести"}
            onClick={() => togglePlay()}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Остановить"
            title="Остановить"
            onClick={() => stop()}
          >
            <Square size={16} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Вперёд на 5 секунд"
            title="Вперёд на 5 секунд"
            onClick={() => skip(5)}
          >
            <SkipForward size={16} />
          </button>
          <div className="karaoke-corner-actions">
            <button
              type="button"
              className="btn btn-ghost"
              title="Вернуться в библиотеку"
              aria-label="Вернуться в библиотеку"
              onClick={() => {
                returnToLibrary();
              }}
            >
              <ArrowLeft size={18} />
            </button>
            {onOpenAppSettings && (
              <button
                type="button"
                className="btn karaoke-app-settings"
                title="Настройки приложения"
                aria-label="Настройки приложения"
                onClick={onOpenAppSettings}
              >
                <Cog size={18} />
              </button>
            )}
            <button
              type="button"
              className={`btn ${microphoneOpen ? "btn-primary" : "btn-ghost"}`}
              title="Настройки караоке"
              onClick={() => setMicrophoneOpen(true)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="На весь экран"
              onClick={toggleFullscreen}
            >
              <Maximize size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
