import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
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
const STARTUP_FADE_MS = 2000;
const RadioContext = createContext(null);

const isAutoplayBlocked = (reason) =>
  reason?.name === "NotAllowedError" ||
  /user didn't interact|user gesture|not allowed/i.test(
    String(reason?.message ?? reason ?? "")
  );

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
  const spectrumRef = useRef(Array(18).fill(0));
  const animationRef = useRef(0);
  const volumeFadeRef = useRef(0);
  const analysisVersionRef = useRef(0);
  const streamIndexRef = useRef(0);
  const suspendedRef = useRef(false);
  const resumeAfterRecordingRef = useRef(false);
  const playbackVersionRef = useRef(0);
  const streamAttemptRef = useRef(false);
  const pendingStartupPlaybackRef = useRef(false);
  const mountedRef = useRef(true);
  const [stationId, setStationIdState] = useState(initial.stationId);
  const [volume, setVolumeState] = useState(initial.volume);
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const volumeRef = useRef(initial.volume);

  const station =
    RADIO_STATIONS.find(({ id }) => id === stationId) || RADIO_STATIONS[0];

  const persist = useCallback((patch) => {
    const next = { ...loadRadioSettings(), ...patch };
    writeJsonStorage(STORAGE_KEY, next);
  }, []);

  const cancelVolumeFade = useCallback(() => {
    cancelAnimationFrame(volumeFadeRef.current);
    volumeFadeRef.current = 0;
  }, []);

  const fadeVolumeIn = useCallback(
    (targetVolume, duration = STARTUP_FADE_MS) => {
      const audio = audioRef.current;
      if (!audio) return;

      cancelVolumeFade();
      const target = Math.max(0, Math.min(1, Number(targetVolume) || 0));
      audio.volume = 0;
      if (target === 0) return;

      const startedAt = performance.now();
      const step = (now) => {
        if (audioRef.current !== audio || audio.paused) {
          volumeFadeRef.current = 0;
          return;
        }

        const progress = Math.min(1, (now - startedAt) / duration);
        // Smoothstep: мягкий старт и мягкое достижение сохранённой громкости.
        const eased = progress * progress * (3 - 2 * progress);
        audio.volume = target * eased;

        if (progress < 1) volumeFadeRef.current = requestAnimationFrame(step);
        else volumeFadeRef.current = 0;
      };

      volumeFadeRef.current = requestAnimationFrame(step);
    },
    [cancelVolumeFade]
  );

  const stopAnalysis = useCallback(() => {
    analysisVersionRef.current += 1;
    cancelAnimationFrame(animationRef.current);
    bassRef.current = 0;
    spectrumRef.current.fill(0);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--radio-bass", "0");
    rootStyle.setProperty("--radio-analysis-active", "0");
    spectrumRef.current.forEach((_, index) => {
      rootStyle.setProperty(`--radio-band-${index}`, "0");
    });
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
      )
        return;
      try {
        analyser.getByteFrequencyData(data);
      } catch {
        stopAnalysis();
        return;
      }
      const binHz = audioContext.sampleRate / analyser.fftSize;
      const averageRange = (fromHz, toHz) => {
        const first = Math.max(1, Math.floor(fromHz / binHz));
        const last = Math.min(data.length - 1, Math.ceil(toHz / binHz));
        let sum = 0;
        for (let index = first; index <= last; index += 1) sum += data[index];
        return sum / Math.max(1, last - first + 1) / 255;
      };

      const rawBass = averageRange(35, 180);
      bassRef.current +=
        (rawBass - bassRef.current) * (rawBass > bassRef.current ? 0.46 : 0.12);

      // 18 logarithmic-ish bands. Each visual column gets its own energy, so
      // the terrain and song cards behave like an equalizer instead of one
      // surface moving up and down as a whole.
      const bands = spectrumRef.current;
      const minHz = 45;
      const maxHz = Math.min(12000, audioContext.sampleRate * 0.45);
      for (let band = 0; band < bands.length; band += 1) {
        const t0 = band / bands.length;
        const t1 = (band + 1) / bands.length;
        const fromHz = minHz * (maxHz / minHz) ** t0;
        const toHz = minHz * (maxHz / minHz) ** t1;
        const raw = averageRange(fromHz, toHz);
        const boosted = Math.min(
          1,
          raw * (band < 5 ? 1.42 : band < 12 ? 1.72 : 2.05)
        );
        const response = boosted > bands[band] ? 0.58 : 0.16;
        bands[band] += (boosted - bands[band]) * response;
      }

      const rootStyle = document.documentElement.style;
      rootStyle.setProperty("--radio-bass", bassRef.current.toFixed(3));
      rootStyle.setProperty("--radio-analysis-active", "1");
      bands.forEach((level, index) => {
        rootStyle.setProperty(`--radio-band-${index}`, level.toFixed(3));
      });
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
    } catch {
      // Радио продолжает играть и без Web Audio. Анализатор подключится
      // после следующего пользовательского жеста.
    }
  }, [prepareAudioGraph, startAnalysis]);

  const loadStream = useCallback(
    (index = 0, nextStation = station) => {
      const audio = audioRef.current;
      if (!audio) return;
      streamIndexRef.current = index;
      audio.src = nextStation.streams[index];
      audio.load();
    },
    [station]
  );

  const turnOn = useCallback(
    async ({
      remember = true,
      analyse = true,
      startIndex = 0,
      targetStation = station,
      fadeIn = false
    } = {}) => {
      const audio = audioRef.current;
      if (!audio || suspendedRef.current) return false;

      const playbackVersion = playbackVersionRef.current + 1;
      playbackVersionRef.current = playbackVersion;

      if (mountedRef.current) {
        setError("");
        setLoading(true);
      }

      let lastError = null;
      streamAttemptRef.current = true;

      try {
        // Try every mirror sequentially. Previously onError switched the stream
        // while the original audio.play() promise was still pending, so that
        // rejected promise could overwrite a successful fallback with an error.
        for (let pass = 0; pass < 2; pass += 1) {
          for (
            let index = startIndex;
            index < targetStation.streams.length;
            index += 1
          ) {
            if (
              playbackVersion !== playbackVersionRef.current ||
              suspendedRef.current ||
              audioRef.current !== audio
            ) {
              audio.pause();
              return false;
            }

            try {
              loadStream(index, targetStation);
              if (fadeIn) audio.volume = 0;
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

              pendingStartupPlaybackRef.current = false;
              setPlaying(true);
              setError("");
              if (fadeIn) fadeVolumeIn(volumeRef.current);
              else audio.volume = volumeRef.current;
              if (remember) persist({ enabled: true });
              if (analyse) await unlockAudioAnalysis();
              return true;
            } catch (reason) {
              lastError = reason;
              audio.pause();

              // Chromium can still reject autoplay even when Electron requests
              // a permissive policy. This is not a broken stream: defer the
              // startup playback until the first real user gesture instead of
              // cycling mirrors and showing a scary error.
              if (fadeIn && isAutoplayBlocked(reason)) {
                pendingStartupPlaybackRef.current = true;
                if (mountedRef.current) {
                  setPlaying(false);
                  setLoading(false);
                  setError("");
                }
                return false;
              }
            }
          }

          // A short second pass absorbs transient DNS/network/player startup
          // failures without showing a false error immediately on app launch.
          if (pass === 0) {
            startIndex = 0;
            await new Promise((resolve) => {
              setTimeout(resolve, 500);
            });
          }
        }

        throw lastError || new Error("No radio stream could be played");
      } catch (reason) {
        if (
          mountedRef.current &&
          playbackVersion === playbackVersionRef.current
        ) {
          setPlaying(false);
          setError("Не удалось запустить радио");
          setError(
            reason?.message
              ? `Не удалось запустить радио: ${reason.message}`
              : "Не удалось запустить радио"
          );
        }
        return false;
      } finally {
        streamAttemptRef.current = false;
        if (
          mountedRef.current &&
          playbackVersion === playbackVersionRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [fadeVolumeIn, loadStream, persist, station, unlockAudioAnalysis]
  );

  const turnOff = useCallback(
    ({ remember = true } = {}) => {
      playbackVersionRef.current += 1;
      cancelVolumeFade();
      audioRef.current?.pause();
      setPlaying(false);
      setLoading(false);
      if (remember) persist({ enabled: false });
      stopAnalysis();
    },
    [cancelVolumeFade, persist, stopAnalysis]
  );

  const toggle = useCallback(() => {
    if (isPlaying) turnOff();
    else turnOn();
  }, [isPlaying, turnOff, turnOn]);

  const setVolume = useCallback(
    (value) => {
      const numericValue = Number(value);
      const next = Number.isFinite(numericValue)
        ? Math.max(0, Math.min(1, numericValue))
        : DEFAULT_SETTINGS.volume;
      volumeRef.current = next;
      setVolumeState(next);
      cancelVolumeFade();
      if (audioRef.current) audioRef.current.volume = next;
      persist({ volume: next });
    },
    [cancelVolumeFade, persist]
  );

  const setStation = useCallback(
    (nextId) => {
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
        turnOn({ remember: false, targetStation: next }).catch(() => {});
      }
    },
    [isLoading, isPlaying, loadStream, persist, stationId, stopAnalysis, turnOn]
  );

  const setRecordingActive = useCallback(
    (active) => {
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
    },
    [isPlaying, turnOff, turnOn]
  );

  const handleStreamError = useCallback(() => {
    // Initial/fallback playback is handled by turnOn() itself so onError must
    // not race with its pending play() promise.
    if (streamAttemptRef.current) return;

    const nextIndex = streamIndexRef.current + 1;
    if (nextIndex < station.streams.length && isPlaying) {
      turnOn({ remember: false, startIndex: nextIndex }).catch(() => {});
      return;
    }

    setPlaying(false);
    setLoading(false);
    setError(`${station.name} временно недоступна`);
    stopAnalysis();
  }, [isPlaying, station, stopAnalysis, turnOn]);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current && !volumeFadeRef.current)
      audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    mountedRef.current = true;
    if (initial.enabled)
      turnOn({ remember: false, analyse: true, fadeIn: true });
    return () => {
      mountedRef.current = false;
      playbackVersionRef.current += 1;
      cancelVolumeFade();
      stopAnalysis();
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
  }, [cancelVolumeFade, initial.enabled, stopAnalysis, turnOn]);

  useEffect(() => {
    const unlock = () => {
      // A genuine gesture is the only universally reliable way to satisfy
      // Chromium autoplay restrictions. If startup playback was blocked,
      // resume it here with the same gentle fade-in.
      if (
        pendingStartupPlaybackRef.current &&
        initial.enabled &&
        !suspendedRef.current
      ) {
        pendingStartupPlaybackRef.current = false;
        turnOn({ remember: false, analyse: true, fadeIn: true }).catch(
          () => {}
        );
      } else {
        unlockAudioAnalysis();
      }
    };

    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [initial.enabled, turnOn, unlockAudioAnalysis]);

  const value = useMemo(
    () => ({
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
      getBassLevel: () => bassRef.current,
      getSpectrumLevels: () => spectrumRef.current
    }),
    [
      error,
      isLoading,
      isPlaying,
      setRecordingActive,
      setStation,
      setVolume,
      station,
      stationId,
      toggle,
      turnOff,
      turnOn,
      volume
    ]
  );

  return (
    <RadioContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="none"
        onError={handleStreamError}
      />
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const context = useContext(RadioContext);
  if (!context) throw new Error("useRadio must be used inside RadioProvider");
  return context;
}
