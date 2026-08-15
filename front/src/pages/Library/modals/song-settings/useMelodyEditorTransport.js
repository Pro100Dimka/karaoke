import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { translateSaved } from "../../../../i18n/runtime";
import { getErrorMessage } from "../../../../utils/errors";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  anchoredVerticalScrollToNote,
  autoFollowScrollLeft
} from "./melody-editor-geometry";
import { clamp } from "./melody-editor-state";

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
  const vocalsRef = useRef(null);
  const instrumentalRef = useRef(null);
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const melodyGainRef = useRef(null);
  const rafRef = useRef(null);
  const transportClockRef = useRef({ media: 0, perf: 0, running: false });
  const rollShellRef = useRef(null);
  const rollCanvasRef = useRef(null);
  const playheadDragRef = useRef(null);
  const auditionRef = useRef(null);
  const auditionTimerRef = useRef(0);
  const scrollDragRef = useRef(null);
  const playbackOriginRef = useRef(null);
  const playheadPreviewMidiRef = useRef(null);
  const [scrollState, setScrollState] = useState({
    left: 0,
    top: 0,
    clientWidth: 1,
    clientHeight: 1,
    scrollWidth: 1,
    scrollHeight: 1
  });
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
  try {
    oscillatorRef.current?.stop();
  } catch {
    /* already stopped */
  }
  oscillatorRef.current = null;
}, []);
const auditionNote = useCallback(
  (midi, durationMs = 360) => {
    let context = audioContextRef.current;
    if (!context) {
      context = new AudioContext();
      audioContextRef.current = context;
    }
    context.resume?.();
    const nowMs = performance.now();
    if (
      nowMs - auditionTimerRef.current < 42 &&
      auditionRef.current?.midi === Number(midi)
    )
      return;
    auditionTimerRef.current = nowMs;
    const previous = auditionRef.current;
    if (previous?.gain) {
      try {
        const now = context.currentTime;
        previous.gain.gain.cancelScheduledValues(now);
        previous.gain.gain.setTargetAtTime(0.0001, now, 0.012);
        previous.oscillators?.forEach((oscillator) => {
          try {
            oscillator.stop(now + 0.06);
          } catch {
            /* already stopped */
          }
        });
      } catch {
        /* stale audio node */
      }
    }
    const frequency = 440 * 2 ** ((Number(midi) - 69) / 12);
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
    auditionRef.current = {
      oscillators,
      gain,
      midi: Number(midi)
    };
  },
  [volumes.melody]
);
const syncScrollState = useCallback(() => {
  const shell = rollShellRef.current;
  if (!shell) return;
  setScrollState({
    left: shell.scrollLeft,
    top: shell.scrollTop,
    clientWidth: shell.clientWidth || 1,
    clientHeight: shell.clientHeight || 1,
    scrollWidth: shell.scrollWidth || 1,
    scrollHeight: shell.scrollHeight || 1
  });
}, []);
const startScrollThumbDrag = useCallback((event, axis) => {
  const shell = rollShellRef.current;
  event.preventDefault();
  event.stopPropagation();
  scrollDragRef.current = {
    axis,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: shell.scrollLeft,
    top: shell.scrollTop,
    maxX: Math.max(0, shell.scrollWidth - shell.clientWidth),
    maxY: Math.max(0, shell.scrollHeight - shell.clientHeight),
    trackSize:
      axis === "x"
        ? event.currentTarget.parentElement?.clientWidth || 1
        : event.currentTarget.parentElement?.clientHeight || 1,
    thumbSize:
      axis === "x"
        ? event.currentTarget.clientWidth || 1
        : event.currentTarget.clientHeight || 1
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}, []);
const moveScrollThumbDrag = useCallback(
  (event) => {
    const state = scrollDragRef.current;
    const shell = rollShellRef.current;
    if (!state || !shell) return;
    event.preventDefault();
    const usable = Math.max(1, state.trackSize - state.thumbSize);
    if (state.axis === "x")
      shell.scrollLeft = clamp(
        state.left + ((event.clientX - state.x) / usable) * state.maxX,
        0,
        state.maxX
      );
    else
      shell.scrollTop = clamp(
        state.top + ((event.clientY - state.y) / usable) * state.maxY,
        0,
        state.maxY
      );
    syncScrollState();
  },
  [syncScrollState]
);
const endScrollThumbDrag = useCallback((event) => {
  if (!scrollDragRef.current) return;
  scrollDragRef.current = null;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
}, []);
useEffect(() => {
  requestAnimationFrame(syncScrollState);
}, [laneHeight, laneWidth, syncScrollState]);
useEffect(() => {
  if (!playing)
    rollCanvasRef.current?.style.setProperty(
      "--editor-playhead-x",
      `${keyboardWidth + time * zoom}px`
    );
}, [keyboardWidth, playing, time, zoom]);
const updateSynth = useCallback(
  (currentTime) => {
    const active = notes.find(
      (note) => note.start <= currentTime && note.end > currentTime
    );
    if (!active) {
      stopOscillator();
      return;
    }
    const frequency = 440 * 2 ** ((active.midi_note - 69) / 12);
    let context = audioContextRef.current;
    if (!context) {
      context = new AudioContext();
      audioContextRef.current = context;
    }
    context.resume?.();
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
      frequency,
      context.currentTime,
      0.01
    );
  },
  [notes, stopOscillator, volumes.melody]
);
useEffect(() => {
  let frame = 0;
  let lastStateAt = 0;
  let lastReconcileAt = 0;
  const sync = (stamp = performance.now()) => {
    const master = instrumentalRef.current;
    const vocal = vocalsRef.current;
    const shell = rollShellRef.current;
    if (![master, vocal, shell].every(Boolean)) return;
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
      } else {
        clock.running = false;
        clock.media = current;
        clock.perf = stamp;
      }
      const playheadX = keyboardWidth + current * zoom;
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${playheadX}px`
      );
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
        else if (vocal.playbackRate !== playbackRate)
          vocal.playbackRate = playbackRate;
        if (autoScroll) {
          const nextLeft = autoFollowScrollLeft({
            playheadX,
            scrollLeft: shell.scrollLeft,
            clientWidth: shell.clientWidth,
            keyboardWidth,
            scrollWidth: shell.scrollWidth
          });
          if (Math.abs(nextLeft - shell.scrollLeft) > 0.2)
            shell.scrollLeft = nextLeft;
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
}, [autoScroll, duration, keyboardWidth, playbackRate, updateSynth, zoom]);
const pause = useCallback(() => {
  const master = instrumentalRef.current;
  const vocal = vocalsRef.current;
  master.pause();
  vocal.pause();
  let current = master.currentTime;
  const origin = autoScroll ? playbackOriginRef.current : null;
  if (origin) {
    current = origin.time;
    master.currentTime = current;
    vocal.currentTime = current;
    const shell = rollShellRef.current;
    shell.scrollLeft = origin.scrollLeft;
    shell.scrollTop = origin.scrollTop;
    syncScrollState();
  }
  transportClockRef.current = {
    media: current,
    perf: performance.now(),
    running: false
  };
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
  keyboardWidth,
  playbackRate,
  stopOscillator,
  syncScrollState,
  zoom
]);
const play = useCallback(async () => {
  const master = instrumentalRef.current;
  const vocal = vocalsRef.current;
  try {
    const shell = rollShellRef.current;
    playbackOriginRef.current = autoScroll
      ? {
          time: master.currentTime,
          scrollLeft: shell.scrollLeft,
          scrollTop: shell.scrollTop
        }
      : null;
    vocal.currentTime = master.currentTime;
    master.playbackRate = playbackRate;
    vocal.playbackRate = playbackRate;
    transportClockRef.current = {
      media: master.currentTime,
      perf: performance.now(),
      running: true
    };
    await Promise.allSettled([master.play(), vocal.play()]);
    setTime(master.currentTime);
    setPlaying(true);
    updateSynth(master.currentTime);
  } catch (error) {
    await notify(
      translateSaved("Не удалось начать воспроизведение: {0}", {
        0: getErrorMessage(error)
      })
    );
  }
}, [autoScroll, notify, playbackRate, updateSynth]);
const toggleAutoScroll = useCallback(() => {
  setAutoScroll((value) => {
    const next = !value;
    if (!next) playbackOriginRef.current = null;
    return next;
  });
}, []);
useEffect(
  () => () => {
    cancelAnimationFrame(rafRef.current);
    stopOscillator();
    auditionRef.current?.oscillators?.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        /* already stopped */
      }
    });
    audioContextRef.current?.close?.();
  },
  [stopOscillator]
);
const seek = useCallback(
  (next, auditionWhenStopped = true) => {
    const value = clamp(Number(next) || 0, 0, duration);
    setTime(value);
    const running = Boolean(
      instrumentalRef.current && !instrumentalRef.current.paused
    );
    transportClockRef.current = {
      media: value,
      perf: performance.now(),
      running
    };
    rollCanvasRef.current?.style.setProperty(
      "--editor-playhead-x",
      `${keyboardWidth + value * zoom}px`
    );
    instrumentalRef.current.currentTime = value;
    vocalsRef.current.currentTime = value;
    vocalsRef.current.playbackRate = playbackRate;
    if (running) updateSynth(value);
    else {
      stopOscillator();
      const active = noteAtTime(value);
      if (auditionWhenStopped && active) auditionNote(active.midi_note, 180);
    }
  },
  [
    auditionNote,
    duration,
    keyboardWidth,
    noteAtTime,
    playbackRate,
    stopOscillator,
    updateSynth,
    zoom
  ]
);
const pointerTime = useCallback(
  (clientX) => {
    const canvas = rollCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return clamp((clientX - rect.left - keyboardWidth) / zoom, 0, duration);
  },
  [duration, keyboardWidth, zoom]
);
const previewPlayhead = useCallback(
  (value) => {
    const next = clamp(Number(value) || 0, 0, duration);
    setTime(next);
    rollCanvasRef.current?.style.setProperty(
      "--editor-playhead-x",
      `${keyboardWidth + next * zoom}px`
    );
    playheadDragRef.current.value = next;
    const active = noteAtTime(next);
    const midi = active?.midi_note ?? null;
    if (midi !== playheadPreviewMidiRef.current) {
      playheadPreviewMidiRef.current = midi;
      stopOscillator();
      if (midi != null) auditionNote(midi, 140);
    }
  },
  [auditionNote, duration, keyboardWidth, noteAtTime, stopOscillator, zoom]
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
    playheadDragRef.current = {
      pointerId: event.pointerId,
      resume,
      value: time
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewPlayhead(pointerTime(event.clientX));
  },
  [pointerTime, previewPlayhead, stopOscillator, time]
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
const setHorizontalZoomAnchored = useCallback(
  (nextZoom) => {
    const shell = rollShellRef.current;
    const next = clamp(Number(nextZoom), 36, 600);
    if (!shell || next === zoom) {
      setZoom(next);
      return;
    }
    const anchorTime = instrumentalRef.current.currentTime;
    const nextScrollWidth = Math.max(
      shell.clientWidth,
      Math.max(1180, duration * next) + keyboardWidth
    );
    const nextLeft = anchoredHorizontalScroll({
      time: anchorTime,
      oldZoom: zoom,
      newZoom: next,
      keyboardWidth,
      scrollLeft: shell.scrollLeft,
      clientWidth: shell.clientWidth,
      scrollWidth: nextScrollWidth
    });

    // Commit layout and restore the playhead's exact screen X before the browser paints.
    flushSync(() => setZoom(next));
    shell.scrollLeft = nextLeft;
    rollCanvasRef.current?.style.setProperty(
      "--editor-playhead-x",
      `${keyboardWidth + anchorTime * next}px`
    );
    syncScrollState();
  },
  [duration, keyboardWidth, syncScrollState, zoom]
);
const setVerticalZoomAnchored = useCallback(
  (nextZoom) => {
    const shell = rollShellRef.current;
    const next = clamp(Number(nextZoom), 10, 36);
    if (!shell || next === verticalZoom) {
      setVerticalZoom(next);
      return;
    }
    const viewportCenterY = shell.scrollTop + shell.clientHeight / 2;
    const anchorNote = notes.length
      ? notes.reduce((best, note) => {
          const y = (maxMidi - note.midi_note + 0.5) * verticalZoom;
          const distance = Math.abs(y - viewportCenterY);
          return !best || distance < best.distance
            ? {
                note,
                distance
              }
            : best;
        }, null)
      : null;
    const nextTop = anchorNote
      ? anchoredVerticalScrollToNote({
          noteMidi: anchorNote.note.midi_note,
          maxMidi,
          oldRowHeight: verticalZoom,
          newRowHeight: next,
          scrollTop: shell.scrollTop,
          clientHeight: shell.clientHeight,
          rowCount: maxMidi - minMidi + 1
        })
      : anchoredVerticalScroll({
          scrollTop: shell.scrollTop,
          clientHeight: shell.clientHeight,
          oldRowHeight: verticalZoom,
          newRowHeight: next,
          rowCount: maxMidi - minMidi + 1
        });

    // Same-frame commit prevents the one-frame jump that was visible with requestAnimationFrame.
    flushSync(() => setVerticalZoom(next));
    shell.scrollTop = nextTop;
    syncScrollState();
  },
  [maxMidi, minMidi, notes, syncScrollState, verticalZoom]
);
const handleRollWheel = useCallback(
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const direction = event.deltaY < 0 ? 1 : -1;
    if (event.shiftKey) {
      setHorizontalZoomAnchored(zoom + direction * 10);
      return;
    }
    setVerticalZoomAnchored(verticalZoom + direction);
  },
  [setHorizontalZoomAnchored, setVerticalZoomAnchored, verticalZoom, zoom]
);
useEffect(() => {
  const onWheel = (event) => {
    const shell = rollShellRef.current;
    if (!shell || !event.ctrlKey || !shell.contains(event.target)) return;
    handleRollWheel(event);
  };
  window.addEventListener("wheel", onWheel, {
    passive: false,
    capture: true
  });
  return () =>
    window.removeEventListener("wheel", onWheel, {
      capture: true
    });
}, [handleRollWheel]);

  const handleInstrumentalPause = useCallback(() => setPlaying(false), []);
  const handleInstrumentalTimeUpdate = useCallback(
    (event) => {
      if (playheadDragRef.current || !event.currentTarget.paused) return;
      const current = event.currentTarget.currentTime;
      transportClockRef.current = {
        media: current,
        perf: performance.now(),
        running: false
      };
      setTime(current);
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + current * zoom}px`
      );
    },
    [keyboardWidth, zoom]
  );

  return {
    auditionNote,
    endPlayheadDrag,
    endScrollThumbDrag,
    handleInstrumentalPause,
    handleInstrumentalTimeUpdate,
    instrumentalRef,
    movePlayheadDrag,
    moveScrollThumbDrag,
    pause,
    play,
    playing,
    rollCanvasRef,
    rollShellRef,
    scrollState,
    seek,
    setHorizontalZoomAnchored,
    setVerticalZoomAnchored,
    startPlayheadDrag,
    startScrollThumbDrag,
    syncScrollState,
    time,
    toggleAutoScroll,
    vocalsRef
  };
}
