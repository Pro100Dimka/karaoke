import { useCallback, useEffect, useRef } from "react";
import { getMelodyGuideState } from "../utils/melody-guide";

export default function useMelodyGuide({
  notes,
  volume,
  keyShift,
  currentTimeRef
}) {
  const guideRef = useRef(null);
  const notesRef = useRef(notes);
  const volumeRef = useRef(volume);
  const keyShiftRef = useRef(keyShift);

  notesRef.current = notes;
  volumeRef.current = volume;
  keyShiftRef.current = keyShift;

  const update = useCallback(
    (position) => {
      const guide = guideRef.current;
      if (!guide || guide.context.state === "closed") return;

      const now = guide.context.currentTime;
      const state = getMelodyGuideState({
        notes: notesRef.current,
        position,
        keyShift: keyShiftRef.current,
        volume: volumeRef.current
      });

      if (state.active) {
        guide.oscillator.frequency.setTargetAtTime(state.frequency, now, 0.012);
      }
      guide.gain.gain.setTargetAtTime(
        state.gain,
        now,
        state.active ? 0.015 : 0.018
      );
    },
    // Stryker disable next-line ArrayDeclaration: update reads current values from stable refs.
    []
  );

  const start = useCallback(async () => {
    if (
      volumeRef.current <= 0 ||
      !Array.isArray(notesRef.current) ||
      notesRef.current.length === 0
    )
      return false;

    let guide = guideRef.current;
    if (!guide || guide.context.state === "closed") {
      const AudioContextClass =
        globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return false;
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      guide = { context, oscillator, gain };
      guideRef.current = guide;
    }

    try {
      await guide.context.resume();
      update(currentTimeRef.current);
      return true;
    } catch (error) {
      guideRef.current = null;
      try {
        guide.oscillator.stop();
      } catch {
        // The oscillator may not have reached the running state.
      }
      await guide.context.close().catch(() => {});
      throw error;
    }
  }, [currentTimeRef, update]);

  const silence = useCallback(
    () => {
      const guide = guideRef.current;
      if (!guide || guide.context.state === "closed") return;

      const now = guide.context.currentTime;
      guide.gain.gain.cancelScheduledValues(now);
      guide.gain.gain.setValueAtTime(0.0001, now);
    },
    // Stryker disable next-line ArrayDeclaration: silence reads only a stable ref.
    []
  );

  useEffect(
    () => () => {
      const guide = guideRef.current;
      if (!guide) return;
      try {
        guide.oscillator.stop();
      } catch {
        // Oscillator may already be stopped during shutdown.
      }
      guide.context.close().catch(() => {});
      guideRef.current = null;
    },
    // Stryker disable next-line ArrayDeclaration: stable hook-lifetime ref.
    []
  );

  return {
    startMelodyGuide: start,
    updateMelodyGuide: update,
    silenceMelodyGuide: silence
  };
}
