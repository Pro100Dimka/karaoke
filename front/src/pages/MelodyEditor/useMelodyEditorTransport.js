import { useCallback, useEffect, useRef, useState } from "react";
import { translateSaved } from "../../i18n/runtime";
import { getErrorMessage } from "../../utils/errors";
import { autoFollowScrollLeft } from "./melody-editor-geometry";
import { clamp } from "./melody-editor-state";
import useMelodyEditorAudio from "./useMelodyEditorAudio";
import useMelodyEditorViewport from "./useMelodyEditorViewport";

const createClock = (media = 0, running = false) => ({ media, perf: performance.now(), running });

export default function useMelodyEditorTransport({
  autoScroll,
  setAutoScroll,
  duration,
  keyboardWidth,
  laneHeight,
  laneWidth,
  maxMidi,
  minMidi,
  noteAtTime,
  notes,
  notify,
  playbackRate,
  setVerticalZoom,
  setZoom,
  verticalZoom,
  volumes,
  zoom
}) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const rafRef = useRef(null);
  const transportClockRef = useRef(createClock());
  const playheadDragRef = useRef(null);
  const playbackOriginRef = useRef(null);
  const playheadPreviewMidiRef = useRef(null);
  const { auditionNote, instrumentalRef, stopOscillator, updateSynth, vocalsRef } =
    useMelodyEditorAudio({ notes, playbackRate, volumes });
  const viewport = useMelodyEditorViewport({
    duration,
    instrumentalRef,
    keyboardWidth,
    laneHeight,
    laneWidth,
    maxMidi,
    minMidi,
    notes,
    setVerticalZoom,
    setZoom,
    verticalZoom,
    zoom
  });
  const { rollCanvasRef, rollShellRef, syncScrollState } = viewport;

  useEffect(() => {
    if (!playing)
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + time * zoom}px`
      );
  }, [keyboardWidth, playing, rollCanvasRef, time, zoom]);

  useEffect(() => {
    let frame = 0;
    let lastStateAt = 0;
    let lastReconcileAt = 0;
    const sync = (stamp = performance.now()) => {
      const master = instrumentalRef.current;
      const vocal = vocalsRef.current;
      const shell = rollShellRef.current;
      if (![master, vocal, shell].every(Boolean)) {
        frame = requestAnimationFrame(sync);
        rafRef.current = frame;
        return;
      }
      if (!playheadDragRef.current) {
        const clock = transportClockRef.current;
        let current = master.currentTime;
        if (!master.paused && !master.ended) {
          if (!clock.running) {
            clock.media = current;
            clock.perf = stamp;
            clock.running = true;
          }
          current = clamp(
            clock.media + ((stamp - clock.perf) / 1000) * master.playbackRate,
            0,
            duration
          );
          if (stamp - lastReconcileAt >= 400) {
            lastReconcileAt = stamp;
            const mediaCurrent = master.currentTime;
            if (Math.abs(mediaCurrent - current) > 0.12) {
              clock.media = mediaCurrent;
              clock.perf = stamp;
              current = mediaCurrent;
            }
          }
        } else Object.assign(clock, createClock(current, false));
        const playheadX = keyboardWidth + current * zoom;
        rollCanvasRef.current?.style.setProperty("--editor-playhead-x", `${playheadX}px`);
        if (!master.paused && !master.ended) {
          const mediaTime = master.currentTime;
          const drift = vocal.currentTime - mediaTime;
          if (Math.abs(drift) > 0.13) {
            vocal.currentTime = mediaTime;
            vocal.playbackRate = playbackRate;
          } else if (Math.abs(drift) > 0.02)
            vocal.playbackRate = clamp(
              playbackRate - drift * 0.16,
              playbackRate * 0.97,
              playbackRate * 1.03
            );
          else if (vocal.playbackRate !== playbackRate) vocal.playbackRate = playbackRate;
          if (autoScroll) {
            const nextLeft = autoFollowScrollLeft({
              playheadX,
              scrollLeft: shell.scrollLeft,
              clientWidth: shell.clientWidth,
              keyboardWidth,
              scrollWidth: shell.scrollWidth
            });
            if (Math.abs(nextLeft - shell.scrollLeft) > 0.2) shell.scrollLeft = nextLeft;
          }
          updateSynth(current);
          if (stamp - lastStateAt >= 50) {
            lastStateAt = stamp;
            setTime(current);
          }
        }
      }
      frame = requestAnimationFrame(sync);
      rafRef.current = frame;
    };
    frame = requestAnimationFrame(sync);
    rafRef.current = frame;
    return () => cancelAnimationFrame(frame);
  }, [
    autoScroll,
    duration,
    instrumentalRef,
    keyboardWidth,
    playbackRate,
    rollCanvasRef,
    rollShellRef,
    updateSynth,
    vocalsRef,
    zoom
  ]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const pause = useCallback(() => {
    const master = instrumentalRef.current;
    const vocal = vocalsRef.current;
    if (!master || !vocal) return;
    master.pause();
    vocal.pause();
    let current = master.currentTime;
    const origin = autoScroll ? playbackOriginRef.current : null;
    if (origin) {
      current = origin.time;
      master.currentTime = current;
      vocal.currentTime = current;
      const shell = rollShellRef.current;
      if (shell) {
        shell.scrollLeft = origin.scrollLeft;
        shell.scrollTop = origin.scrollTop;
        syncScrollState();
      }
    }
    transportClockRef.current = createClock(current, false);
    rollCanvasRef.current?.style.setProperty(
      "--editor-playhead-x",
      `${keyboardWidth + current * zoom}px`
    );
    setTime(current);
    setPlaying(false);
    stopOscillator();
    playbackOriginRef.current = null;
    vocal.playbackRate = playbackRate;
  }, [
    autoScroll,
    instrumentalRef,
    keyboardWidth,
    playbackRate,
    rollCanvasRef,
    rollShellRef,
    stopOscillator,
    syncScrollState,
    vocalsRef,
    zoom
  ]);

  const play = useCallback(async () => {
    const master = instrumentalRef.current;
    const vocal = vocalsRef.current;
    if (!master || !vocal) return;
    try {
      const shell = rollShellRef.current;
      playbackOriginRef.current =
        autoScroll && shell
          ? { time: master.currentTime, scrollLeft: shell.scrollLeft, scrollTop: shell.scrollTop }
          : null;
      vocal.currentTime = master.currentTime;
      master.playbackRate = playbackRate;
      vocal.playbackRate = playbackRate;
      transportClockRef.current = createClock(master.currentTime, true);
      const results = await Promise.allSettled([master.play(), vocal.play()]);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
      setTime(master.currentTime);
      setPlaying(true);
      updateSynth(master.currentTime);
    } catch (error) {
      setPlaying(false);
      await notify(
        translateSaved("Не удалось начать воспроизведение: {0}", { 0: getErrorMessage(error) })
      );
    }
  }, [autoScroll, instrumentalRef, notify, playbackRate, rollShellRef, updateSynth, vocalsRef]);

  const toggleAutoScroll = useCallback(() => {
    setAutoScroll((value) => {
      const next = !value;
      if (!next) playbackOriginRef.current = null;
      return next;
    });
  }, [setAutoScroll]);

  const seek = useCallback(
    (next, auditionWhenStopped = true) => {
      const value = clamp(Number(next) || 0, 0, duration);
      const master = instrumentalRef.current;
      const vocal = vocalsRef.current;
      setTime(value);
      const running = Boolean(master && !master.paused);
      transportClockRef.current = createClock(value, running);
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + value * zoom}px`
      );
      if (master) master.currentTime = value;
      if (vocal) {
        vocal.currentTime = value;
        vocal.playbackRate = playbackRate;
      }
      if (running) updateSynth(value);
      else {
        stopOscillator();
        const active = noteAtTime(value);
        if (auditionWhenStopped && active) auditionNote(active.note, 180);
      }
    },
    [
      auditionNote,
      duration,
      instrumentalRef,
      keyboardWidth,
      noteAtTime,
      playbackRate,
      rollCanvasRef,
      stopOscillator,
      updateSynth,
      vocalsRef,
      zoom
    ]
  );

  const pointerTime = useCallback(
    (clientX) => {
      const canvas = rollCanvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      return clamp((clientX - rect.left - keyboardWidth) / zoom, 0, duration);
    },
    [duration, keyboardWidth, rollCanvasRef, zoom]
  );

  const previewPlayhead = useCallback(
    (value) => {
      const next = clamp(Number(value) || 0, 0, duration);
      setTime(next);
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + next * zoom}px`
      );
      if (playheadDragRef.current) playheadDragRef.current.value = next;
      const midi = noteAtTime(next)?.note ?? null;
      if (midi !== playheadPreviewMidiRef.current) {
        playheadPreviewMidiRef.current = midi;
        stopOscillator();
        if (midi != null) auditionNote(midi, 140);
      }
    },
    [auditionNote, duration, keyboardWidth, noteAtTime, rollCanvasRef, stopOscillator, zoom]
  );

  const startPlayheadDrag = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const master = instrumentalRef.current;
      const vocal = vocalsRef.current;
      const resume = Boolean(master && !master.paused);
      if (resume) {
        master.pause();
        vocal?.pause();
        setPlaying(false);
        stopOscillator();
      }
      playheadPreviewMidiRef.current = null;
      playheadDragRef.current = { pointerId: event.pointerId, resume, value: time };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      previewPlayhead(pointerTime(event.clientX));
    },
    [instrumentalRef, pointerTime, previewPlayhead, stopOscillator, time, vocalsRef]
  );

  const movePlayheadDrag = useCallback(
    (event) => {
      if (!playheadDragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      previewPlayhead(pointerTime(event.clientX));
    },
    [pointerTime, previewPlayhead]
  );

  const endPlayheadDrag = useCallback(
    async (event) => {
      const state = playheadDragRef.current;
      if (!state) return;
      playheadDragRef.current = null;
      playheadPreviewMidiRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      seek(state.value, !state.resume);
      if (state.resume) await play();
    },
    [play, seek]
  );

  const handleInstrumentalPause = useCallback(() => setPlaying(false), []);
  const handleInstrumentalTimeUpdate = useCallback(
    (event) => {
      if (playheadDragRef.current || !event.currentTarget.paused) return;
      const current = event.currentTarget.currentTime;
      transportClockRef.current = createClock(current, false);
      setTime(current);
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + current * zoom}px`
      );
    },
    [keyboardWidth, rollCanvasRef, zoom]
  );

  return {
    auditionNote,
    endPlayheadDrag,
    handleInstrumentalPause,
    handleInstrumentalTimeUpdate,
    instrumentalRef,
    movePlayheadDrag,
    pause,
    play,
    playing,
    seek,
    startPlayheadDrag,
    time,
    toggleAutoScroll,
    vocalsRef,
    ...viewport
  };
}
