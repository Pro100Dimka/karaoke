import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Play, Pause, Square, SkipBack, SkipForward, Maximize, Type, AudioLines, Mic, Settings2, Check, ChevronDown, Zap, ShieldCheck, X,
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
    .map((l) => ({ start: l.start ?? l.begin ?? 0, end: l.end ?? l.start + 2, text: l.text || l.line || "" }))
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
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.end) && Number.isFinite(note.midi));
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

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    title: "\u041f\u0440\u044f\u043c\u043e\u0439 \u0434\u0440\u0430\u0439\u0432\u0435\u0440",
    description: "\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0430. \u041d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u044b \u0430\u0443\u0434\u0438\u043e\u0434\u0440\u0430\u0439\u0432\u0435\u0440 \u0438 \u043d\u0430\u0443\u0448\u043d\u0438\u043a\u0438.",
    Icon: Zap,
  },
  {
    id: "browser",
    title: "\u0421\u043e\u0432\u043c\u0435\u0441\u0442\u0438\u043c\u044b\u0439",
    description: "\u0420\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0441 \u043e\u0431\u044b\u0447\u043d\u044b\u043c\u0438 USB-\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d\u0430\u043c\u0438. \u0412\u043e\u0437\u043c\u043e\u0436\u043d\u0430 \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0430.",
    Icon: ShieldCheck,
  },
];

export default function Karaoke() {
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || []).find((s) => s.status === "done");

  const [result, setResult] = useState(null);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [preferences] = useState(loadKaraokePreferences);
  const [musicVolume, setMusicVolume] = useState(() => preferences.musicVolume ?? 1);
  const [vocalVolume, setVocalVolume] = useState(() => preferences.vocalVolume ?? 1);
  const [speed, setSpeed] = useState(() => preferences.speed ?? 1);
  // ВАЖНО: keyShift сейчас смещает только отображаемую линию мелодии
  // (транспонирует ноты на экране), а НЕ реальный питч аудио — честный
  // питч-шифтинг воспроизведения в браузере требует DSP-библиотеки вроде
  // SoundTouch-js/Rubberband и здесь не реализован. Если нужен настоящий
  // сдвиг тональности звука — это отдельная задача.
  const [keyShift, setKeyShift] = useState(() => preferences.keyShift ?? 0);
  const [showLyrics, setShowLyrics] = useState(() => preferences.showLyrics ?? true);
  const [showNotes, setShowNotes] = useState(() => preferences.showNotes ?? true);
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const [microphoneOpen, setMicrophoneOpen] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const [microphoneVolume, setMicrophoneVolume] = useState(1);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [browserAudioDevices, setBrowserAudioDevices] = useState({ inputs: [], outputs: [] });
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
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  const { data: devices } = usePolling(api.listAudioDevices, 15000, []);
  const { data: audioSettings } = usePolling(api.getAudioSettings, 5000, []);
  const { data: signal } = usePolling(
    () => (microphoneOpen ? api.getSignalQuality() : Promise.resolve(null)),
    1200,
    [microphoneOpen]
  );

  useEffect(() => {
    if (audioSettings?.volume != null && !microphoneVolumeInitializedRef.current) {
      microphoneVolumeInitializedRef.current = true;
      setMicrophoneVolume(audioSettings.volume);
    }
  }, [audioSettings?.volume]);

  useEffect(() => () => {
    const monitor = browserMonitorRef.current;
    monitor?.stream.getTracks().forEach((track) => track.stop());
    monitor?.context.close();
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!monitorModeMenuRef.current?.contains(event.target)) setMonitorModeOpen(false);
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
    navigator.mediaDevices.enumerateDevices().then((mediaDevices) => {
      setBrowserAudioDevices({
        inputs: mediaDevices.filter((device) => device.kind === "audioinput"),
        outputs: mediaDevices.filter((device) => device.kind === "audiooutput"),
      });
    }).catch(() => {});
  }, [microphoneOpen]);

  useEffect(() => {
    if (!song || song.status !== "done") return;
    api.getResult(song.id).then(setResult).catch(() => setResult(null));
  }, [song?.id, song?.status]);

  useEffect(() => {
    localStorage.setItem(KARAOKE_PREFERENCES_KEY, JSON.stringify({
      musicVolume, vocalVolume, speed, keyShift, showLyrics, showNotes,
    }));
  }, [musicVolume, vocalVolume, speed, keyShift, showLyrics, showNotes]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(() => normalizeNotes(result?.reference_notes), [result]);

  const currentLineIndex = lyrics.findIndex((l) => currentTime >= l.start && currentTime < l.end);
  const currentLine = lyrics[currentLineIndex];
  const upcomingLine = lyrics.find((line) => line.start > currentTime);
  const nextLine = currentLine ? lyrics[currentLineIndex + 1] : upcomingLine;
  const previousLine = currentLine
    ? lyrics[currentLineIndex - 1]
    : [...lyrics].reverse().find((line) => line.end <= currentTime);
  const secondsUntilLyrics = upcomingLine ? Math.max(0, upcomingLine.start - currentTime) : 0;

  // Держим instrumental/vocals синхронизированными между собой.
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
      if (Number.isFinite(position)) setCurrentTime(position);
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
    [instrumentalRef.current, vocalsRef.current].forEach((el) => el && (el.playbackRate = speed));
  }, [speed]);

  const togglePlay = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    if (isPlaying) {
      instr.pause();
      voc.pause();
      if (recordingSessionId) await api.pauseRecording(recordingSessionId).catch(() => {});
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
      voc.currentTime = instr.currentTime;
      try {
        await Promise.all([instr.play(), voc.play()]);
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
    instr.currentTime = 0;
    voc.currentTime = 0;
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
      setRecordingError(`Не удалось сохранить настройки микрофона: ${error.message}`);
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
          ...(monitorInputDeviceId !== "default" ? { deviceId: { exact: monitorInputDeviceId } } : {}),
        },
      });
      const context = new AudioContext({ latencyHint: monitorLatencyHint });
      if (monitorOutputDeviceId !== "default" && typeof context.setSinkId === "function") {
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
      setRecordingError(`Не удалось включить прослушивание микрофона: ${error.message}`);
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
      setRecordingError(`Не удалось включить прямое прослушивание: ${error.message}`);
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
    voc.currentTime = time;
    setCurrentTime(time);
  };

  const skip = (delta) => seekTo(Math.max(0, Math.min(duration, currentTime + delta)));

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
        <p className="text-muted">Нет готовой песни для воспроизведения. Сначала обработайте песню в Библиотеке.</p>
      </div>
    );
  }
  if (song.status !== "done") {
    return (
      <div className="panel">
        <p className="text-muted">«{song.title}» ещё не обработана — статус: {song.status}.</p>
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
        overflow: "hidden",
        position: "relative",
        minHeight: 560,
        background:
          "linear-gradient(rgba(10,7,21,0.55), rgba(10,7,21,0.75)), radial-gradient(circle at 50% 20%, rgba(139,92,246,0.35), transparent 60%)",
      }}
    >
      <audio ref={instrumentalRef} src={api.getAudioTrackUrl(song.id, "instrumental")} preload="auto" />
      <audio ref={vocalsRef} src={api.getAudioTrackUrl(song.id, "vocals")} preload="auto" />

      {microphoneOpen && (
        <div className="karaoke-settings-backdrop" onMouseDown={() => setMicrophoneOpen(false)}>
        <div className="microphone-panel karaoke-settings-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="microphone-panel-title"><Settings2 size={15} /> Настройки караоке</div>
          <button type="button" className="karaoke-settings-close" title="Закрыть настройки" onClick={() => setMicrophoneOpen(false)}><X size={16} /></button>
          <div className="karaoke-settings-section">
            <div className="karaoke-settings-section-title">Отображение и воспроизведение</div>
            <div className="karaoke-settings-toggles">
              <button className={`btn ${showLyrics ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowLyrics((value) => !value)}><Type size={14} /> Текст</button>
              <button className={`btn ${showNotes ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowNotes((value) => !value)}><AudioLines size={14} /> Ноты</button>
            </div>
            <div className="karaoke-settings-sliders">
              <SliderField label="Громкость музыки" value={musicVolume} min={0} max={1} step={0.05} onChange={setMusicVolume} display={`${Math.round(musicVolume * 100)}%`} />
              <SliderField label="Громкость вокала" value={vocalVolume} min={0} max={1} step={0.05} onChange={setVocalVolume} display={`${Math.round(vocalVolume * 100)}%`} />
              <SliderField label="Скорость" value={speed} min={0.5} max={1.5} step={0.05} onChange={setSpeed} display={`${speed.toFixed(2)}x`} />
              <SliderField label="Тональность" value={keyShift} min={-6} max={6} step={1} onChange={setKeyShift} display={`${keyShift > 0 ? "+" : ""}${keyShift}`} />
            </div>
          </div>
          <label>Устройство ввода
            <Dropdown value={audioSettings?.input_device_id ?? ""}
              onChange={(value) => updateMicrophone({ input_device_id: value === "" ? null : Number(value) })}
              options={[{ value: "", label: "По умолчанию" }, ...(devices || []).map((device) => ({ value: device.index, label: device.name }))]} />
          </label>
          <label>Вход для прослушивания
            <Dropdown value={monitorInputDeviceId} disabled={monitoringEnabled} onChange={setMonitorInputDeviceId}
              options={[{ value: "default", label: "Системное по умолчанию" }, ...browserAudioDevices.inputs.map((device) => ({ value: device.deviceId, label: device.label || "Микрофон" }))]} />
          </label>
          <label>Выход для прослушивания
            <Dropdown value={monitorOutputDeviceId} disabled={monitoringEnabled} onChange={setMonitorOutputDeviceId}
              options={[{ value: "default", label: "Системное по умолчанию" }, ...browserAudioDevices.outputs.map((device) => ({ value: device.deviceId, label: device.label || "Аудиоустройство" }))]} />
          </label>
          <label>Режим задержки
            <Dropdown value={monitorLatencyHint} disabled={monitoringEnabled} onChange={setMonitorLatencyHint}
              options={[{ value: "interactive", label: "Низкая задержка" }, { value: "balanced", label: "Автоматический" }, { value: "playback", label: "Стабильное воспроизведение" }]} />
          </label>
          <div className="monitoring-mode-picker" ref={monitorModeMenuRef}>
            <span>{"\u0420\u0435\u0436\u0438\u043c \u043f\u0440\u043e\u0441\u043b\u0443\u0448\u0438\u0432\u0430\u043d\u0438\u044f"}</span>
            <button type="button" className="monitoring-mode-trigger" disabled={monitoringEnabled}
              aria-haspopup="listbox" aria-expanded={monitorModeOpen}
              onClick={() => setMonitorModeOpen((open) => !open)}>
              {(() => {
                const selected = MONITORING_MODES.find((mode) => mode.id === monitorMode);
                const Icon = selected.Icon;
                return <><Icon size={15} /><span>{selected.title}</span><ChevronDown size={15} /></>;
              })()}
            </button>
            {monitorModeOpen && (
              <div className="monitoring-mode-menu" role="listbox" aria-label="Режим прослушивания">
                <div className="monitoring-mode-menu-title">Выберите способ прослушивания</div>
                {MONITORING_MODES.map(({ id, title, description, Icon }) => {
                  const selected = id === monitorMode;
                  return (
                    <button type="button" role="option" aria-selected={selected} key={id}
                      className={`monitoring-mode-option ${selected ? "is-selected" : ""}`}
                      onClick={() => { setMonitorMode(id); setMonitorModeOpen(false); }}>
                      <Icon size={17} /><span className="monitoring-mode-option-copy"><strong>{title}</strong><small>{description}</small></span>
                      {selected && <Check className="monitoring-mode-check" size={17} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <label>Громкость микрофона: {Math.round((microphoneVolume / 4) * 100)}%
            <input type="range" min="0" max="4" step="0.05" value={microphoneVolume}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMicrophoneVolume(value);
                if (browserMonitorRef.current) browserMonitorRef.current.gainNode.gain.value = value;
              }}
              onPointerUp={(event) => updateMicrophone({ volume: Number(event.currentTarget.value) })}
              onBlur={(event) => updateMicrophone({ volume: Number(event.currentTarget.value) })} />
          </label>
          <label className="microphone-monitoring">
            <input type="checkbox" checked={monitoringEnabled}
              onChange={(event) => (monitorMode === "direct" ? setDirectMonitoring : setBrowserMonitoring)(event.target.checked)} />
            Прослушивать с этого устройства
          </label>
          <div className="microphone-level">
            <div>Уровень: {signal ? `${signal.rms_db} дБFS${signal.clipping ? " · перегрузка" : signal.silent ? " · тихо" : ""}` : "проверяем…"}</div>
            <div className="microphone-level-track"><div className="microphone-level-fill" style={{ width: `${microphoneLevel}%` }} /></div>
            <span>{Math.round(microphoneLevel)}%</span>
          </div>
          <div className="microphone-effects">Для прослушивания используйте наушники: через колонки возможна обратная связь.</div>
        </div>
        </div>
      )}

      {recordingError && <p className="karaoke-recording-error">{recordingError}</p>}
      {analysisRecordingId && <PerformanceAnalysisModal recordingId={analysisRecordingId} onClose={() => setAnalysisRecordingId(null)} />}

      <div className="karaoke-performance-stage">
        {/* Piano-roll notes: visible pitch lanes make melody and intervals readable. */}
        {showNotes && notes.length > 0 && (
          <MelodyRoll notes={notes} currentTime={currentTime} keyShift={keyShift} songTitle={song.title} />
        )}

        {/* Large, high-contrast lyric cue, placed over the note stage. */}
        {showLyrics && (
          <div className="karaoke-lyrics">
          {lyrics.length === 0 && <p className="text-muted">Синхронизированный текст недоступен</p>}
          {previousLine && <div className="karaoke-lyric karaoke-lyric-muted">{previousLine.text}</div>}
          {currentLine ? (
            <div className="karaoke-lyric karaoke-lyric-current">{currentLine.text}</div>
          ) : upcomingLine ? (
            secondsUntilLyrics > 8
              ? <div className="karaoke-lyric karaoke-lyric-current">{"\u0412\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435 \u00b7 \u0441\u043b\u043e\u0432\u0430 \u0447\u0435\u0440\u0435\u0437 "}{formatTime(secondsUntilLyrics)}</div>
              : <div className="karaoke-lyric karaoke-lyric-current">{upcomingLine.text}</div>
          ) : lyrics.length > 0 && <div className="karaoke-lyric karaoke-lyric-current">{"\u041f\u0435\u0441\u043d\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430"}</div>}
          {nextLine && <div className="karaoke-lyric karaoke-lyric-next">{nextLine.text}</div>}
          </div>
        )}
      </div>

      {/* Таймлайн + транспорт */}
      <div className="karaoke-transport-area" style={{ padding: "12px 24px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#a855f7" }}
          />
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>{formatTime(duration)}</span>
        </div>

        <div className="karaoke-playback-controls" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <button className="btn btn-ghost" onClick={() => skip(-5)}><SkipBack size={16} /></button>
          <button
            className="btn btn-primary"
            style={{ width: 46, height: 46, borderRadius: "50%", justifyContent: "center" }}
            onClick={togglePlay}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn btn-ghost" onClick={stop}><Square size={16} /></button>
          <button className="btn btn-ghost" onClick={() => skip(5)}><SkipForward size={16} /></button>
          <div className="karaoke-corner-actions">
            <button className={`btn ${microphoneOpen ? "btn-primary" : "btn-ghost"}`} title="Настройки караоке" onClick={() => setMicrophoneOpen(true)}>
              <Settings2 size={18} />
            </button>
            <button className="btn btn-ghost" title="На весь экран" onClick={toggleFullscreen}>
              <Maximize size={18} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, display, disabled }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", marginBottom: 4 }}>
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

  useEffect(() => {
    let active = true;
    api.runAnalysis(recordingId)
      .then((analysis) => active && setResult(analysis))
      .catch((analysisError) => active && setError(analysisError.message));
    return () => { active = false; };
  }, [recordingId]);

  return (
    <div className="performance-analysis-backdrop" role="dialog" aria-modal="true" aria-label="Анализ выступления">
      <section className="performance-analysis-modal">
        <button className="karaoke-settings-close" title="Закрыть" onClick={onClose}><X size={17} /></button>
        <div className="performance-analysis-heading">Анализ выступления</div>
        {!result && !error && <p className="text-muted">Анализируем ноты и ритм исполнения…</p>}
        {error && <><p className="song-lyrics-error">Не удалось выполнить анализ: {error}</p><button className="btn btn-primary" onClick={onClose}>Закрыть</button></>}
        {result && <>
          <div className="performance-analysis-score">{result.pitch_accuracy_percent ?? "—"}<small>%</small></div>
          <div className="text-muted">Попадание в ноты</div>
          <div className="performance-analysis-metrics">
            <div><span>Среднее отклонение</span><strong>{result.mean_deviation_semitones != null ? `±${result.mean_deviation_semitones} п/т` : "—"}</strong></div>
            <div><span>Проверено фрагментов</span><strong>{result.sections?.length || 0}</strong></div>
          </div>
          <audio className="performance-analysis-audio" controls autoPlay src={api.getPerformanceFileUrl(recordingId)} />
          <button className="btn btn-primary" onClick={onClose}>Готово</button>
        </>}
      </section>
    </div>
  );
}

function MelodyRoll({ notes, currentTime, keyShift, songTitle }) {
  const width = 1000;
  const height = 310;
  const windowSeconds = 12;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = notes.filter((note) => note.end >= viewStart && note.start <= viewEnd);
  const scaleNotes = visibleNotes.length > 0 ? visibleNotes : notes;
  const midiValues = scaleNotes.map((n) => n.midi + keyShift);
  const minMidi = Math.floor(Math.min(...midiValues)) - 2;
  const maxMidi = Math.ceil(Math.max(...midiValues)) + 2;
  const pitchRange = Math.max(1, maxMidi - minMidi + 1);
  const rowHeight = height / pitchRange;

  const x = (time) => ((time - viewStart) / windowSeconds) * width;
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;

  return (
    <div className="melody-roll">
      <div className="melody-roll-caption">{songTitle}</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-label="Ноты мелодии">
        {Array.from({ length: pitchRange }, (_, index) => {
          const midi = minMidi + index;
          const isOctave = midi % 12 === 0;
          return <g key={midi}>
            <line x1={0} x2={width} y1={y(midi) + rowHeight} y2={y(midi) + rowHeight}
              stroke={isOctave ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"} />
            {isOctave && <text x={8} y={y(midi) + rowHeight - 4} fill="rgba(255,255,255,0.45)" fontSize="20">C{Math.floor(midi / 12) - 1}</text>}
          </g>;
        })}
        {visibleNotes.map((n, i) => (
          <rect
            key={i}
            x={Math.max(0, x(n.start))}
            y={y(n.midi + keyShift) + 3}
            width={Math.max(4, Math.min(width, x(n.end)) - Math.max(0, x(n.start)) - 2)}
            height={Math.max(8, rowHeight - 6)}
            rx={5}
            fill={currentTime >= n.start && currentTime < n.end ? "#f472b6" : "rgba(139,92,246,0.76)"}
          />
        ))}
        <line x1={x(currentTime)} x2={x(currentTime)} y1={0} y2={height} stroke="#fff" strokeOpacity={0.9} strokeWidth={2} />
      </svg>
    </div>
  );
}
