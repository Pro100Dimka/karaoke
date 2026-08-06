import { useCallback, useEffect, useRef, useState } from "react";

const LOCAL_METER_KEY = "local";
const METER_INTERVAL_MS = 70;
const MIN_LEVEL_DELTA = 0.035;

function disconnectNode(node) {
  try {
    node?.disconnect();
  } catch {
    // The node may already be disconnected during concurrent peer cleanup.
  }
}

export default function useSpeakingLevels() {
  const audioContextRef = useRef(null);
  const metersRef = useRef(new Map());
  const [localSpeakingLevel, setLocalSpeakingLevel] = useState(0);
  const [speakingLevels, setSpeakingLevels] = useState({});

  const publishLevel = useCallback((key, level) => {
    if (key === LOCAL_METER_KEY) {
      setLocalSpeakingLevel(level);
      return;
    }

    setSpeakingLevels((levels) =>
      levels[key] === level ? levels : { ...levels, [key]: level }
    );
  }, []);

  const removePublishedLevel = useCallback((key) => {
    if (key === LOCAL_METER_KEY) {
      setLocalSpeakingLevel(0);
      return;
    }

    setSpeakingLevels((levels) => {
      if (!(key in levels)) return levels;
      const next = { ...levels };
      delete next[key];
      return next;
    });
  }, []);

  const stopSpeakingMeter = useCallback(
    (key) => {
      const meter = metersRef.current.get(key);
      if (!meter) return;

      window.clearInterval(meter.intervalId);
      disconnectNode(meter.source);
      disconnectNode(meter.analyser);
      metersRef.current.delete(key);
      removePublishedLevel(key);
    },
    [removePublishedLevel]
  );

  const getAudioContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass({
        latencyHint: "interactive"
      });
    }

    const audioContext = audioContextRef.current;
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }, []);

  const startSpeakingMeter = useCallback(
    (key, stream) => {
      stopSpeakingMeter(key);
      if (!stream?.getAudioTracks?.().length) return;

      const audioContext = getAudioContext();
      if (!audioContext) return;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      let smoothed = 0;
      let lastPublished = -1;
      const intervalId = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }

        const rms = Math.sqrt(sum / samples.length);
        const normalizedLevel = Math.min(1, Math.max(0, (rms - 0.012) / 0.16));
        smoothed = smoothed * 0.68 + normalizedLevel * 0.32;
        const published = smoothed < 0.035 ? 0 : Number(smoothed.toFixed(2));
        if (Math.abs(published - lastPublished) < MIN_LEVEL_DELTA) return;
        lastPublished = published;
        publishLevel(key, published);
      }, METER_INTERVAL_MS);

      metersRef.current.set(key, { analyser, intervalId, source });
    },
    [getAudioContext, publishLevel, stopSpeakingMeter]
  );

  const stopAllSpeakingMeters = useCallback(() => {
    for (const key of [...metersRef.current.keys()]) stopSpeakingMeter(key);
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, [stopSpeakingMeter]);

  useEffect(() => stopAllSpeakingMeters, [stopAllSpeakingMeters]);

  return {
    localSpeakingLevel,
    speakingLevels,
    startSpeakingMeter,
    stopSpeakingMeter,
    stopAllSpeakingMeters
  };
}
