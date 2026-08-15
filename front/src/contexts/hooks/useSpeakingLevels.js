import { useCallback, useEffect, useRef, useState } from "react";

const METER_INTERVAL_MS = 70;
const MIN_LEVEL_DELTA_PERCENT = 4;

function disconnectNode(node) {
  try {
    node.disconnect();
  } catch {
    // The node may already be disconnected during concurrent peer cleanup.
  }
}

export default function useSpeakingLevels() {
  const audioContextRef = useRef(null);
  const metersRef = useRef(new Map());
  const [localSpeakingLevel, setLocalSpeakingLevel] = useState(0);
  const [speakingLevels, setSpeakingLevels] = useState({});

  const publishLevel = useCallback(
    (key, level) => {
      if (key === "local") {
        setLocalSpeakingLevel(level);
        return;
      }

      setSpeakingLevels((levels) => ({ ...levels, [key]: level }));
    },
    // Stryker disable next-line ArrayDeclaration: React state setters are stable.
    []
  );

  const removePublishedLevel = useCallback(
    (key) => {
      if (key === "local") {
        setLocalSpeakingLevel(0);
        return;
      }

      setSpeakingLevels((levels) => {
        const next = { ...levels };
        delete next[key];
        return next;
      });
    },
    // Stryker disable next-line ArrayDeclaration: React state setters are stable.
    []
  );

  const stopSpeakingMeter = useCallback(
    (key) => {
      const meter = metersRef.current.get(key);
      if (!meter) return;

      window.clearInterval(meter.intervalId);
      meter.track.removeEventListener("ended", meter.stopWhenTrackEnds);
      disconnectNode(meter.source);
      disconnectNode(meter.analyser);
      metersRef.current.delete(key);
      removePublishedLevel(key);
    },
    // Stryker disable next-line ArrayDeclaration: removePublishedLevel has stable identity.
    [removePublishedLevel]
  );

  const getAudioContext = useCallback(
    () => {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (audioContextRef.current?.state === "closed") audioContextRef.current = null;
      if (!audioContextRef.current) {
        try {
          audioContextRef.current = new AudioContextClass({ latencyHint: "interactive" });
        } catch {
          return null;
        }
      }

      const audioContext = audioContextRef.current;
      if (audioContext.state === "suspended") {
        try {
          Promise.resolve(audioContext.resume()).catch(() => {});
        } catch {
          return null;
        }
      }
      return audioContext;
    },
    // Stryker disable next-line ArrayDeclaration: audioContextRef has stable identity.
    []
  );

  const prepareSpeakingMeter = useCallback(
    () => {
      const audioContext = getAudioContext();
      if (!audioContext) return false;

      if (audioContext.state === "suspended") {
        try {
          const resumeResult = audioContext.resume();
          Promise.resolve(resumeResult).catch(() => {});
        } catch {
          return false;
        }
      }

      return true;
    },
    // Stryker disable next-line ArrayDeclaration: getAudioContext has stable identity.
    [getAudioContext]
  );

  const startSpeakingMeter = useCallback(
    (key, stream) => {
      stopSpeakingMeter(key);
      if (!stream?.getAudioTracks?.().length) return;

      const audioContext = getAudioContext();
      // Stryker disable next-line ConditionalExpression: equivalent catch fallback.
      if (!audioContext) return;

      let source;
      let analyser;
      try {
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
      } catch {
        disconnectNode(source);
        disconnectNode(analyser);
        return;
      }
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      let smoothed = 0;
      let lastPublished;
      const liveTrack = stream.getAudioTracks()[0];
      if (!liveTrack || liveTrack.readyState !== "live") {
        disconnectNode(source);
        disconnectNode(analyser);
        return;
      }
      const intervalId = globalThis.setInterval(() => {
        if (liveTrack.readyState !== "live" || audioContext.state === "closed") {
          stopSpeakingMeter(key);
          return;
        }
        try {
          analyser.getByteTimeDomainData(samples);
        } catch {
          stopSpeakingMeter(key);
          return;
        }
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }

        const rms = Math.sqrt(sum / samples.length);
        const normalizedLevel = Math.min(1, Math.max(0, (rms - 0.012) / 0.16));
        smoothed = smoothed * 0.68 + normalizedLevel * 0.32;
        const rounded = Number(smoothed.toFixed(2));
        const published = rounded >= 0.04 ? rounded : 0;
        if (Math.abs(published - lastPublished) * 100 < MIN_LEVEL_DELTA_PERCENT) return;
        lastPublished = published;
        publishLevel(key, published);
      }, METER_INTERVAL_MS);

      const stopWhenTrackEnds = () => stopSpeakingMeter(key);
      liveTrack.addEventListener("ended", stopWhenTrackEnds, { once: true });
      metersRef.current.set(key, {
        analyser,
        intervalId,
        source,
        track: liveTrack,
        stopWhenTrackEnds
      });
    },
    // Stryker disable next-line ArrayDeclaration: all callback dependencies have stable identity.
    [getAudioContext, publishLevel, stopSpeakingMeter]
  );

  const stopAllSpeakingMeters = useCallback(
    () => {
      for (const key of [...metersRef.current.keys()]) stopSpeakingMeter(key);
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        try {
          Promise.resolve(context.close()).catch(() => {});
        } catch {
          // Context may already be closing in another cleanup path.
        }
      }
    },
    // Stryker disable next-line ArrayDeclaration: stopSpeakingMeter has stable identity.
    [stopSpeakingMeter]
  );

  useEffect(
    () => stopAllSpeakingMeters,
    // Stryker disable next-line ArrayDeclaration: stopAllSpeakingMeters has stable identity.
    [stopAllSpeakingMeters]
  );

  return {
    localSpeakingLevel,
    speakingLevels,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopSpeakingMeter,
    stopAllSpeakingMeters
  };
}
