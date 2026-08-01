import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  ArrowLeft,
  Maximize,
  Type,
  AudioLines,
  Mic,
  Settings2,
  Cog,
  SlidersHorizontal,
  Check,
  ChevronDown,
  Zap,
  ShieldCheck,
  X,
  Volume2,
  VolumeX,
  Trash2,
  Trophy,
} from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Dropdown } from "../components/Dropdown";
import { useAppDialog } from "../components/AppDialog";
import { KARAOKE_THEMES, shuffleThemes } from "../assets/karaoke/themes";

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
    .map((line) => {
      const fallbackStart = Number(line.start ?? line.begin ?? 0);
      const fallbackEnd = Number(line.end ?? fallbackStart + 2);
      const words = Array.isArray(line.words)
        ? line.words
            .map((word) => ({
              text: word.word || word.text || "",
              start: Number(word.start ?? fallbackStart),
              end: Number(word.end ?? fallbackEnd),
            }))
            .filter(
              (word) =>
                word.text &&
                Number.isFinite(word.start) &&
                Number.isFinite(word.end) &&
                word.end >= word.start,
            )
        : [];
      // Segment boundaries can be several tenths of a second away from the
      // sung phrase.  Word marks are produced from the vocal track, so use
      // them as the canonical line bounds whenever they exist.
      const start = words.length ? words[0].start : fallbackStart;
      const end = words.length ? words.at(-1).end : fallbackEnd;
      return {
        start,
        end: Math.max(start, end),
        text: line.text || line.line || "",
        words,
      };
    })
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

const KEY_PITCHES = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const SHARP_KEYS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
function transposeKey(key, semitones) {
  if (!key) return "Тональность не определена";
  const match = /^([A-G](?:#|b)?)(.*)$/i.exec(key.trim());
  if (!match) return key;
  const [, rootText, suffix] = match;
  const root = rootText[0].toUpperCase() + rootText.slice(1);
  const pitch = KEY_PITCHES[root];
  if (pitch == null) return key;
  return `${SHARP_KEYS[(pitch + semitones + 120) % 12]}${suffix}`;
}

function detectMidiFromAnalyser(analyser, buffer, sampleRate) {
  analyser.getFloatTimeDomainData(buffer);
  let energy = 0;
  for (let index = 0; index < buffer.length; index += 1)
    energy += buffer[index] ** 2;
  if (Math.sqrt(energy / buffer.length) < 0.012) return null;

  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(buffer.length - 2, Math.floor(sampleRate / 75));
  let bestLag = -1;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < buffer.length - lag; index += 1) {
      const left = buffer[index];
      const right = buffer[index + lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const score = correlation / Math.sqrt(leftEnergy * rightEnergy || 1);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore < 0.62) return null;
  const frequency = sampleRate / bestLag;
  return Number.isFinite(frequency)
    ? 69 + 12 * Math.log2(frequency / 440)
    : null;
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

function playbackGain(value) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return normalized ** 2;
}

function createPanoramaPath() {
  return {
    xPhaseA: Math.random() * Math.PI * 2,
    xPhaseB: Math.random() * Math.PI * 2,
    xPhaseC: Math.random() * Math.PI * 2,
    yPhaseA: Math.random() * Math.PI * 2,
    yPhaseB: Math.random() * Math.PI * 2,
  };
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

export default function Karaoke({ onOpenAppSettings }) {
  const location = useLocation();
  const navigate = useNavigate();
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
  const melodyGuideRef = useRef(null);
  const melodyNotesRef = useRef([]);
  const melodyVolumeRef = useRef(0);
  const melodyKeyShiftRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [sungMidi, setSungMidi] = useState(null);
  const [isPitchDetected, setIsPitchDetected] = useState(false);
  const [isPitchAttacking, setIsPitchAttacking] = useState(false);
  const [pitchRestProgress, setPitchRestProgress] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [preferences] = useState(loadKaraokePreferences);
  const [musicVolume, setMusicVolume] = useState(
    () => preferences.musicVolume ?? 1,
  );
  const [vocalVolume, setVocalVolume] = useState(
    () => preferences.vocalVolume ?? 1,
  );
  const [melodyVolume, setMelodyVolume] = useState(
    () => preferences.melodyVolume ?? 0,
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
  const [audioDriver, setAudioDriver] = useState("auto");
  const [asioDriverName, setAsioDriverName] = useState("");
  const [audioBufferSize, setAudioBufferSize] = useState(64);
  const [directOutputDeviceId, setDirectOutputDeviceId] = useState("");
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
  const [auroraSeed] = useState(() => Math.floor(Math.random() * 997));
  const themeQueueRef = useRef(shuffleThemes());
  const appliedThemeSongRef = useRef(song?.id);
  const [activeTheme, setActiveTheme] = useState(
    () => themeQueueRef.current.pop() || KARAOKE_THEMES[0],
  );
  const panoramaSkyRef = useRef(null);
  const panoramaClockRef = useRef(0);
  const panoramaPathRef = useRef(createPanoramaPath());
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
  const { data: directOutputDevices } = usePolling(
    () => (microphoneOpen ? api.listAudioOutputDevices() : Promise.resolve([])),
    30000,
    [microphoneOpen],
  );
  const { data: asioDrivers } = usePolling(
    () => (microphoneOpen ? api.listAsioDrivers() : Promise.resolve([])),
    30000,
    [microphoneOpen],
  );
  const { data: audioSettings } = usePolling(
    () => api.getAudioSettings(),
    30000,
    [],
  );
  const { data: signal } = usePolling(
    () => (microphoneOpen ? api.getSignalQuality() : Promise.resolve(null)),
    1200,
    [microphoneOpen],
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
    const offsetSine = (phase) => Math.sin(phase);

    const move = (now) => {
      const elapsed = now - startedAt;
      const theta = ((elapsed % cycleMs) / cycleMs) * Math.PI * 2;
      // Integer harmonics make the 240-second path closed: frame 0 and the
      // final frame have identical position and velocity, so no loop is seen.
      const x =
        22 * (Math.sin(theta + path.xPhaseA) - offsetSine(path.xPhaseA)) +
        13 *
          (Math.sin(theta * 3 + path.xPhaseB) - offsetSine(path.xPhaseB)) +
        7 *
          (Math.sin(theta * 5 + path.xPhaseC) - offsetSine(path.xPhaseC));
      const y =
        48 +
        2.4 *
          (Math.sin(theta * 2 + path.yPhaseA) - offsetSine(path.yPhaseA)) +
        1.2 *
          (Math.sin(theta * 5 + path.yPhaseB) - offsetSine(path.yPhaseB));
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
    audioSettings?.monitoring_enabled,
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
    const preferred = (directOutputDevices || []).find((device) =>
      device.name.toLowerCase().includes("audient"),
    );
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      updateMicrophone({ output_device_id: preferred.index });
    }
  }, [
    audioDriver,
    audioSettings?.output_device_id,
    directOutputDevices,
    directOutputDeviceId,
    microphoneOpen,
  ]);

  useEffect(() => {
    if (
      !microphoneOpen ||
      !directOutputDeviceId ||
      !navigator.mediaDevices?.enumerateDevices
    )
      return;
    const selected = (directOutputDevices || []).find(
      (device) => String(device.index) === String(directOutputDeviceId),
    );
    if (!selected) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((entries) => {
        const output = entries.find(
          (entry) =>
            entry.kind === "audiooutput" &&
            selected.name.toLowerCase().includes(entry.label.toLowerCase()),
        );
        if (!output?.deviceId) return;
        [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
          (media) => media?.setSinkId?.(output.deviceId).catch(() => {}),
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
    [],
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
        melodyVolume,
        speed,
        keyShift,
        showLyrics,
        showNotes,
      }),
    );
  }, [
    musicVolume,
    vocalVolume,
    melodyVolume,
    speed,
    keyShift,
    showLyrics,
    showNotes,
  ]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(
    () => normalizeNotes(result?.reference_notes),
    [result],
  );
  melodyNotesRef.current = notes;
  melodyVolumeRef.current = melodyVolume;
  melodyKeyShiftRef.current = keyShift;
  const youTubeVideoId = getYouTubeVideoId(song?.video_url);

  // Lyrics and melody use the same instrumental clock.  A former global
  // "anchor" delay shifted every word by up to half a second even when the
  // word-level alignment was already correct for the current song.
  const lyricTime = currentTime;

  const currentLineIndex = lyrics.findIndex(
    (l) => lyricTime >= l.start && lyricTime < l.end,
  );
  const currentLine = lyrics[currentLineIndex];
  const upcomingLine = lyrics.find((line) => line.start > lyricTime);
  // Before a phrase starts, upcomingLine is already the large primary cue.
  // Do not render it a second time as the "next" line underneath.
  const nextLine = currentLine ? lyrics[currentLineIndex + 1] : null;

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

  function updateMelodyGuide(position) {
    const guide = melodyGuideRef.current;
    if (!guide || guide.context.state === "closed") return;

    const now = guide.context.currentTime;
    const volume = melodyVolumeRef.current;
    const note = melodyNotesRef.current.find(
      (item) => position >= item.start && position < item.end,
    );
    if (!note || volume <= 0) {
      guide.gain.gain.setTargetAtTime(0.0001, now, 0.018);
      return;
    }

    const midi = note.midi + melodyKeyShiftRef.current;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    guide.oscillator.frequency.setTargetAtTime(frequency, now, 0.012);
    guide.gain.gain.setTargetAtTime(0.12 * volume ** 2, now, 0.015);
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
        updateMelodyGuide(position);
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
                : {}),
            },
          });
          ownsStream = true;
        }
        if (!context) {
          context = new AudioContext({ latencyHint: "interactive" });
          ownsContext = true;
        }
        if (cancelled) return;
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
              context.sampleRate,
            );
            if (Number.isFinite(detectedMidi)) {
              // Individual autocorrelation readings can jump by a semitone or octave.
              // Use a short median window; the visible marker itself moves separately
              // at a capped, constant speed below.
              recentMidi.push(detectedMidi);
              if (recentMidi.length > 3) recentMidi.shift();
              const sortedMidi = [...recentMidi].sort(
                (left, right) => left - right,
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
              Math.max(0.001, (timestamp - lastAnimationAt) / 1000),
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
      silenceMelodyGuide();
      setIsPlaying(false);
      if (recordingSessionId)
        await api.pauseRecording(recordingSessionId).catch(() => {});
      return;
    } else {
      // Create/resume Web Audio while this click is still a user gesture.
      const melodyStart = startMelodyGuide().catch(() => {});
      try {
        if (recordingSessionId) {
          await api.resumeRecording(recordingSessionId);
        } else {
          const session = await api.startRecording(
            song.id,
            instr.currentTime,
            playbackGain(musicVolume),
            playbackGain(vocalVolume),
          );
          setRecordingSessionId(session.recording_session_id);
        }
        setRecordingError(null);
      } catch (error) {
        silenceMelodyGuide();
        setRecordingError(`Не удалось начать запись: ${error.message}`);
        return;
      }
      syncSecondaryMedia(instr.currentTime, true);
      instr.volume = playbackGain(musicVolume);
      voc.volume = playbackGain(vocalVolume);
      sendYouTubeCommand("playVideo");
      try {
        await melodyStart;
        await instr.play();
        await Promise.allSettled(
          [voc.play(), videoRef.current?.play()].filter(Boolean),
        );
      } catch {
        setIsPlaying(false);
        return;
      }
    }
    setIsPlaying(true);
  };

  const stop = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    instr.pause();
    voc.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
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
    // Stop marks the end of a take. Do not leave a temporary monitor open;
    // the next Play starts it again automatically.
    const monitor = browserMonitorRef.current;
    monitor?.stream.getTracks().forEach((track) => track.stop());
    monitor?.context.close();
    browserMonitorRef.current = null;
    setMonitoringEnabled(false);
    await api.stopDirectMonitoring().catch(() => {});
  };

  const returnToLibrary = async () => {
    await stop();
    navigate("/");
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
      setMonitoringEnabled(enabled);
    } catch (error) {
      setMonitoringEnabled(false);
      if (!enabled) await api.stopDirectMonitoring().catch(() => {});
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
    if (!instr) return;
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

  useEffect(() => {
    const shell = document.querySelector(".karaoke-app-shell");
    const main = containerRef.current?.parentElement;
    const stage = containerRef.current;
    if (!shell || !main || !stage) return undefined;

    const syncStageAspect = () => {
      const currentExtra =
        Number.parseFloat(
          getComputedStyle(shell).getPropertyValue("--karaoke-nav-extra"),
        ) || 0;
      const fullAvailableHeight = main.clientHeight + currentExtra;
      const targetStageHeight = (main.clientWidth * 9) / 16;
      shell.style.setProperty(
        "--karaoke-nav-extra",
        `${Math.max(0, fullAvailableHeight - targetStageHeight)}px`,
      );

      const videoWidth = Math.max(
        stage.clientWidth,
        (stage.clientHeight * 16) / 9,
      );
      const videoHeight = Math.max(
        stage.clientHeight,
        (stage.clientWidth * 9) / 16,
      );
      stage.style.setProperty(
        "--karaoke-video-width",
        `${Math.ceil(videoWidth) + 2}px`,
      );
      stage.style.setProperty(
        "--karaoke-video-height",
        `${Math.ceil(videoHeight) + 2}px`,
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
        minHeight: "calc(100vh - 72px)",
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
            <label
              className={audioDriver === "asio" ? "advanced-audio-setting" : ""}
            >
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
            <label className="audio-driver-setting">
              Аудиодрайвер
              <Dropdown
                value={audioDriver}
                disabled={monitoringEnabled}
                onChange={async (value) => {
                  setAudioDriver(value);
                  await updateMicrophone({ audio_driver: value });
                }}
                options={[
                  { value: "auto", label: "Авто · Windows / PortAudio" },
                  ...((asioDrivers || []).length
                    ? [{ value: "asio", label: "ASIO · минимальная задержка" }]
                    : []),
                ]}
              />
              {!(asioDrivers || []).length && (
                <small>
                  ASIO появится после установки драйвера аудиоинтерфейса.
                </small>
              )}
            </label>
            {audioDriver === "asio" && (
              <label className="asio-driver-setting">
                ASIO-драйвер
                <Dropdown
                  value={asioDriverName}
                  disabled={monitoringEnabled}
                  onChange={async (value) => {
                    setAsioDriverName(value);
                    await updateMicrophone({ asio_driver_name: value });
                  }}
                  options={(asioDrivers || []).map((driver) => ({
                    value: driver.name,
                    label: driver.name,
                  }))}
                />
                <small>
                  Для Audient выбран нативный драйвер аудиоинтерфейса.
                </small>
              </label>
            )}
            <label className="advanced-audio-setting">
              Буфер аудио
              <Dropdown
                value={audioBufferSize}
                disabled={monitoringEnabled}
                onChange={async (value) => {
                  const bufferSize = Number(value);
                  setAudioBufferSize(bufferSize);
                  await updateMicrophone({ buffer_size: bufferSize });
                }}
                options={[32, 64, 128, 256, 512].map((value) => ({
                  value,
                  label: `${value} samples`,
                }))}
              />
            </label>
            <label className="advanced-audio-setting">
              Выход прямого мониторинга
              <Dropdown
                value={directOutputDeviceId}
                disabled={monitoringEnabled}
                onChange={async (value) => {
                  const deviceId = value === "" ? null : Number(value);
                  setDirectOutputDeviceId(value);
                  await updateMicrophone({ output_device_id: deviceId });
                }}
                options={[
                  { value: "", label: "Системное устройство по умолчанию" },
                  ...(directOutputDevices || []).map((device) => ({
                    value: device.index,
                    label: device.name,
                  })),
                ]}
              />
              <small>
                Для минимальной задержки выберите выход того же аудиоинтерфейса.
              </small>
            </label>
            <label className="legacy-browser-monitoring">
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
            <label className="legacy-browser-monitoring">
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
            <label className="legacy-browser-monitoring">
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
            <div
              className="monitoring-mode-picker legacy-browser-monitoring"
              ref={monitorModeMenuRef}
            >
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
            <label className="microphone-gain-setting">
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
                onChange={(event) => setDirectMonitoring(event.target.checked)}
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
                  "--aurora-depth": `${1 + (index % 4)}`,
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
                    "#fff3d5",
                  ][index % 4],
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
          <button className="btn btn-ghost" onClick={() => skip(-5)}>
            <SkipBack size={16} />
          </button>
          <button
            className="btn btn-primary karaoke-play-button"
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
              className="btn btn-ghost"
              title="Вернуться в библиотеку"
              aria-label="Вернуться в библиотеку"
              onClick={() => {
                void returnToLibrary();
              }}
            >
              <ArrowLeft size={18} />
            </button>
            {onOpenAppSettings && (
              <button
                className="btn karaoke-app-settings"
                title="Настройки приложения"
                aria-label="Настройки приложения"
                onClick={onOpenAppSettings}
              >
                <Cog size={18} />
              </button>
            )}
            <button
              className={`btn ${microphoneOpen ? "btn-primary" : "btn-ghost"}`}
              title="Настройки караоке"
              onClick={() => setMicrophoneOpen(true)}
            >
              <SlidersHorizontal size={18} />
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

function KaraokeLyricLine({
  line,
  currentTime,
  className,
}) {
  const words = line.words?.length
    ? line.words
    : line.text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((text) => ({ text }));
  const totalWeight =
    words.reduce((sum, word) => sum + Math.max(word.text.length, 1), 0) || 1;
  let passedWeight = 0;
  const wordTimings = words.map((word) => {
    const weight = Math.max(word.text.length, 1) / totalWeight;
    const declaredStart = Number(word.start);
    const declaredEnd = Number(word.end);
    const start = Number.isFinite(declaredStart)
      ? declaredStart
      : line.start + (passedWeight / totalWeight) * (line.end - line.start);
    const end = Number.isFinite(declaredEnd) && declaredEnd > start
      ? declaredEnd
      : start + weight * (line.end - line.start);
    passedWeight += Math.max(word.text.length, 1);
    return { start, end };
  });

  return (
    <div className={className}>
      {words.map((word, index) => {
        const { start: wordStart, end: wordEnd } = wordTimings[index];
        const fill = Math.max(
          0,
          Math.min(
            1,
            (currentTime - wordStart) / Math.max(0.01, wordEnd - wordStart),
          ),
        );
        const characters = Array.from(word.text);
        const characterProgress = fill * characters.length;
        return (
          <span
            className="karaoke-lyric-word"
            style={{ "--lyric-fill": `${Math.round(fill * 100)}%` }}
            key={`${word.text}-${index}`}
          >
            {characters.map((character, characterIndex) => (
              <span
                className="karaoke-lyric-character"
                style={{
                  "--character-fill": `${Math.round(
                    Math.max(
                      0,
                      Math.min(1, characterProgress - characterIndex),
                    ) * 100,
                  )}%`,
                }}
                key={`${character}-${characterIndex}`}
              >
                {character}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function WaveformTimeline({ value, duration, onChange }) {
  const bars = 220;
  const progress =
    duration > 0 ? Math.max(0, Math.min(1, value / duration)) : 0;
  const seekFromPointer = (event) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    onChange(ratio * duration);
  };

  return (
    <div
      className="waveform-timeline"
      onPointerDown={(event) => {
        event.preventDefault();
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) seekFromPointer(event);
      }}
      onClick={seekFromPointer}
    >
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
        tabIndex={-1}
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

function PerformanceAnalysisModal({ recordingId, onClose, onDone, onDeleted }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const analysisRequestRef = useRef(null);
  const { confirm: confirmDialog } = useAppDialog();

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

  const deleteRecording = async () => {
    if (!(await confirmDialog("Удалить это записанное исполнение?"))) return;
    setDeleting(true);
    try {
      await api.deleteRecording(recordingId);
      onDeleted();
    } catch (deleteError) {
      setError(`Не удалось удалить запись: ${deleteError.message}`);
      setDeleting(false);
    }
  };

  return (
    <div
      className="performance-analysis-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Анализ выступления"
    >
      <section className="performance-analysis-modal">
        <div className="analysis-victory-scene" aria-hidden="true">
          <div className="analysis-trophy">
            <Trophy size={38} fill="currentColor" />
          </div>
          <div className="analysis-crystal" />
          <div className="analysis-confetti">
            {Array.from({ length: 26 }, (_, index) => (
              <i key={index} style={{ "--j": index }} />
            ))}
          </div>
        </div>
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
            <div className="performance-analysis-actions">
              <button
                className="btn btn-danger"
                onClick={deleteRecording}
                disabled={deleting}
              >
                <Trash2 size={14} /> {deleting ? "Удаляем…" : "Удалить запись"}
              </button>
              <button className="btn btn-primary" onClick={onDone}>
                Готово
              </button>
            </div>
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
  sungMidi,
  isPitchDetected,
  isPitchAttacking,
  pitchRestProgress,
  keyShift,
  songTitle,
  noteRangeMin,
  noteRangeMax,
}) {
  const width = 1000;
  const height = 310;
  const scaleWidth = 38;
  const noteLaneStart = 54;
  // Keep a moderately shorter window: notes are more legible without making
  // the timeline feel detached from the music.
  const windowSeconds = 10;
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
  const targetMidi = cueNote?.midi + keyShift;
  const isInTune =
    isPitchDetected &&
    Number.isFinite(sungMidi) &&
    Number.isFinite(targetMidi) &&
    Math.abs(sungMidi - targetMidi) <= 0.7;
  const indicatorMidi = Number.isFinite(sungMidi) ? sungMidi : targetMidi;
  const hasLivePitch = isPitchDetected && Number.isFinite(sungMidi);
  const visibleMidiLanes = [
    ...new Set(visibleNotes.map((note) => note.midi + keyShift)),
  ].sort((a, b) => a - b);
  const displayMidiLanes = visibleMidiLanes.length
    ? Array.from(
        { length: visibleMidiLanes.at(-1) - visibleMidiLanes[0] + 5 },
        (_, index) => visibleMidiLanes[0] - 2 + index,
      )
    : [];

  const x = (time) =>
    noteLaneStart +
    ((time - viewStart) / windowSeconds) * (width - noteLaneStart);
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;
  const pitchY = Number.isFinite(indicatorMidi)
    ? y(indicatorMidi) + rowHeight / 2
    : height - 16;
  const indicatorY =
    pitchY +
    (height - 16 - pitchY) * Math.min(1, Math.max(0, pitchRestProgress));

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
            <stop offset="0" stopColor="#dbeafe" />
            <stop offset=".45" stopColor="#a5b4fc" />
            <stop offset="1" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient id="melody-note-hit" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#dcfce7" />
            <stop offset=".45" stopColor="#4ade80" />
            <stop offset="1" stopColor="#16a34a" />
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
        {displayMidiLanes.map((midi) => {
          const isOctave = midi % 12 === 0;
          const isCurrentPitch = activeMidi === midi;
          return (
            <g key={midi}>
              {isCurrentPitch && (
                <rect
                  x="2"
                  y={y(midi) + 1}
                  width={scaleWidth - 4}
                  height={Math.max(9, rowHeight - 2)}
                  rx="7"
                  fill="rgba(129,140,248,.22)"
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
                    d={`M27 ${y(midi) + rowHeight / 2 - 5} L39 ${y(midi) + rowHeight / 2} L27 ${y(midi) + rowHeight / 2 + 5}Z`}
                    fill="#c4b5fd"
                  />
                )}
                <text
                  x="18"
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
          const isHit = isInTune && isCurrent;
          const isPast = n.end < currentTime;
          const pastOpacity = isPast
            ? Math.max(0.08, 1 - (currentTime - n.end) / 2.4)
            : 1;
          const noteX = Math.max(noteLaneStart, x(n.start));
          // Keep event boundaries visible even when two consecutive syllables
          // have the same pitch.  Without a deliberate screen-space gap they
          // look like one long note despite being separate MIDI events.
          const noteWidth = Math.max(3, Math.min(width, x(n.end)) - noteX - 7);
          const noteY = y(n.midi + keyShift) + (rowHeight - noteHeight) / 2;
          return (
            <g
              key={i}
              opacity={pastOpacity}
              className={`melody-note-platform ${isCurrent ? "is-current" : ""} ${isHit ? "is-hit" : ""}`}
            >
              <rect
                x={noteX}
                y={noteY}
                width={noteWidth}
                height={noteHeight}
                rx={Math.min(9, Math.max(3.5, noteHeight / 3))}
                fill={
                  isHit
                    ? "url(#melody-note-hit)"
                    : isCurrent
                      ? "url(#melody-note-active)"
                      : isPast
                        ? "url(#melody-note-past)"
                        : "url(#melody-note-upcoming)"
                }
                filter={isCurrent ? "url(#melody-active-glow)" : undefined}
                stroke={
                  isHit
                    ? "#86efac"
                    : isCurrent
                      ? "#c4b5fd"
                      : isPast
                        ? "rgba(165,180,252,.52)"
                        : "rgba(251,207,232,.8)"
                }
                strokeWidth="1.25"
              />
              {isCurrent && (
                <circle
                  cx={Math.min(width - 10, noteX + noteWidth - 7)}
                  cy={noteY + noteHeight / 2}
                  r={Math.min(8, noteHeight / 2 + 2)}
                  fill="rgba(255,255,255,.08)"
                  stroke="#e0e7ff"
                  strokeWidth="2.5"
                />
              )}
            </g>
          );
        })}
        {Number.isFinite(indicatorMidi) &&
          indicatorMidi >= minMidi - 1 &&
          indicatorMidi <= maxMidi + 1 && (
            <g
              transform={`translate(${x(currentTime)} 0)`}
              opacity={hasLivePitch ? 1 : 0.38}
            >
              <path
                d={`M-88 ${indicatorY} C-58 ${indicatorY - 10}, -26 ${indicatorY + 10}, 0 ${indicatorY}`}
                fill="none"
                stroke={
                  hasLivePitch
                    ? isInTune
                      ? "rgba(134,239,172,.78)"
                      : "rgba(249,168,212,.64)"
                    : "rgba(219,234,254,.18)"
                }
                strokeWidth="4"
                strokeLinecap="round"
                opacity=".7"
              />
              <circle
                cy={indicatorY}
                r="14"
                fill={
                  hasLivePitch
                    ? isInTune
                      ? "rgba(34,197,94,.22)"
                      : "rgba(244,114,182,.2)"
                    : "rgba(219,234,254,.08)"
                }
                style={{
                  transition: isPitchAttacking ? "none" : "cy .11s linear",
                }}
              />
              <circle
                cy={indicatorY}
                r="7"
                fill={
                  hasLivePitch
                    ? isInTune
                      ? "#86efac"
                      : "#f9a8d4"
                    : "rgba(219,234,254,.14)"
                }
                stroke={hasLivePitch ? "#fff" : "rgba(255,255,255,.45)"}
                strokeWidth="2"
                style={{
                  transition: isPitchAttacking ? "none" : "cy .11s linear",
                }}
              />
            </g>
          )}
      </svg>
    </div>
  );
}
