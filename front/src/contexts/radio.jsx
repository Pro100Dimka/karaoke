import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readJsonStorage, writeJsonStorage } from "../utils/storage";

export const RADIO_STATIONS = [
  {
    id: "poptron",
    name: "SomaFM PopTron",
    description: "Весёлый электропоп и танцевальные хиты",
    streams: [
      "https://ice5.somafm.com/poptron-128-mp3",
      "https://ice2.somafm.com/poptron-128-mp3"
    ]
  },
  {
    id: "indiepop",
    name: "SomaFM Indie Pop Rocks",
    description: "Яркий инди-поп и знакомые припевы",
    streams: [
      "https://ice5.somafm.com/indiepop-128-mp3",
      "https://ice2.somafm.com/indiepop-128-mp3"
    ]
  },
  {
    id: "beatblender",
    name: "SomaFM Beat Blender",
    description: "Энергичная электроника и ровный бит",
    streams: [
      "https://ice5.somafm.com/beatblender-128-mp3",
      "https://ice2.somafm.com/beatblender-128-mp3"
    ]
  },
  {
    id: "groovesalad",
    name: "SomaFM Groove Salad",
    description: "Спокойный фон и мягкий бас",
    streams: [
      "https://ice5.somafm.com/groovesalad-128-mp3",
      "https://ice2.somafm.com/groovesalad-128-mp3"
    ]
  }
];

const STORAGE_KEY = "karaoke-radio";
const DEFAULT_SETTINGS = { stationId: "poptron", volume: 0.45, enabled: true };
const RadioContext = createContext(null);

function loadRadioSettings() {
  const stored = readJsonStorage(STORAGE_KEY);
  const stationId = RADIO_STATIONS.some(({ id }) => id === stored.stationId)
    ? stored.stationId
    : DEFAULT_SETTINGS.stationId;
  const storedVolume = Number(stored.volume);
  const volume = Number.isFinite(storedVolume)
    ? Math.max(0, Math.min(1, storedVolume))
    : DEFAULT_SETTINGS.volume;

  return {
    stationId,
    volume,
    enabled:
      typeof stored.enabled === "boolean"
        ? stored.enabled
        : DEFAULT_SETTINGS.enabled
  };
}

export function RadioProvider({ children }) {
  const initial = useMemo(loadRadioSettings, []);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const frequencyDataRef = useRef(null);
  const bassRef = useRef(0);
  const animationRef = useRef(0);
  const analysisVersionRef = useRef(0);
  const streamIndexRef = useRef(0);
  const suspendedRef = useRef(false);
  const resumeAfterRecordingRef = useRef(false);
  const playbackVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const [stationId, setStationIdState] = useState(initial.stationId);
  const [volume, setVolumeState] = useState(initial.volume);
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const station = RADIO_STATIONS.find(({ id }) => id === stationId) || RADIO_STATIONS[0];

  const persist = useCallback((patch) => {
    const next = { ...loadRadioSettings(), ...patch };
    writeJsonStorage(STORAGE_KEY, next);
  }, []);

  const stopAnalysis = useCallback(() => {
    analysisVersionRef.current += 1;
    cancelAnimationFrame(animationRef.current);
    bassRef.current = 0;
    document.documentElement.style.setProperty("--radio-bass", "0");
  }, []);

  const startAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const data = frequencyDataRef.current;
    const audioContext = audioContextRef.current;
    if (!analyser || !data || !audioContext) return;

    const analysisVersion = analysisVersionRef.current + 1;
    analysisVersionRef.current = analysisVersion;
    const readBass = () => {
      if (
        analysisVersion !== analysisVersionRef.current ||
        audioContext.state === "closed" ||
        analyserRef.current !== analyser
      ) return;
      try {
        analyser.getByteFrequencyData(data);
      } catch {
        stopAnalysis();
        return;
      }
      const binHz = audioContext.sampleRate / analyser.fftSize;
      const firstBin = Math.max(1, Math.floor(35 / binHz));
      const lastBin = Math.min(data.length - 1, Math.ceil(180 / binHz));
      let sum = 0;
      for (let index = firstBin; index <= lastBin; index += 1) sum += data[index];
      const raw = sum / Math.max(1, lastBin - firstBin + 1) / 255;
      bassRef.current += (raw - bassRef.current) * (raw > bassRef.current ? 0.38 : 0.1);
      document.documentElement.style.setProperty("--radio-bass", bassRef.current.toFixed(3));
      animationRef.current = requestAnimationFrame(readBass);
    };

    cancelAnimationFrame(animationRef.current);
    readBass();
  }, [stopAnalysis]);

  const prepareAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;

    const existing = audioContextRef.current;
    if (existing && existing.state !== "closed") return existing;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    const source = context.createMediaElementSource(audio);
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    analyser.connect(context.destination);

    audioContextRef.current = context;
    analyserRef.current = analyser;
    frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    return context;
  }, []);

  const unlockAudioAnalysis = useCallback(async () => {
    try {
      const context = prepareAudioGraph();
      if (!context) return;
      if (context.state === "suspended") await context.resume();
      if (!audioRef.current?.paused) startAnalysis();
    } catch (reason) {
      // Радио продолжает играть и без Web Audio. Анализатор подключится
      // после следующего пользовательского жеста.
      console.warn("Radio analyser activation deferred", reason);
    }
  }, [prepareAudioGraph, startAnalysis]);

  const loadStream = useCallback((index = 0, nextStation = station) => {
    const audio = audioRef.current;
    if (!audio) return;
    streamIndexRef.current = index;
    audio.src = nextStation.streams[index];
    audio.load();
  }, [station]);

  const turnOn = useCallback(async ({ remember = true, analyse = true } = {}) => {
    const audio = audioRef.current;
    if (!audio || suspendedRef.current) return false;
    const playbackVersion = playbackVersionRef.current + 1;
    playbackVersionRef.current = playbackVersion;
    if (mountedRef.current) {
      setError("");
      setLoading(true);
    }
    try {
      if (!audio.src) loadStream(0);
      await audio.play();
      if (
        !mountedRef.current ||
        playbackVersion !== playbackVersionRef.current ||
        suspendedRef.current ||
        audioRef.current !== audio
      ) {
        audio.pause();
        return false;
      }
      setPlaying(true);
      if (remember) persist({ enabled: true });
      if (analyse) await unlockAudioAnalysis();
      return true;
    } catch (reason) {
      if (mountedRef.current && playbackVersion === playbackVersionRef.current) {
        setPlaying(false);
        setError("Не удалось запустить радио");
        console.error("Radio playback failed", reason);
      }
      return false;
    } finally {
      if (mountedRef.current && playbackVersion === playbackVersionRef.current) {
        setLoading(false);
      }
    }
  }, [loadStream, persist, unlockAudioAnalysis]);

  const turnOff = useCallback(({ remember = true } = {}) => {
    playbackVersionRef.current += 1;
    audioRef.current?.pause();
    setPlaying(false);
    setLoading(false);
    if (remember) persist({ enabled: false });
    stopAnalysis();
  }, [persist, stopAnalysis]);

  const toggle = useCallback(() => {
    if (isPlaying) turnOff();
    else turnOn();
  }, [isPlaying, turnOff, turnOn]);

  const setVolume = useCallback((value) => {
    const numericValue = Number(value);
    const next = Number.isFinite(numericValue)
      ? Math.max(0, Math.min(1, numericValue))
      : DEFAULT_SETTINGS.volume;
    setVolumeState(next);
    if (audioRef.current) audioRef.current.volume = next;
    persist({ volume: next });
  }, [persist]);

  const setStation = useCallback((nextId) => {
    const next = RADIO_STATIONS.find(({ id }) => id === nextId);
    if (!next || next.id === stationId) return;
    const shouldResume = isPlaying || isLoading;
    playbackVersionRef.current += 1;
    audioRef.current?.pause();
    stopAnalysis();
    setPlaying(false);
    setLoading(false);
    setError("");
    setStationIdState(next.id);
    persist({ stationId: next.id });
    streamIndexRef.current = 0;
    loadStream(0, next);
    if (shouldResume && !suspendedRef.current) {
      turnOn({ remember: false }).catch(() => {});
    }
  }, [
    isLoading,
    isPlaying,
    loadStream,
    persist,
    stationId,
    stopAnalysis,
    turnOn
  ]);

  const setRecordingActive = useCallback((active) => {
    if (active && !suspendedRef.current) {
      suspendedRef.current = true;
      resumeAfterRecordingRef.current = isPlaying;
      if (isPlaying) turnOff({ remember: false });
      return;
    }
    if (!active && suspendedRef.current) {
      suspendedRef.current = false;
      const shouldResume = resumeAfterRecordingRef.current;
      resumeAfterRecordingRef.current = false;
      if (shouldResume) turnOn({ remember: false });
    }
  }, [isPlaying, turnOff, turnOn]);

  const handleStreamError = useCallback(() => {
    const nextIndex = streamIndexRef.current + 1;
    if (nextIndex < station.streams.length) {
      loadStream(nextIndex);
      if (isPlaying || isLoading) audioRef.current?.play().catch(() => {});
      return;
    }
    setPlaying(false);
    setLoading(false);
    setError(`${station.name} временно недоступна`);
    stopAnalysis();
  }, [isLoading, isPlaying, loadStream, station, stopAnalysis]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    mountedRef.current = true;
    if (initial.enabled) turnOn({ remember: false, analyse: false });
    return () => {
      mountedRef.current = false;
      playbackVersionRef.current += 1;
      stopAnalysis();
      const audio = audioRef.current;
      audio?.pause();
      if (audio) {
        audio.removeAttribute("src");
        audio.load();
      }
      const context = audioContextRef.current;
      audioContextRef.current = null;
      analyserRef.current = null;
      frequencyDataRef.current = null;
      context?.close?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlock = () => {
      unlockAudioAnalysis();
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };

    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [unlockAudioAnalysis]);

  const value = useMemo(() => ({
    error,
    isLoading,
    isPlaying,
    station,
    stationId,
    stations: RADIO_STATIONS,
    volume,
    setRecordingActive,
    setStation,
    setVolume,
    toggle,
    turnOff,
    turnOn,
    getBassLevel: () => bassRef.current
  }), [error, isLoading, isPlaying, setRecordingActive, setStation, setVolume, station, stationId, toggle, turnOff, turnOn, volume]);

  return (
    <RadioContext.Provider value={value}>
      {children}
      <audio ref={audioRef} crossOrigin="anonymous" preload="none" onError={handleStreamError} />
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const context = useContext(RadioContext);
  if (!context) throw new Error("useRadio must be used inside RadioProvider");
  return context;
}
