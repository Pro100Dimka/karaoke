import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Maximize,
  Type,
  AudioLines,
  Mic,
  Settings2,
  Check,
  ChevronDown,
  Zap,
  ShieldCheck,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Dropdown } from "../components/Dropdown";

// ПРИМЕЧАНИЕ ПО СХЕМЕ ДАННЫХ: здесь предполагается, что lyrics.json — это
// массив строк вида {start, end, text}, а reference.json — массив нот вида
// {start, end, midi}. Если реальная структура AI-пайплайна отличается по
// именам полей, поправить нужно только в двух местах ниже —
// normalizeLyrics()/normalizeNotes() — остальной компонент от конкретной
// формы данных не зависит.
function normalizeLyrics(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.lines || raw.segments || [];
  return list
    .map((l) => ({
      start: l.start ?? l.begin ?? 0,
      end: l.end ?? l.start + 2,
      text: l.text || l.line || "",
    }))
    .filter((l) => l.text);
}

function normalizeNotes(raw) {
  if (!raw) return [];
  return raw
    .map((note) => ({
      start: Number(note.start),
      end: Number(note.end),
      midi: note.midi ?? note.pitch ?? noteNameToMidi(note.note),
    }))
    .filter(
      (note) =>
        Number.isFinite(note.start) &&
        Number.isFinite(note.end) &&
        Number.isFinite(note.midi),
    );
}

function noteNameToMidi(noteName) {
  if (typeof noteName !== "string") return null;
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) return null;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const [, letter, accidental, octaveText] = match;
  const base = semitones[letter.toUpperCase()];
  const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octaveText) + 1) * 12 + base + offset;
}

function midiToWesternNote(midi) {
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getYouTubeVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    let id = null;
    if (host === "youtu.be") id = parsed.pathname.split("/")[1];
    if (host.endsWith("youtube.com")) {
      id =
        parsed.searchParams.get("v") ||
        parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}

function youTubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&rel=0&modestbranding=1&mute=1`;
}

const KARAOKE_PREFERENCES_KEY = "karaoke-player-preferences";

function loadKaraokePreferences() {
  try {
    return JSON.parse(localStorage.getItem(KARAOKE_PREFERENCES_KEY) || "{}");
  } catch {
    return {};
  }
}

const MONITORING_MODES = [
  {
    id: "direct",
    title:
      "\u041f\u0440\u044f\u043c\u043e\u0439 \u0434\u0440\u0430\u0439\u0432\u0435\u0440",
    description:
      "\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0430. \u041d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u044b \u0430\u0443\u0434\u0438\u043e\u0434\u0440\u0430\u0439\u0432\u0435\u0440 \u0438 \u043d\u0430\u0443\u0448\u043d\u0438\u043a\u0438.",
    Icon: Zap,
  },
  {
    id: "browser",
    title: "\u0421\u043e\u0432\u043c\u0435\u0441\u0442\u0438\u043c\u044b\u0439",
    description:
      "\u0420\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0441 \u043e\u0431\u044b\u0447\u043d\u044b\u043c\u0438 USB-\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d\u0430\u043c\u0438. \u0412\u043e\u0437\u043c\u043e\u0436\u043d\u0430 \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0430.",
    Icon: ShieldCheck,
  },
];

export default function Karaoke() {
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 15000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || []).find((s) => s.status === "done");

  const [result, setResult] = useState(null);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const youTubeClipRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [preferences] = useState(loadKaraokePreferences);
  const [musicVolume, setMusicVolume] = useState(
    () => preferences.musicVolume ?? 1,
  );
  const [vocalVolume, setVocalVolume] = useState(
    () => preferences.vocalVolume ?? 1,
  );
  const [speed, setSpeed] = useState(() => preferences.speed ?? 1);
  // ВАЖНО: keyShift сейчас смещает только отображаемую линию мелодии
  // (транспонирует ноты на экране), а НЕ реальный питч аудио — честный
  // питч-шифтинг воспроизведения в браузере требует DSP-библиотеки вроде
  // SoundTouch-js/Rubberband и здесь не реализован. Если нужен настоящий
  // сдвиг тональности звука — это отдельная задача.
  const [keyShift, setKeyShift] = useState(() => preferences.keyShift ?? 0);
  const [showLyrics, setShowLyrics] = useState(
    () => preferences.showLyrics ?? true,
  );
  const [showNotes, setShowNotes] = useState(
    () => preferences.showNotes ?? true,
  );
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const [microphoneOpen, setMicrophoneOpen] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const [microphoneVolume, setMicrophoneVolume] = useState(1);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [browserAudioDevices, setBrowserAudioDevices] = useState({
    inputs: [],
    outputs: [],
  });
  const [monitorInputDeviceId, setMonitorInputDeviceId] = useState("default");
  const [monitorOutputDeviceId, setMonitorOutputDeviceId] = useState("default");
  const [monitorLatencyHint, setMonitorLatencyHint] = useState("interactive");
  const [monitorMode, setMonitorMode] = useState("direct");
  const [monitorModeOpen, setMonitorModeOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const controlsTimerRef = useRef(null);
  const lastControlsActivityRef = useRef(Date.now());
  const microphoneVolumeInitializedRef = useRef(false);
  const browserMonitorRef = useRef(null);
  const monitorModeMenuRef = useRef(null);
  const lastSecondarySyncRef = useRef(0);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: devices } = usePolling(
    () => (microphoneOpen ? api.listAudioDevices() : Promise.resolve([])),
    30000,
    [microphoneOpen],
  );
  const { data: audioSettings } = usePolling(
    () => (microphoneOpen ? api.getAudioSettings() : Promise.resolve(null)),
    30000,
    [microphoneOpen],
  );
  const { data: signal } = usePolling(
    () => (microphoneOpen ? api.getSignalQuality() : Promise.resolve(null)),
    1200,
    [microphoneOpen],
  );

  useEffect(() => {
    if (
      audioSettings?.volume != null &&
      !microphoneVolumeInitializedRef.current
    ) {
      microphoneVolumeInitializedRef.current = true;
      setMicrophoneVolume(audioSettings.volume);
    }
  }, [audioSettings?.volume]);

  useEffect(
    () => () => {
      const monitor = browserMonitorRef.current;
      monitor?.stream.getTracks().forEach((track) => track.stop());
      monitor?.context.close();
    },
    [],
  );

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
        setBrowserAudioDevices({
          inputs: mediaDevices.filter((device) => device.kind === "audioinput"),
          outputs: mediaDevices.filter(
            (device) => device.kind === "audiooutput",
          ),
        });
      })
      .catch(() => {});
  }, [microphoneOpen]);

  useEffect(() => {
    if (!song || song.status !== "done") return;
    api
      .getResult(song.id)
      .then(setResult)
      .catch(() => setResult(null));
  }, [song?.id, song?.status]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [song?.id]);

  useEffect(() => {
    localStorage.setItem(
      KARAOKE_PREFERENCES_KEY,
      JSON.stringify({
        musicVolume,
        vocalVolume,
        speed,
        keyShift,
        showLyrics,
        showNotes,
      }),
    );
  }, [musicVolume, vocalVolume, speed, keyShift, showLyrics, showNotes]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(
    () => normalizeNotes(result?.reference_notes),
    [result],
  );
  const youTubeVideoId = getYouTubeVideoId(song?.video_url);

  const currentLineIndex = lyrics.findIndex(
    (l) => currentTime >= l.start && currentTime < l.end,
  );
  const currentLine = lyrics[currentLineIndex];
  const upcomingLine = lyrics.find((line) => line.start > currentTime);
  const nextLine = currentLine ? lyrics[currentLineIndex + 1] : upcomingLine;
  const previousLine = currentLine
    ? lyrics[currentLineIndex - 1]
    : [...lyrics].reverse().find((line) => line.end <= currentTime);
  const secondsUntilLyrics = upcomingLine
    ? Math.max(0, upcomingLine.start - currentTime)
    : 0;

  const sendYouTubeCommand = (func, args = []) => {
    youTubeClipRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*",
    );
  };

  const syncSecondaryMedia = (position, force = false) => {
    [vocalsRef.current, videoRef.current].forEach((media) => {
      if (!media || !Number.isFinite(media.duration)) return;
      if (force || Math.abs(media.currentTime - position) > 0.08) {
        media.currentTime = Math.min(position, media.duration || position);
      }
    });
    if (force) sendYouTubeCommand("seekTo", [position, true]);
  };

  // Instrumental is the single time source. Vocal and video are gently
  // corrected from it so seeking and long playback cannot accumulate drift.
  useEffect(() => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    const onLoadedMeta = () => setDuration(instr.duration || 0);
    const onEnded = () => setIsPlaying(false);
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
        if (performance.now() - lastSecondarySyncRef.current > 450) {
          syncSecondaryMedia(position);
          lastSecondarySyncRef.current = performance.now();
        }
      }
      animationFrameId = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying]);

  useEffect(() => {
    lastControlsActivityRef.current = Date.now();
    const watcher = window.setInterval(() => {
      setControlsVisible(Date.now() - lastControlsActivityRef.current < 2200);
    }, 250);
    return () => window.clearInterval(watcher);
  }, []);

  useEffect(() => {
    if (instrumentalRef.current) instrumentalRef.current.volume = musicVolume;
  }, [musicVolume]);
  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = vocalVolume;
  }, [vocalVolume]);
  useEffect(() => {
    [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
      (el) => el && (el.playbackRate = speed),
    );
    sendYouTubeCommand("setPlaybackRate", [speed]);
  }, [speed]);

  const togglePlay = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    if (isPlaying) {
      instr.pause();
      voc.pause();
      videoRef.current?.pause();
      sendYouTubeCommand("pauseVideo");
      if (recordingSessionId)
        await api.pauseRecording(recordingSessionId).catch(() => {});
    } else {
      try {
        if (recordingSessionId) {
          await api.resumeRecording(recordingSessionId);
        } else {
          const session = await api.startRecording(song.id, instr.currentTime);
          setRecordingSessionId(session.recording_session_id);
        }
        setRecordingError(null);
      } catch (error) {
        setRecordingError(`Не удалось начать запись: ${error.message}`);
        return;
      }
      syncSecondaryMedia(instr.currentTime, true);
      sendYouTubeCommand("playVideo");
      try {
        await instr.play();
        await Promise.allSettled(
          [voc.play(), videoRef.current?.play()].filter(Boolean),
        );
      } catch {
        setIsPlaying(false);
        return;
      }
    }
    setIsPlaying(!isPlaying);
  };

  const stop = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    instr.pause();
    voc.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    instr.currentTime = 0;
    syncSecondaryMedia(0, true);
    setIsPlaying(false);
    setCurrentTime(0);
    if (recordingSessionId) {
      try {
        const recording = await api.stopRecording(recordingSessionId);
        setRecordingSessionId(null);
        setAnalysisRecordingId(recording.id);
      } catch (error) {
        setRecordingError(`Не удалось сохранить запись: ${error.message}`);
      }
    }
  };

  const updateMicrophone = async (patch) => {
    try {
      const updated = await api.updateAudioSettings(patch);
      if (updated.volume != null) setMicrophoneVolume(updated.volume);
    } catch (error) {
      setRecordingError(
        `Не удалось сохранить настройки микрофона: ${error.message}`,
      );
    }
  };

  const setBrowserMonitoring = async (enabled) => {
    const activeMonitor = browserMonitorRef.current;
    if (!enabled) {
      activeMonitor?.stream.getTracks().forEach((track) => track.stop());
      activeMonitor?.context.close();
      browserMonitorRef.current = null;
      setMonitoringEnabled(false);
      await api.stopDirectMonitoring().catch(() => {});
      return;
    }

    try {
      await api.stopDirectMonitoring().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          ...(monitorInputDeviceId !== "default"
            ? { deviceId: { exact: monitorInputDeviceId } }
            : {}),
        },
      });
      const context = new AudioContext({ latencyHint: monitorLatencyHint });
      if (
        monitorOutputDeviceId !== "default" &&
        typeof context.setSinkId === "function"
      ) {
        await context.setSinkId(monitorOutputDeviceId);
      }
      const source = context.createMediaStreamSource(stream);
      const stereo = context.createChannelMerger(2);
      const gainNode = context.createGain();
      gainNode.gain.value = microphoneVolume;
      source.connect(stereo, 0, 0);
      source.connect(stereo, 0, 1);
      stereo.connect(gainNode).connect(context.destination);
      await context.resume();
      browserMonitorRef.current = { stream, context, gainNode };
      setMonitoringEnabled(true);
      await updateMicrophone({ monitoring_enabled: false });
    } catch (error) {
      setMonitoringEnabled(false);
      setRecordingError(
        `Не удалось включить прослушивание микрофона: ${error.message}`,
      );
      await updateMicrophone({ monitoring_enabled: false });
    }
  };

  const setDirectMonitoring = async (enabled) => {
    try {
      if (enabled) {
        const activeMonitor = browserMonitorRef.current;
        activeMonitor?.stream.getTracks().forEach((track) => track.stop());
        activeMonitor?.context.close();
        browserMonitorRef.current = null;
        await api.startDirectMonitoring();
      } else {
        await api.stopDirectMonitoring();
      }
      setMonitoringEnabled(enabled);
    } catch (error) {
      setMonitoringEnabled(false);
      setRecordingError(
        `Не удалось включить прямое прослушивание: ${error.message}`,
      );
    }
  };

  const microphoneLevel = signal
    ? Math.max(0, Math.min(100, ((signal.rms_db + 60) / 60) * 100))
    : 0;

  const seekTo = (time) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    instr.currentTime = time;
    syncSecondaryMedia(time, true);
    setCurrentTime(time);
  };

  const skip = (delta) =>
    seekTo(Math.max(0, Math.min(duration, currentTime + delta)));

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
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      clearTimeout(controlsTimerRef.current);
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
        minHeight: "calc(100vh - 72px)",
      }}
    >
      <audio
        ref={instrumentalRef}
        src={api.getAudioTrackUrl(song.id, "instrumental")}
        preload="auto"
      />
      <audio
        ref={vocalsRef}
        src={api.getAudioTrackUrl(song.id, "vocals")}
        preload="auto"
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
                  className={`btn ${showLyrics ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setShowLyrics((value) => !value)}
                >
                  <Type size={14} /> Текст
                </button>
                <button
                  className={`btn ${showNotes ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setShowNotes((value) => !value)}
                >
                  <AudioLines size={14} /> Ноты
                </button>
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
                  label="Скорость"
                  value={speed}
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  onChange={setSpeed}
                  display={`${speed.toFixed(2)}x`}
                />
                <SliderField
                  label="Тональность"
                  value={keyShift}
                  min={-6}
                  max={6}
                  step={1}
                  onChange={setKeyShift}
                  display={`${keyShift > 0 ? "+" : ""}${keyShift}`}
                />
              </div>
            </div>
            <label>
              Устройство ввода
              <Dropdown
                value={audioSettings?.input_device_id ?? ""}
                onChange={(value) =>
                  updateMicrophone({
                    input_device_id: value === "" ? null : Number(value),
                  })
                }
                options={[
                  { value: "", label: "По умолчанию" },
                  ...(devices || []).map((device) => ({
                    value: device.index,
                    label: device.name,
                  })),
                ]}
              />
            </label>
            <label>
              Вход для прослушивания
              <Dropdown
                value={monitorInputDeviceId}
                disabled={monitoringEnabled}
                onChange={setMonitorInputDeviceId}
                options={[
                  { value: "default", label: "Системное по умолчанию" },
                  ...browserAudioDevices.inputs.map((device) => ({
                    value: device.deviceId,
                    label: device.label || "Микрофон",
                  })),
                ]}
              />
            </label>
            <label>
              Выход для прослушивания
              <Dropdown
                value={monitorOutputDeviceId}
                disabled={monitoringEnabled}
                onChange={setMonitorOutputDeviceId}
                options={[
                  { value: "default", label: "Системное по умолчанию" },
                  ...browserAudioDevices.outputs.map((device) => ({
                    value: device.deviceId,
                    label: device.label || "Аудиоустройство",
                  })),
                ]}
              />
            </label>
            <label>
              Режим задержки
              <Dropdown
                value={monitorLatencyHint}
                disabled={monitoringEnabled}
                onChange={setMonitorLatencyHint}
                options={[
                  { value: "interactive", label: "Низкая задержка" },
                  { value: "balanced", label: "Автоматический" },
                  { value: "playback", label: "Стабильное воспроизведение" },
                ]}
              />
            </label>
            <div className="monitoring-mode-picker" ref={monitorModeMenuRef}>
              <span>
                {
                  "\u0420\u0435\u0436\u0438\u043c \u043f\u0440\u043e\u0441\u043b\u0443\u0448\u0438\u0432\u0430\u043d\u0438\u044f"
                }
              </span>
              <button
                type="button"
                className="monitoring-mode-trigger"
                disabled={monitoringEnabled}
                aria-haspopup="listbox"
                aria-expanded={monitorModeOpen}
                onClick={() => setMonitorModeOpen((open) => !open)}
              >
                {(() => {
                  const selected = MONITORING_MODES.find(
                    (mode) => mode.id === monitorMode,
                  );
                  const Icon = selected.Icon;
                  return (
                    <>
                      <Icon size={15} />
                      <span>{selected.title}</span>
                      <ChevronDown size={15} />
                    </>
                  );
                })()}
              </button>
              {monitorModeOpen && (
                <div
                  className="monitoring-mode-menu"
                  role="listbox"
                  aria-label="Режим прослушивания"
                >
                  <div className="monitoring-mode-menu-title">
                    Выберите способ прослушивания
                  </div>
                  {MONITORING_MODES.map(({ id, title, description, Icon }) => {
                    const selected = id === monitorMode;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        key={id}
                        className={`monitoring-mode-option ${selected ? "is-selected" : ""}`}
                        onClick={() => {
                          setMonitorMode(id);
                          setMonitorModeOpen(false);
                        }}
                      >
                        <Icon size={17} />
                        <span className="monitoring-mode-option-copy">
                          <strong>{title}</strong>
                          <small>{description}</small>
                        </span>
                        {selected && (
                          <Check className="monitoring-mode-check" size={17} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <label>
              Громкость микрофона: {Math.round((microphoneVolume / 4) * 100)}%
              <input
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
                    volume: Number(event.currentTarget.value),
                  })
                }
                onBlur={(event) =>
                  updateMicrophone({
                    volume: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="microphone-monitoring">
              <input
                type="checkbox"
                checked={monitoringEnabled}
                onChange={(event) =>
                  (monitorMode === "direct"
                    ? setDirectMonitoring
                    : setBrowserMonitoring)(event.target.checked)
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
              Для прослушивания используйте наушники: через колонки возможна
              обратная связь.
            </div>
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
        />
      )}

      <div className="karaoke-performance-stage">
        {/* Piano-roll notes: visible pitch lanes make melody and intervals readable. */}
        {showNotes && notes.length > 0 && (
          <MelodyRoll
            notes={notes}
            currentTime={currentTime}
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
            {previousLine && (
              <div className="karaoke-lyric karaoke-lyric-muted">
                {previousLine.text}
              </div>
            )}
            {currentLine ? (
              <div className="karaoke-lyric karaoke-lyric-current">
                {currentLine.text}
              </div>
            ) : upcomingLine ? (
              secondsUntilLyrics > 8 ? (
                <div className="karaoke-lyric karaoke-lyric-current">
                  {
                    "\u0412\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435 \u00b7 \u0441\u043b\u043e\u0432\u0430 \u0447\u0435\u0440\u0435\u0437 "
                  }
                  {formatTime(secondsUntilLyrics)}
                </div>
              ) : (
                <div className="karaoke-lyric karaoke-lyric-current">
                  {upcomingLine.text}
                </div>
              )
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
              <div className="karaoke-lyric karaoke-lyric-next">
                {nextLine.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Таймлайн + транспорт */}
      <div
        className="karaoke-transport-area"
        style={{ padding: "12px 24px 22px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>
            {formatTime(currentTime)}
          </span>
          <WaveformTimeline
            value={currentTime}
            duration={duration}
            onChange={seekTo}
          />
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>
            {formatTime(duration)}
          </span>
        </div>

        <div
          className="karaoke-playback-controls"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div className="karaoke-player-meta">
            <span>Мелодическая карта</span>
            <strong>{song.title}</strong>
          </div>
          <button className="btn btn-ghost" onClick={() => skip(-5)}>
            <SkipBack size={16} />
          </button>
          <button
            className="btn btn-primary"
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              justifyContent: "center",
            }}
            onClick={togglePlay}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn btn-ghost" onClick={stop}>
            <Square size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => skip(5)}>
            <SkipForward size={16} />
          </button>
          <div className="karaoke-corner-actions">
            <button
              className={`btn ${microphoneOpen ? "btn-primary" : "btn-ghost"}`}
              title="Настройки караоке"
              onClick={() => setMicrophoneOpen(true)}
            >
              <Settings2 size={18} />
            </button>
            <button
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

function WaveformTimeline({ value, duration, onChange }) {
  const bars = 220;
  const progress =
    duration > 0 ? Math.max(0, Math.min(1, value / duration)) : 0;

  return (
    <div className="waveform-timeline">
      <svg
        viewBox={`0 0 ${bars * 3} 44`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {Array.from({ length: bars }, (_, index) => {
          const amplitude =
            8 + Math.abs(Math.sin(index * 1.71) + Math.sin(index * 0.37)) * 11;
          const played = index / bars <= progress;
          return (
            <rect
              key={index}
              x={index * 3 + 0.75}
              y={22 - amplitude / 2}
              width="1.5"
              height={amplitude}
              rx=".75"
              fill={played ? "rgba(196,181,253,.98)" : "rgba(255,255,255,.18)"}
            />
          );
        })}
        <line
          x1={progress * bars * 3}
          x2={progress * bars * 3}
          y1="0"
          y2="44"
          stroke="#f5f3ff"
          strokeWidth="1.5"
        />
      </svg>
      <input
        aria-label="Позиция песни"
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={Math.min(value, duration || 0)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  disabled,
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span className="mono">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#a855f7" }}
      />
    </div>
  );
}

function PerformanceAnalysisModal({ recordingId, onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const analysisRequestRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!analysisRequestRef.current) {
      analysisRequestRef.current = api.runAnalysis(recordingId);
    }
    analysisRequestRef.current
      .then((analysis) => active && setResult(analysis))
      .catch((analysisError) => active && setError(analysisError.message));
    return () => {
      active = false;
    };
  }, [recordingId]);

  return (
    <div
      className="performance-analysis-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Анализ выступления"
    >
      <section className="performance-analysis-modal">
        <button
          className="karaoke-settings-close"
          title="Закрыть"
          onClick={onClose}
        >
          <X size={17} />
        </button>
        <div className="performance-analysis-heading">Анализ выступления</div>
        {!result && !error && (
          <p className="text-muted">Анализируем ноты и ритм исполнения…</p>
        )}
        {error && (
          <>
            <p className="song-lyrics-error">
              Не удалось выполнить анализ: {error}
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Закрыть
            </button>
          </>
        )}
        {result && (
          <>
            <AnalysisSummary result={result} />
            <PerformancePlayer recordingId={recordingId} />
            <button className="btn btn-primary" onClick={onClose}>
              Готово
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function AnalysisSummary({ result }) {
  const accuracy = result.pitch_accuracy_percent;
  const scoredSections = (result.sections || []).filter(
    (section) => section.accuracy_percent != null,
  );
  const bestSection = scoredSections.reduce(
    (best, section) =>
      !best || section.accuracy_percent > best.accuracy_percent
        ? section
        : best,
    null,
  );
  const needsPractice = scoredSections.reduce(
    (worst, section) =>
      !worst || section.accuracy_percent < worst.accuracy_percent
        ? section
        : worst,
    null,
  );
  const grade =
    accuracy == null
      ? "Нет данных"
      : accuracy >= 85
        ? "Отличное исполнение"
        : accuracy >= 70
          ? "Хороший результат"
          : accuracy >= 50
            ? "Есть потенциал"
            : "Нужно потренироваться";
  const advice =
    accuracy == null
      ? "Не удалось определить достаточно пропетых нот. Попробуйте петь ближе к микрофону."
      : result.mean_deviation_semitones > 1
        ? "Сфокусируйтесь на точном начале каждой фразы и удержании высоты ноты."
        : accuracy >= 70
          ? "Хорошая точность. Попробуйте сделать фразы ровнее по громкости и дыханию."
          : "Повторите сложные фразы медленнее, ориентируясь на ноты на экране.";

  return (
    <>
      <div className="performance-analysis-grade">{grade}</div>
      <div className="performance-analysis-score">
        {accuracy ?? "—"}
        <small>%</small>
      </div>
      <div className="text-muted">Попадание в ноты</div>
      <div className="performance-analysis-metrics performance-analysis-metrics-expanded">
        <div>
          <span>Среднее отклонение</span>
          <strong>
            {result.mean_deviation_semitones != null
              ? `±${result.mean_deviation_semitones} п/т`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Проверено фрагментов</span>
          <strong>{scoredSections.length || 0}</strong>
        </div>
        <div>
          <span>Лучший фрагмент</span>
          <strong>
            {bestSection ? `${bestSection.accuracy_percent}%` : "—"}
          </strong>
        </div>
        <div>
          <span>Нуждается в работе</span>
          <strong>
            {needsPractice ? `${needsPractice.accuracy_percent}%` : "—"}
          </strong>
        </div>
      </div>
      <div className="performance-analysis-advice">
        <strong>Рекомендация</strong>
        <span>{advice}</span>
      </div>
    </>
  );
}

function PerformancePlayer({ recordingId }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };
  const seek = (value) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Number(value);
    setPosition(Number(value));
  };
  const changeVolume = (value) => {
    const level = Number(value);
    if (audioRef.current) audioRef.current.volume = level;
    setVolume(level);
  };

  return (
    <div className="performance-player">
      <audio
        ref={audioRef}
        preload="metadata"
        src={api.getPerformanceFileUrl(recordingId)}
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
      />
      <button
        className="performance-player-play"
        type="button"
        onClick={toggle}
      >
        {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="performance-player-track">
        <input
          aria-label="Позиция записи"
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(position, duration || 0)}
          onChange={(event) => seek(event.target.value)}
        />
        <span>
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      <div className="performance-player-volume">
        <button type="button" onClick={() => changeVolume(volume ? 0 : 1)}>
          {volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <input
          aria-label="Громкость записи"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(event) => changeVolume(event.target.value)}
        />
      </div>
    </div>
  );
}

function MelodyRoll({
  notes,
  currentTime,
  keyShift,
  songTitle,
  noteRangeMin,
  noteRangeMax,
}) {
  const width = 1000;
  const height = 310;
  const scaleWidth = 46;
  const noteLaneStart = 66;
  const windowSeconds = 12;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = notes.filter(
    (note) => note.end >= viewStart && note.start <= viewEnd,
  );
  const songMidiValues = notes.map((note) => note.midi + keyShift);
  const savedMin = Number(noteRangeMin);
  const savedMax = Number(noteRangeMax);
  const hasSavedRange =
    noteRangeMin != null &&
    noteRangeMax != null &&
    Number.isFinite(savedMin) &&
    Number.isFinite(savedMax) &&
    savedMax >= savedMin;
  // A fixed song-wide range keeps pitch lanes in the same place while the
  // timeline moves. Explicit song settings have priority over inferred notes.
  const minMidi =
    Math.floor(
      hasSavedRange ? savedMin + keyShift : Math.min(...songMidiValues),
    ) - 2;
  const maxMidi =
    Math.ceil(
      hasSavedRange ? savedMax + keyShift : Math.max(...songMidiValues),
    ) + 2;
  const pitchRange = Math.max(1, maxMidi - minMidi + 1);
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(22, Math.max(7, rowHeight - 6));
  const activeNote = visibleNotes.find(
    (note) => currentTime >= note.start && currentTime < note.end,
  );
  const activeMidi = activeNote?.midi + keyShift;
  const cueNote =
    activeNote ||
    visibleNotes.find(
      (note) =>
        note.start >= currentTime - 0.08 && note.start <= currentTime + 1.4,
    ) ||
    visibleNotes.find((note) => note.end >= currentTime);

  const x = (time) =>
    noteLaneStart +
    ((time - viewStart) / windowSeconds) * (width - noteLaneStart);
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;

  return (
    <div className="melody-roll">
      <div className="melody-roll-header">
        <div>
          <div className="melody-roll-caption">Мелодическая карта</div>
          <strong>{songTitle}</strong>
        </div>
        <div
          className="melody-roll-legend"
          aria-label="Обозначения мелодической карты"
        >
          <span>
            <i className="melody-legend-dot melody-legend-reference" />
            Эталон
          </span>
          <span>
            <i className="melody-legend-dot melody-legend-active" />
            Сейчас
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-label="Ноты мелодии"
      >
        <defs>
          <linearGradient id="melody-note-past" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#a5b4fc" stopOpacity=".46" />
            <stop offset="1" stopColor="#6366f1" stopOpacity=".2" />
          </linearGradient>
          <linearGradient id="melody-note-upcoming" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f0abfc" stopOpacity=".92" />
            <stop offset="1" stopColor="#db2777" stopOpacity=".62" />
          </linearGradient>
          <linearGradient id="melody-note-active" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#d9f99d" />
            <stop offset=".45" stopColor="#4ade80" />
            <stop offset="1" stopColor="#16a34a" />
          </linearGradient>
          <linearGradient id="melody-scale-rail" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgba(16,13,30,.52)" />
            <stop offset="1" stopColor="rgba(25,17,43,.16)" />
          </linearGradient>
          <filter
            id="melody-active-glow"
            x="-40%"
            y="-100%"
            width="180%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="melody-playhead-glow"
            x="-150%"
            y="-20%"
            width="400%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect
          x="0"
          y="0"
          width={scaleWidth}
          height={height}
          rx="12"
          fill="url(#melody-scale-rail)"
          stroke="rgba(129,140,248,.2)"
        />
        {Array.from({ length: 5 }, (_, index) => (
          <line
            key={`beat-${index}`}
            x1={noteLaneStart + (index / 4) * (width - noteLaneStart)}
            x2={noteLaneStart + (index / 4) * (width - noteLaneStart)}
            y1={0}
            y2={height}
            stroke="rgba(196,181,253,.09)"
          />
        ))}
        {Array.from({ length: pitchRange }, (_, index) => {
          const midi = minMidi + index;
          const isOctave = midi % 12 === 0;
          const isCurrentPitch = activeMidi === midi;
          return (
            <g key={midi}>
              {isCurrentPitch && (
                <rect
                  x="1"
                  y={y(midi) + 1}
                  width={scaleWidth - 2}
                  height={Math.max(9, rowHeight - 2)}
                  rx="7"
                  fill="rgba(99,102,241,.3)"
                />
              )}
              <line
                x1={noteLaneStart}
                x2={width}
                y1={y(midi) + rowHeight}
                y2={y(midi) + rowHeight}
                stroke={
                  isOctave ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.055)"
                }
              />
              <>
                {isCurrentPitch && (
                  <path
                    d={`M36 ${y(midi) + rowHeight / 2 - 6} L46 ${y(midi) + rowHeight / 2} L36 ${y(midi) + rowHeight / 2 + 6}Z`}
                    fill="#d9f99d"
                  />
                )}
                <text
                  x="23"
                  y={y(midi) + rowHeight / 2 + 4}
                  textAnchor="middle"
                  fill={
                    isCurrentPitch
                      ? "#f5f3ff"
                      : isOctave
                        ? "rgba(245,243,255,.9)"
                        : "rgba(221,214,254,.63)"
                  }
                  fontSize={rowHeight < 16 ? "9" : "12"}
                  fontWeight={isCurrentPitch || isOctave ? "800" : "650"}
                >
                  {midiToWesternNote(midi)}
                </text>
              </>
            </g>
          );
        })}
        {visibleNotes.map((n, i) => {
          const isCurrent = currentTime >= n.start && currentTime < n.end;
          const isCue = n === cueNote;
          const isPast = n.end < currentTime;
          const pastOpacity = isPast
            ? Math.max(0.08, 1 - (currentTime - n.end) / 2.4)
            : 1;
          const noteX = Math.max(noteLaneStart, x(n.start));
          const noteWidth = Math.max(3, Math.min(width, x(n.end)) - noteX - 4);
          const noteY = y(n.midi + keyShift) + (rowHeight - noteHeight) / 2;
          return (
            <g key={i} opacity={pastOpacity}>
              <rect
                x={noteX}
                y={noteY}
                width={noteWidth}
                height={noteHeight}
                rx={Math.min(9, Math.max(3.5, noteHeight / 3))}
                fill={
                  isCurrent || isCue
                    ? "url(#melody-note-active)"
                    : isPast
                      ? "url(#melody-note-past)"
                      : "url(#melody-note-upcoming)"
                }
                filter={
                  isCurrent || isCue ? "url(#melody-active-glow)" : undefined
                }
                stroke={
                  isCurrent || isCue
                    ? "#bef264"
                    : isPast
                      ? "rgba(165,180,252,.52)"
                      : "rgba(251,207,232,.8)"
                }
                strokeWidth="1.25"
              />
              {isCue && (
                <circle
                  cx={Math.min(width - 10, noteX + noteWidth - 7)}
                  cy={noteY + noteHeight / 2}
                  r={Math.min(8, noteHeight / 2 + 2)}
                  fill="rgba(255,255,255,.08)"
                  stroke="#f0fdf4"
                  strokeWidth="2.5"
                />
              )}
            </g>
          );
        })}
        <g
          transform={`translate(${x(currentTime)} 0)`}
          filter="url(#melody-playhead-glow)"
        >
          <line
            x1="0"
            x2="0"
            y1="29"
            y2={height}
            stroke="#60a5fa"
            strokeOpacity={0.98}
            strokeWidth={2.5}
          />
        </g>
      </svg>
    </div>
  );
}
