import { useCallback, useEffect, useRef } from "react";

const midiFrequency = (midi) => 440 * 2 ** ((Number(midi) - 69) / 12);

const stopNode = (node, when) => {
  try {
    node?.stop(when);
  } catch {
    // Audio nodes may already be stopped during rapid editor interaction.
  }
};

export default function useMelodyEditorAudio({ notes, playbackRate, volumes }) {
  const vocalsRef = useRef(null);
  const instrumentalRef = useRef(null);
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const melodyGainRef = useRef(null);
  const auditionRef = useRef(null);
  const auditionTimerRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    audioContextRef.current.resume?.();
    return audioContextRef.current;
  }, []);

  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = volumes.vocals;
    if (instrumentalRef.current)
      instrumentalRef.current.volume = volumes.instrumental;
    if (melodyGainRef.current)
      melodyGainRef.current.gain.value = Math.max(0.05, volumes.melody * 0.56);
  }, [volumes]);

  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.playbackRate = playbackRate;
    if (instrumentalRef.current)
      instrumentalRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const stopOscillator = useCallback(() => {
    stopNode(oscillatorRef.current);
    oscillatorRef.current = null;
  }, []);

  const auditionNote = useCallback(
    (midi, durationMs = 360) => {
      const context = getAudioContext();
      const numericMidi = Number(midi);
      const nowMs = performance.now();
      if (
        nowMs - auditionTimerRef.current < 42 &&
        auditionRef.current?.midi === numericMidi
      )
        return;
      auditionTimerRef.current = nowMs;

      const previous = auditionRef.current;
      if (previous?.gain) {
        try {
          const now = context.currentTime;
          previous.gain.gain.cancelScheduledValues(now);
          previous.gain.gain.setTargetAtTime(0.0001, now, 0.012);
          previous.oscillators?.forEach((oscillator) =>
            stopNode(oscillator, now + 0.06)
          );
        } catch {
          // The browser can invalidate nodes while an AudioContext is closing.
        }
      }

      const frequency = midiFrequency(numericMidi);
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const now = context.currentTime;
      const duration = Math.max(0.22, durationMs / 1000);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(
        Math.min(5200, Math.max(1600, frequency * 8)),
        now
      );
      filter.Q.setValueAtTime(0.75, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.04, volumes.melody * 0.22),
        now + 0.012
      );
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.02, volumes.melody * 0.11),
        now + 0.11
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const oscillators = [
        ["sine", frequency, 1],
        ["triangle", frequency * 2, 0.16],
        ["sine", frequency * 3, 0.07]
      ].map(([type, hz, level]) => {
        const oscillator = context.createOscillator();
        const partialGain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(hz, now);
        partialGain.gain.setValueAtTime(level, now);
        oscillator.connect(partialGain).connect(filter);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.08);
        return oscillator;
      });
      filter.connect(gain).connect(context.destination);
      auditionRef.current = { oscillators, gain, midi: numericMidi };
    },
    [getAudioContext, volumes.melody]
  );

  const updateSynth = useCallback(
    (currentTime) => {
      const active = notes.find(
        (note) => note.start <= currentTime && note.end > currentTime
      );
      if (!active) {
        stopOscillator();
        return;
      }
      const context = getAudioContext();
      if (!oscillatorRef.current) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        gain.gain.value = Math.max(0.05, volumes.melody * 0.56);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillatorRef.current = oscillator;
        melodyGainRef.current = gain;
      }
      oscillatorRef.current.frequency.setTargetAtTime(
        midiFrequency(active.midi_note),
        context.currentTime,
        0.01
      );
    },
    [getAudioContext, notes, stopOscillator, volumes.melody]
  );

  useEffect(
    () => () => {
      stopOscillator();
      auditionRef.current?.oscillators?.forEach((oscillator) =>
        stopNode(oscillator)
      );
      const close = audioContextRef.current?.close?.();
      if (close?.catch) close.catch(() => {});
      audioContextRef.current = null;
    },
    [stopOscillator]
  );

  return {
    auditionNote,
    instrumentalRef,
    stopOscillator,
    updateSynth,
    vocalsRef
  };
}
