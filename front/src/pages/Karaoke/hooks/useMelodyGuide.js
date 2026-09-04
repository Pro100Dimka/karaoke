import { useCallback, useEffect, useRef } from "react";
import { closeAudioContext, closeAudioContextQuietly } from "../../../utils/audio-context";
import { getMelodyGuideState } from "../utils/melody-guide";

export default function useMelodyGuide({ notes, volume, keyShift, currentTimeRef }) {
  const guideRef = useRef(null);
  const stateRef = useRef({ notes, volume, keyShift });
  stateRef.current = { notes, volume, keyShift };

  const update = useCallback((position) => {
    const guide = guideRef.current;
    if (!guide || guide.context.state === "closed") return;

    const now = guide.context.currentTime;
    const state = getMelodyGuideState({ ...stateRef.current, position });

    if (state.active) {
      guide.oscillator.frequency.setTargetAtTime(state.frequency, now, 0.012);
      const key = `${state.note.start}:${state.note.end}:${state.note.note}`;
      if (key !== guide.activeNoteKey) {
        guide.gain.gain.cancelScheduledValues(now);
        guide.gain.gain.setValueAtTime(0.0001, now);
        guide.activeNoteKey = key;
      }
    } else {
      guide.activeNoteKey = null;
    }

    guide.gain.gain.setTargetAtTime(state.gain, now, state.active ? 0.02 : 0.018);
  }, []);

  const start = useCallback(async () => {
    const { notes, volume } = stateRef.current;
    if (volume <= 0 || !Array.isArray(notes) || !notes.length) return false;

    let guide = guideRef.current;
    if (!guide || guide.context.state === "closed") {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return false;

      const context = new AudioContext({ latencyHint: "interactive" });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      guide = guideRef.current = { context, oscillator, gain, activeNoteKey: null };
    }

    try {
      await guide.context.resume();
      update(currentTimeRef.current);
      return true;
    } catch (error) {
      guideRef.current = null;
      try {
        guide.oscillator.stop();
      } catch {}
      await closeAudioContext(guide.context);
      throw error;
    }
  }, [currentTimeRef, update]);

  const silence = useCallback(() => {
    const guide = guideRef.current;
    if (!guide || guide.context.state === "closed") return;
    const now = guide.context.currentTime;
    guide.gain.gain.cancelScheduledValues(now);
    guide.gain.gain.setValueAtTime(0.0001, now);
  }, []);

  useEffect(
    () => () => {
      const guide = guideRef.current;
      guideRef.current = null;
      if (!guide) return;
      try {
        guide.oscillator.stop();
      } catch {}
      closeAudioContextQuietly(guide.context);
    },
    []
  );

  return { startMelodyGuide: start, updateMelodyGuide: update, silenceMelodyGuide: silence };
}
