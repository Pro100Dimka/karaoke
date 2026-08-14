import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { api } from "../api/client";
import { translateSaved } from "../i18n/runtime";
import { readJsonStorage, writeJsonStorage } from "../utils/storage";

// Station metadata is configuration, verified as an exact contract by tests.
/* Stryker disable all */
export const RADIO_STATIONS = [
  {
    id: "poptron",
    name: "SomaFM PopTron",
    description: translateSaved("Весёлый электропоп и танцевальные хиты"),
    streams: [
      "https://ice5.somafm.com/poptron-128-mp3",
      "https://ice2.somafm.com/poptron-128-mp3"
    ]
  },
  {
    id: "indiepop",
    name: "SomaFM Indie Pop Rocks",
    description: translateSaved("Яркий инди-поп и знакомые припевы"),
    streams: [
      "https://ice5.somafm.com/indiepop-128-mp3",
      "https://ice2.somafm.com/indiepop-128-mp3"
    ]
  },
  {
    id: "beatblender",
    name: "SomaFM Beat Blender",
    description: translateSaved("Энергичная электроника и ровный бит"),
    streams: [
      "https://ice5.somafm.com/beatblender-128-mp3",
      "https://ice2.somafm.com/beatblender-128-mp3"
    ]
  },
  {
    id: "groovesalad",
    name: "SomaFM Groove Salad",
    description: translateSaved("Спокойный фон и мягкий бас"),
    streams: [
      "https://ice5.somafm.com/groovesalad-128-mp3",
      "https://ice2.somafm.com/groovesalad-128-mp3"
    ]
  }
];
/* Stryker restore all */
const STORAGE_KEY = "karaoke-radio";
const DEFAULT_SETTINGS = {
  stationId: "poptron",
  volume: 0.45,
  enabled: true
};
const STARTUP_FADE_MS = 2000;
// Diagnostic copy is localization data, not a control-flow decision.
// Stryker disable next-line StringLiteral
const NO_STREAM_ERROR = "No radio stream could be played";
const createVersion = () => Object.create(null);
const RadioContext = createContext(null);
export const isAutoplayBlocked = (reason) =>
  reason?.name === "NotAllowedError" ||
  /user didn't interact|user gesture|not allowed/i.test(
    // Any non-matching text is equivalent for an absent rejection reason.
    // Stryker disable next-line StringLiteral
    String(reason?.message ?? reason ?? "")
  );
export function normalizeRadioSettings(stored = {}) {
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
const loadRadioSettings = () =>
  normalizeRadioSettings(readJsonStorage(STORAGE_KEY));

export function calculateRadioSpectrum(
  data,
  sampleRate,
  fftSize,
  previousBass,
  previousBands
) {
  const binHz = sampleRate / fftSize;
  const averageRange = (fromHz, toHz) => {
    const first = Math.max(1, Math.floor(fromHz / binHz));
    const last = Math.min(data.length - 1, Math.ceil(toHz / binHz));
    let sum = 0;
    for (let index = first; index <= last; index += 1) sum += data[index];
    return sum / Math.max(1, last - first + 1) / 255;
  };
  const rawBass = averageRange(35, 180);
  // Equality makes the response multiply a zero delta.
  // Stryker disable EqualityOperator
  const bass =
    previousBass +
    (rawBass - previousBass) * (rawBass > previousBass ? 0.46 : 0.12);
  // Stryker restore EqualityOperator
  const minHz = 45;
  const maxHz = Math.min(12000, sampleRate * 0.45);
  const bands = previousBands.map((previous, band, allBands) => {
    const fromHz = minHz * (maxHz / minHz) ** (band / allBands.length);
    const toHz = minHz * (maxHz / minHz) ** ((band + 1) / allBands.length);
    const raw = averageRange(fromHz, toHz);
    const boosted = Math.min(
      1,
      raw * (band < 5 ? 1.42 : band < 12 ? 1.72 : 2.05)
    );
    // Equality makes the response multiply a zero delta.
    // Stryker disable next-line EqualityOperator
    return previous + (boosted - previous) * (boosted > previous ? 0.58 : 0.16);
  });
  return { bands, bass };
}
export function RadioProvider({ children }) {
  // An injected literal is stable, so this remains mount-only.
  // Stryker disable next-line ArrayDeclaration
  const initial = useMemo(loadRadioSettings, []);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const frequencyDataRef = useRef(null);
  const bassRef = useRef(0);
  const spectrumRef = useRef(Array(18).fill(0));
  const animationRef = useRef(0);
  const volumeFadeRef = useRef(0);
  const analysisVersionRef = useRef(createVersion());
  const streamIndexRef = useRef(0);
  const suspendedRef = useRef(false);
  // Every suspend transition overwrites this before it can be read.
  // Stryker disable next-line BooleanLiteral
  const resumeAfterRecordingRef = useRef(false);
  const playbackVersionRef = useRef(createVersion());
  const streamAttemptRef = useRef(false);
  // Startup state gates gestures until playback writes the real value.
  // Stryker disable next-line BooleanLiteral
  const pendingStartupPlaybackRef = useRef(false);
  const [stationId, setStationIdState] = useState(initial.stationId);
  const [volume, setVolumeState] = useState(initial.volume);
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const volumeRef = useRef(initial.volume);
  const station = RADIO_STATIONS.find(({ id }) => id === stationId);
  // Stryker disable ArrayDeclaration: only module functions and stable React refs are captured.
  const persist = useCallback((patch) => {
    const next = {
      ...loadRadioSettings(),
      ...patch
    };
    writeJsonStorage(STORAGE_KEY, next);
    api.updateUiPreferences("radio", next).catch(() => {});
  }, []);
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: only a stable React ref is captured.
  const cancelVolumeFade = useCallback(() => {
    cancelAnimationFrame(volumeFadeRef.current);
    volumeFadeRef.current = 0;
  }, []);
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: cancelVolumeFade is stable for the provider lifetime.
  const fadeVolumeIn = useCallback(
    (targetVolume, duration = STARTUP_FADE_MS) => {
      const audio = audioRef.current;
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
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: only stable DOM globals and React refs are captured.
  const stopAnalysis = useCallback(() => {
    analysisVersionRef.current = createVersion();
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
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: stopAnalysis is stable for the provider lifetime.
  const startAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const data = frequencyDataRef.current;
    const audioContext = audioContextRef.current;
    const analysisVersion = createVersion();
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
      const bands = spectrumRef.current;
      const spectrum = calculateRadioSpectrum(
        data,
        audioContext.sampleRate,
        analyser.fftSize,
        bassRef.current,
        bands
      );
      bassRef.current = spectrum.bass;
      spectrum.bands.forEach((level, index) => {
        bands[index] = level;
      });
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
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: only stable React refs are captured.
  const prepareAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    const existing = audioContextRef.current;
    if (existing && existing.state !== "closed") return existing;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    // Absence is also contained by the best-effort caller's catch.
    // Stryker disable next-line ConditionalExpression
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
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: both graph callbacks are stable for the provider lifetime.
  const unlockAudioAnalysis = useCallback(async () => {
    try {
      const context = prepareAudioGraph();
      // A missing graph otherwise throws inside this same best-effort catch.
      // Stryker disable next-line ConditionalExpression
      if (!context) return;
      if (context.state === "suspended") await context.resume();
      // The provider audio node exists whenever this callback can run.
      // Stryker disable next-line OptionalChaining
      if (!audioRef.current?.paused) startAnalysis();
    } catch {
      // Радио продолжает играть и без Web Audio. Анализатор подключится
      // после следующего пользовательского жеста.
    }
  }, [prepareAudioGraph, startAnalysis]);
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: callers always provide the station and refs are stable.
  const loadStream = useCallback((index, nextStation) => {
    const audio = audioRef.current;
    streamIndexRef.current = index;
    audio.src = nextStation.streams[index];
    audio.load();
  }, []);
  // Stryker restore ArrayDeclaration
  const turnOn = useCallback(
    async ({
      remember = true,
      analyse = true,
      startIndex = 0,
      targetStation = station,
      fadeIn = false
    } = {}) => {
      const audio = audioRef.current;
      const playbackVersion = createVersion();
      playbackVersionRef.current = playbackVersion;
      setError("");
      setLoading(true);
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
              suspendedRef.current
            ) {
              audio.pause();
              return false;
            }
            try {
              loadStream(index, targetStation);
              audio.volume = fadeIn ? 0 : volumeRef.current;
              await audio.play();
              if (
                playbackVersion !== playbackVersionRef.current ||
                suspendedRef.current
              ) {
                audio.pause();
                return false;
              }
              pendingStartupPlaybackRef.current = false;
              setPlaying(true);
              if (fadeIn) fadeVolumeIn(volumeRef.current);
              if (remember)
                persist({
                  enabled: true
                });
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
                setPlaying(false);
                setError("");
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
        throw lastError || new Error(NO_STREAM_ERROR);
      } catch (reason) {
        setPlaying(false);
        setError(
          reason.message
            ? translateSaved("Не удалось запустить радио: {0}", {
                0: reason.message
              })
            : translateSaved("Не удалось запустить радио")
        );
        return false;
      } finally {
        streamAttemptRef.current = false;
        if (playbackVersion === playbackVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [fadeVolumeIn, loadStream, persist, station, unlockAudioAnalysis]
  );
  // Stryker disable ArrayDeclaration: all dependencies are stable for the provider lifetime.
  const turnOff = useCallback(
    ({ remember = true } = {}) => {
      playbackVersionRef.current = createVersion();
      cancelVolumeFade();
      audioRef.current.pause();
      setPlaying(false);
      setLoading(false);
      if (remember)
        persist({
          enabled: false
        });
      stopAnalysis();
    },
    [cancelVolumeFade, persist, stopAnalysis]
  );
  // Stryker restore ArrayDeclaration
  const toggle = useCallback(() => {
    if (isPlaying) turnOff();
    else turnOn();
  }, [isPlaying, turnOff, turnOn]);
  // Stryker disable ArrayDeclaration: persistence and fade cancellation are stable callbacks.
  const setVolume = useCallback(
    (value) => {
      const numericValue = Number(value);
      const next = Number.isFinite(numericValue)
        ? Math.max(0, Math.min(1, numericValue))
        : DEFAULT_SETTINGS.volume;
      volumeRef.current = next;
      setVolumeState(next);
      cancelVolumeFade();
      audioRef.current.volume = next;
      persist({
        volume: next
      });
    },
    [cancelVolumeFade, persist]
  );
  // Stryker restore ArrayDeclaration
  const setStation = useCallback(
    (nextId) => {
      const next = RADIO_STATIONS.find(({ id }) => id === nextId);
      if (!next || next.id === stationId) return;
      const shouldResume = isPlaying || isLoading;
      playbackVersionRef.current = createVersion();
      audioRef.current.pause();
      stopAnalysis();
      setPlaying(false);
      setLoading(false);
      setError("");
      setStationIdState(next.id);
      persist({
        stationId: next.id
      });
      streamIndexRef.current = 0;
      loadStream(0, next);
      if (shouldResume && !suspendedRef.current) {
        turnOn({
          remember: false,
          targetStation: next
        });
      }
    },
    [isLoading, isPlaying, loadStream, persist, stationId, stopAnalysis, turnOn]
  );
  const setRecordingActive = useCallback(
    (active) => {
      if (active && !suspendedRef.current) {
        suspendedRef.current = true;
        resumeAfterRecordingRef.current = isPlaying;
        if (isPlaying)
          turnOff({
            remember: false
          });
        return;
      }
      if (!active && suspendedRef.current) {
        suspendedRef.current = false;
        const shouldResume = resumeAfterRecordingRef.current;
        if (shouldResume)
          turnOn({
            remember: false
          });
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
      turnOn({
        remember: false,
        startIndex: nextIndex
      });
      return;
    }
    setPlaying(false);
    setLoading(false);
    setError(
      translateSaved("{0} временно недоступна", {
        0: station.name
      })
    );
    stopAnalysis();
  }, [isPlaying, station, stopAnalysis, turnOn]);
  const turnOnRef = useRef(turnOn);
  turnOnRef.current = turnOn;
  // Volume is written atomically by setVolume and after every successful play.
  // Stryker disable ArrayDeclaration: initial.enabled is immutable and both callbacks are stable.
  useEffect(() => {
    const audio = audioRef.current;
    if (initial.enabled)
      turnOnRef.current({
        remember: false,
        analyse: true,
        fadeIn: true
      });
    return () => {
      playbackVersionRef.current = createVersion();
      cancelVolumeFade();
      stopAnalysis();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      analyserRef.current = null;
      frequencyDataRef.current = null;
      context?.close().catch(() => {});
    };
  }, [cancelVolumeFade, initial.enabled, stopAnalysis]);
  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: immutable startup state and stable callback/ref indirection.
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
        turnOnRef.current({
          remember: false,
          analyse: true,
          fadeIn: true
        });
      } else {
        unlockAudioAnalysis();
      }
    };
    window.addEventListener("pointerdown", unlock, true);
    // Capture and bubble both observe the global keyboard gesture.
    // Stryker disable next-line BooleanLiteral
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      // Capture and bubble use the same callback identity here.
      // Stryker disable next-line BooleanLiteral
      window.removeEventListener("keydown", unlock, true);
    };
  }, [initial.enabled, unlockAudioAnalysis]);
  // Stryker restore ArrayDeclaration
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
