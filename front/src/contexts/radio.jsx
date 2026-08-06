import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const RADIO_STREAMS = [
  "https://ice5.somafm.com/groovesalad-128-mp3",
  "https://ice2.somafm.com/groovesalad-128-mp3"
];
const RadioContext = createContext(null);

export function RadioProvider({ children }) {
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const frequencyDataRef = useRef(null);
  const bassRef = useRef(0);
  const animationRef = useRef(0);
  const [isPlaying, setPlaying] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const streamIndexRef = useRef(0);

  const stopAnalysis = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    bassRef.current = 0;
    document.documentElement.style.setProperty("--radio-bass", "0");
  }, []);

  const startAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const data = frequencyDataRef.current;
    const audioContext = audioContextRef.current;
    if (!analyser || !data || !audioContext) return;

    const readBass = () => {
      analyser.getByteFrequencyData(data);
      const binHz = audioContext.sampleRate / analyser.fftSize;
      const firstBin = Math.max(1, Math.floor(35 / binHz));
      const lastBin = Math.min(data.length - 1, Math.ceil(180 / binHz));
      let sum = 0;
      for (let index = firstBin; index <= lastBin; index += 1) sum += data[index];
      const raw = sum / Math.max(1, lastBin - firstBin + 1) / 255;
      bassRef.current +=
        (raw - bassRef.current) * (raw > bassRef.current ? 0.38 : 0.1);
      document.documentElement.style.setProperty(
        "--radio-bass",
        bassRef.current.toFixed(3)
      );
      animationRef.current = requestAnimationFrame(readBass);
    };

    cancelAnimationFrame(animationRef.current);
    readBass();
  }, []);

  const prepareAudioGraph = useCallback(() => {
    if (audioContextRef.current || !audioRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaElementSource(audioRef.current);
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
  }, []);

  const loadStream = useCallback((index = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    streamIndexRef.current = index;
    audio.src = RADIO_STREAMS[index];
    audio.load();
  }, []);

  const turnOn = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError("");
    setLoading(true);
    try {
      if (!audio.src) loadStream(streamIndexRef.current);
      prepareAudioGraph();
      await audioContextRef.current?.resume();
      await audio.play();
      setPlaying(true);
      startAnalysis();
    } catch (reason) {
      setPlaying(false);
      setError("Не удалось запустить радио");
      console.error("Radio playback failed", reason);
    } finally {
      setLoading(false);
    }
  }, [loadStream, prepareAudioGraph, startAnalysis]);

  const turnOff = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setLoading(false);
    stopAnalysis();
  }, [stopAnalysis]);

  const toggle = useCallback(() => {
    if (isPlaying) turnOff();
    else turnOn();
  }, [isPlaying, turnOff, turnOn]);

  useEffect(() => () => {
    stopAnalysis();
    audioRef.current?.pause();
    audioContextRef.current?.close();
  }, [stopAnalysis]);


  const handleStreamError = useCallback(() => {
    const nextIndex = streamIndexRef.current + 1;
    if (nextIndex < RADIO_STREAMS.length) {
      loadStream(nextIndex);
      if (isPlaying || isLoading) {
        audioRef.current?.play().catch((reason) => {
          setPlaying(false);
          setLoading(false);
          setError("Американское радио временно недоступно");
          console.error("Radio fallback playback failed", reason);
        });
      }
      return;
    }
    setPlaying(false);
    setLoading(false);
    setError("Американское радио временно недоступно");
    stopAnalysis();
  }, [isLoading, isPlaying, loadStream, stopAnalysis]);

  const getBassLevel = useCallback(() => bassRef.current, []);

  const value = useMemo(
    () => ({ isPlaying, isLoading, error, toggle, getBassLevel }),
    [error, getBassLevel, isLoading, isPlaying, toggle]
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
