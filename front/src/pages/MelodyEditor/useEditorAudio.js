import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { translateSaved as t } from "../../i18n/runtime";
import { getErrorMessage } from "../../utils/errors";
import { clamp } from "../../utils/math";

const frequency = (midi) => 440 * 2 ** ((Number(midi) - 69) / 12);

export default function useEditorAudio({
  autoScroll,
  duration,
  keyboardWidth,
  notes,
  notify,
  playbackRate,
  shellRef,
  songId,
  volumes,
  zoom
}) {
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const contextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const toneTimerRef = useRef(null);
  const [urls, setUrls] = useState({});
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!songId) return undefined;
    let active = true;
    const resources = [];
    Promise.all([
      api.getAudioTrackBlob(songId, "vocals"),
      api.getAudioTrackBlob(songId, "instrumental")
    ])
      .then(([vocals, instrumental]) => {
        if (!active) return;
        const next = {
          vocals: URL.createObjectURL(vocals),
          instrumental: URL.createObjectURL(instrumental)
        };
        resources.push(next.vocals, next.instrumental, vocals, instrumental);
        setUrls(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      resources.forEach((resource) =>
        typeof resource === "string" ? URL.revokeObjectURL(resource) : resource?.cleanup?.()
      );
    };
  }, [songId]);

  const stopTone = useCallback(() => {
    globalThis.clearTimeout(toneTimerRef.current);
    toneTimerRef.current = null;
    try {
      oscillatorRef.current?.oscillator.stop();
    } catch {
      // The browser may have stopped this oscillator when its scheduled note ended.
    }
    oscillatorRef.current = null;
  }, []);

  const tone = useCallback(
    (midi, milliseconds = 160) => {
      stopTone();
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return;
      const context = contextRef.current || new AudioContext();
      contextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency(midi);
      oscillator.type = "sine";
      gain.gain.value = Math.max(0.001, volumes.melody * 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillatorRef.current = { oscillator, midi };
      toneTimerRef.current = globalThis.setTimeout(() => {
        if (oscillatorRef.current?.oscillator === oscillator) stopTone();
      }, milliseconds);
    },
    [stopTone, volumes.melody]
  );

  useEffect(() => {
    const instrumental = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (instrumental) {
      instrumental.volume = volumes.instrumental;
      instrumental.playbackRate = playbackRate;
    }
    if (vocals) {
      vocals.volume = volumes.vocals;
      vocals.playbackRate = playbackRate;
    }
  }, [playbackRate, volumes]);

  useEffect(() => {
    let frame;
    let lastUpdate = 0;
    let activeMidi = null;
    const tick = (stamp) => {
      const master = instrumentalRef.current;
      const vocals = vocalsRef.current;
      if (master && !master.paused) {
        const current = master.currentTime;
        if (vocals && Math.abs(vocals.currentTime - current) > 0.08) vocals.currentTime = current;
        const note = notes.find(({ start, end }) => start <= current && end > current);
        if (note?.note !== activeMidi) {
          activeMidi = note?.note ?? null;
          if (activeMidi == null) stopTone();
          else tone(activeMidi, Math.max(80, (note.end - current) * 1000));
        }
        if (autoScroll && shellRef.current) {
          const shell = shellRef.current;
          const x = keyboardWidth + current * zoom;
          if (x > shell.scrollLeft + shell.clientWidth * 0.72)
            shell.scrollLeft = Math.max(0, x - shell.clientWidth * 0.35);
        }
        if (stamp - lastUpdate > 32) {
          lastUpdate = stamp;
          setTime(current);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, keyboardWidth, notes, shellRef, stopTone, tone, zoom]);

  const seek = useCallback(
    (value) => {
      const next = clamp(Number(value) || 0, 0, duration);
      [instrumentalRef.current, vocalsRef.current].forEach((audio) => {
        if (audio) audio.currentTime = next;
      });
      setTime(next);
      const note = notes.find(({ start, end }) => start <= next && end > next);
      if (!playing && note) tone(note.note);
    },
    [duration, notes, playing, tone]
  );

  const pause = useCallback(() => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    stopTone();
    setPlaying(false);
  }, [stopTone]);

  const play = useCallback(async () => {
    const master = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!master || !vocals) return;
    try {
      vocals.currentTime = master.currentTime;
      const results = await Promise.allSettled([master.play(), vocals.play()]);
      const failure = results.find(({ status }) => status === "rejected");
      if (failure) throw failure.reason;
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      await notify(t("Не удалось начать воспроизведение: {0}", { 0: getErrorMessage(error) }));
    }
  }, [notify]);

  useEffect(
    () => () => {
      stopTone();
      contextRef.current?.close?.();
    },
    [stopTone]
  );

  return { instrumentalRef, pause, play, playing, seek, time, tone, urls, vocalsRef };
}
