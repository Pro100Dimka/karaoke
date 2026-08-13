import {
  ArrowLeft,
  Crosshair,
  Merge,
  MoveHorizontal,
  MoveVertical,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { api } from "../../../../api/client";
import { IconButton } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { getErrorMessage } from "../../../../utils/errors";
import {
  isEditableHotkeyTarget,
  isHotkeyScopeActive
} from "../../../../utils/hotkeys";
import { readJsonStorage } from "../../../../utils/storage";
import { persistUiPreferences } from "../../../../utils/ui-preferences";
import EffectDial from "../../../Karaoke/components/console/effect-dial";
import SongStrip from "../../../Karaoke/components/console/song-strip";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  anchoredVerticalScrollToNote,
  autoFollowScrollLeft,
  marqueeHitIds
} from "./melody-editor-geometry";
import {
  adjacentNoteId,
  constrainedMoveDelta,
  deleteNotesAndTransferText,
  displayTextForNote,
  mergeSelectedNotes,
  resizeBounds
} from "./melody-editor-operations";

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTime = (value) => Math.round(value * 1000) / 1000;
const noteName = (midi) => {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B"
  ];
  const value = Number(midi) || 0;
  return `${names[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
};
const cloneNotes = (notes) => notes.map((note) => ({ ...note }));
const EDITOR_STORAGE_KEY = "karaoke-melody-editor";
const editorPreferences = () => readJsonStorage(EDITOR_STORAGE_KEY);
const normalizeNotes = (notes = []) =>
  notes
    .map((note, index) => ({
      ...note,
      _id: note._id || `note-${index}-${note.start}-${note.end}`,
      start: Number(note.start) || 0,
      end: Number(note.end) || 0,
      midi_note: Number(note.midi_note ?? note.midi ?? 60),
      velocity: Number(note.velocity) || 96,
      word_index: note.word_index ?? null,
      syllable_index: note.syllable_index ?? null
    }))
    .filter((note) => note.end > note.start)
    .sort((a, b) => a.start - b.start || a.midi_note - b.midi_note);

function useEditorHistory(initial = []) {
  const [notes, setNotesState] = useState(initial);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const replace = useCallback((next, record = true) => {
    setNotesState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (record) {
        undoRef.current.push(cloneNotes(current));
        if (undoRef.current.length > 80) undoRef.current.shift();
        redoRef.current = [];
      }
      return normalizeNotes(value);
    });
  }, []);
  const reset = useCallback((value) => {
    undoRef.current = [];
    redoRef.current = [];
    setNotesState(normalizeNotes(value));
  }, []);
  const remember = useCallback((snapshot) => {
    undoRef.current.push(cloneNotes(snapshot));
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
  }, []);
  const undo = useCallback(() => {
    setNotesState((current) => {
      const previous = undoRef.current.pop();
      if (!previous) return current;
      redoRef.current.push(cloneNotes(current));
      return previous;
    });
  }, []);
  const redo = useCallback(() => {
    setNotesState((current) => {
      const next = redoRef.current.pop();
      if (!next) return current;
      undoRef.current.push(cloneNotes(current));
      return next;
    });
  }, []);
  return { notes, replace, reset, remember, undo, redo };
}

function ToolbarButton({
  icon,
  label,
  disabled,
  danger,
  active,
  tone = "neutral",
  onClick
}) {
  return (
    <IconButton
      icon={icon}
      label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "melody-editor-tool",
        danger && "is-danger",
        active && "is-active",
        `tone-${tone}`
      ]
        .filter(Boolean)
        .join(" ")}
      size={18}
    />
  );
}

export default function MelodyEditor({ song, onClose, onSaved }) {
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [zoom, setZoom] = useState(
    () => Number(editorPreferences().zoom) || 68
  );
  const [verticalZoom, setVerticalZoom] = useState(
    () => Number(editorPreferences().verticalZoom) || 14
  );
  const [autoScroll, setAutoScroll] = useState(
    () => editorPreferences().autoScroll ?? true
  );
  const [playbackRate, setPlaybackRate] = useState(
    () => Number(editorPreferences().playbackRate) || 1
  );
  const [volumes, setVolumes] = useState(() => ({
    vocals: Number(editorPreferences().volumes?.vocals ?? 0.7),
    melody: Number(editorPreferences().volumes?.melody ?? 0.9),
    instrumental: Number(editorPreferences().volumes?.instrumental ?? 0.45)
  }));
  const { notes, replace, reset, remember, undo, redo } = useEditorHistory([]);
  const vocalsRef = useRef(null);
  const instrumentalRef = useRef(null);
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const melodyGainRef = useRef(null);
  const rafRef = useRef(null);
  const transportClockRef = useRef({ media: 0, perf: 0, running: false });
  const dragRef = useRef(null);
  const selectionRef = useRef(null);
  const clipboardRef = useRef([]);
  const rollShellRef = useRef(null);
  const workspaceRef = useRef(null);
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
  const saveRef = useRef(null);
  const [selectionBox, setSelectionBox] = useState(null);

  useEffect(() => {
    persistUiPreferences(api, "melody_editor", {
      zoom,
      verticalZoom,
      autoScroll,
      playbackRate,
      volumes
    });
  }, [autoScroll, playbackRate, verticalZoom, volumes, zoom]);

  const songMap = payload?.song_map || {};
  const duration =
    Number(songMap.duration) || Math.max(1, ...notes.map((note) => note.end));
  const syllables = useMemo(
    () =>
      (songMap.syllables || []).map((item, index) => ({
        ...item,
        index: Number(item.index ?? index)
      })),
    [songMap.syllables]
  );
  const syllableByIndex = useMemo(
    () => new Map(syllables.map((item) => [item.index, item])),
    [syllables]
  );
  const labelOwnerBySyllable = useMemo(() => {
    const owners = new Map();
    notes.forEach((note) => {
      if (note.syllable_index == null || note.syllable_index === "") return;
      const index = Number(note.syllable_index);
      if (!Number.isFinite(index)) return;
      const current = owners.get(index);
      if (
        !current ||
        note.start < current.start ||
        (note.start === current.start && note.end < current.end)
      ) {
        owners.set(index, note);
      }
    });
    return new Map([...owners].map(([index, note]) => [index, note._id]));
  }, [notes]);
  const noteAtTime = useCallback(
    (value) =>
      notes.find((note) => note.start <= value && note.end > value) || null,
    [notes]
  );
  const midiValues = notes.map((note) => note.midi_note);
  const rawMinMidi = Math.min(...midiValues, 60);
  const rawMaxMidi = Math.max(...midiValues, 72);
  const wantedSpan = Math.max(60, rawMaxMidi - rawMinMidi + 24);
  const pitchCenter = (rawMinMidi + rawMaxMidi) / 2;
  let minMidi = Math.max(0, Math.floor(pitchCenter - wantedSpan / 2));
  const maxMidi = Math.min(127, minMidi + wantedSpan);
  minMidi = Math.max(0, maxMidi - wantedSpan);
  const rowHeight = verticalZoom;
  const keyboardWidth = 82;
  const laneHeight = (maxMidi - minMidi + 1) * rowHeight;
  const laneWidth = Math.max(1180, duration * zoom) + keyboardWidth;
  const whiteKeyGeometry = useMemo(() => {
    const white = Array.from(
      { length: maxMidi - minMidi + 1 },
      (_, index) => maxMidi - index
    ).filter((midi) => !BLACK_KEYS.has(((midi % 12) + 12) % 12));
    const centers = white.map((midi) => (maxMidi - midi + 0.5) * rowHeight);
    return white.map((midi, index) => {
      const center = centers[index];
      const previous =
        index > 0 ? centers[index - 1] : Math.max(0, center - rowHeight * 2);
      const next =
        index + 1 < centers.length
          ? centers[index + 1]
          : Math.min(laneHeight, center + rowHeight * 2);
      const top = index === 0 ? 0 : (previous + center) / 2;
      const bottom =
        index === centers.length - 1 ? laneHeight : (center + next) / 2;
      return { midi, top, height: Math.max(1, bottom - top) };
    });
  }, [laneHeight, maxMidi, minMidi, rowHeight]);

  const load = useCallback(async () => {
    if (!song?.id) return;
    setLoading(true);
    try {
      const result = await api.getSongEditor(song.id);
      setPayload(result);
      reset(result?.song_map?.notes || result?.song_map?.display_notes || []);
      setSelected([]);
    } catch (error) {
      await notify(`Не удалось открыть редактор: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [notify, reset, song?.id]);

  useEffect(() => {
    load();
  }, [load]);
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
      auditionRef.current = { oscillators, gain, midi: Number(midi) };
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
    if (!shell) return;
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
      if (master && !playheadDragRef.current) {
        const clock = transportClockRef.current;
        let current = master.currentTime || 0;
        if (!master.paused && !master.ended) {
          if (!clock.running) {
            clock.media = current;
            clock.perf = stamp;
            clock.running = true;
          }
          current = clamp(
            clock.media +
              ((stamp - clock.perf) / 1000) * (master.playbackRate || 1),
            0,
            duration
          );
          if (stamp - lastReconcileAt >= 400) {
            lastReconcileAt = stamp;
            const mediaCurrent = master.currentTime || current;
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
          const vocal = vocalsRef.current;
          if (vocal) {
            const mediaTime = master.currentTime || current;
            const drift = (vocal.currentTime || 0) - mediaTime;
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
          }
          const shell = rollShellRef.current;
          if (autoScroll && shell) {
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
    master?.pause();
    vocal?.pause();
    let current = master?.currentTime || 0;
    const origin = autoScroll ? playbackOriginRef.current : null;
    if (origin && master) {
      current = origin.time;
      master.currentTime = current;
      if (vocal) vocal.currentTime = current;
      const shell = rollShellRef.current;
      if (shell) {
        shell.scrollLeft = origin.scrollLeft;
        shell.scrollTop = origin.scrollTop;
        syncScrollState();
      }
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
    if (vocal) vocal.playbackRate = playbackRate;
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
    if (!master || !vocal) return;
    try {
      const shell = rollShellRef.current;
      playbackOriginRef.current = autoScroll
        ? {
            time: master.currentTime || 0,
            scrollLeft: shell?.scrollLeft || 0,
            scrollTop: shell?.scrollTop || 0
          }
        : null;
      vocal.currentTime = master.currentTime;
      master.playbackRate = playbackRate;
      vocal.playbackRate = playbackRate;
      transportClockRef.current = {
        media: master.currentTime || 0,
        perf: performance.now(),
        running: true
      };
      await Promise.allSettled([master.play(), vocal.play()]);
      setTime(master.currentTime || 0);
      setPlaying(true);
      updateSynth(master.currentTime || 0);
    } catch (error) {
      await notify(
        `Не удалось начать воспроизведение: ${getErrorMessage(error)}`
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
      if (instrumentalRef.current) instrumentalRef.current.currentTime = value;
      if (vocalsRef.current) {
        vocalsRef.current.currentTime = value;
        vocalsRef.current.playbackRate = playbackRate;
      }
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
      if (!canvas) return 0;
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
      if (playheadDragRef.current) playheadDragRef.current.value = next;
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
      const next = clamp(Number(nextZoom) || zoom, 36, 600);
      if (!shell || next === zoom) {
        setZoom(next);
        return;
      }

      const anchorTime = instrumentalRef.current?.currentTime ?? time;
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
    [duration, keyboardWidth, syncScrollState, time, zoom]
  );

  const setVerticalZoomAnchored = useCallback(
    (nextZoom) => {
      const shell = rollShellRef.current;
      const next = clamp(Number(nextZoom) || verticalZoom, 10, 36);
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
              ? { note, distance }
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
      if (!event.ctrlKey) return;
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
      window.removeEventListener("wheel", onWheel, { capture: true });
  }, [handleRollWheel]);

  const commit = useCallback((updater) => replace(updater, true), [replace]);
  const selectAll = useCallback(
    () => setSelected(notes.map((note) => note._id)),
    [notes]
  );
  const clearSelection = useCallback(() => setSelected([]), []);
  const selectAdjacentNote = useCallback(
    (direction) => {
      const id = adjacentNoteId(notes, selected, direction);
      if (!id) return;
      const note = notes.find((item) => item._id === id);
      if (!note) return;
      setSelected([id]);
      seek(note.start);
      auditionNote(note.midi_note, 180);
    },
    [auditionNote, notes, seek, selected]
  );
  const deleteSelected = useCallback(() => {
    if (!selected.length) return;
    commit((current) =>
      deleteNotesAndTransferText(current, selected, syllableByIndex)
    );
    setSelected([]);
  }, [commit, selected, syllableByIndex]);
  const nudgeSelected = useCallback(
    (timeDelta = 0, midiDelta = 0) => {
      if (!selected.length) return;
      const chosen = notes.filter((note) => selected.includes(note._id));
      if (!chosen.length) return;
      const minStart = Math.min(...chosen.map((note) => note.start));
      const maxEnd = Math.max(...chosen.map((note) => note.end));
      const safeTimeDelta = clamp(timeDelta, -minStart, duration - maxEnd);
      commit((current) =>
        current.map((note) =>
          selected.includes(note._id)
            ? {
                ...note,
                start: roundTime(note.start + safeTimeDelta),
                end: roundTime(note.end + safeTimeDelta),
                midi_note: clamp(note.midi_note + midiDelta, 0, 127)
              }
            : note
        )
      );
      auditionNote(clamp(chosen[0].midi_note + midiDelta, 0, 127), 150);
    },
    [auditionNote, commit, duration, notes, selected]
  );
  const copySelected = useCallback(() => {
    const chosen = notes.filter((note) => selected.includes(note._id));
    clipboardRef.current = cloneNotes(chosen);
  }, [notes, selected]);
  const pasteNotes = useCallback(() => {
    const copied = clipboardRef.current;
    if (!copied.length) return;
    const minStart = Math.min(...copied.map((note) => note.start));
    const span = Math.max(...copied.map((note) => note.end)) - minStart;
    const anchor = clamp(time, 0, Math.max(0, duration - span));
    const stamp = Date.now();
    const pasted = copied.map((note, index) => ({
      ...note,
      _id: `paste-${stamp}-${index}`,
      start: roundTime(anchor + note.start - minStart),
      end: roundTime(anchor + note.end - minStart)
    }));
    commit((current) => [...current, ...pasted]);
    setSelected(pasted.map((note) => note._id));
  }, [commit, duration, time]);
  const duplicateSelected = useCallback(() => {
    const chosen = notes.filter((note) => selected.includes(note._id));
    if (!chosen.length) return;
    const minStart = Math.min(...chosen.map((note) => note.start));
    const maxEnd = Math.max(...chosen.map((note) => note.end));
    const span = Math.max(0.03, maxEnd - minStart);
    const offset = clamp(span, 0, Math.max(0, duration - maxEnd));
    if (offset <= 0) return;
    const stamp = Date.now();
    const copies = chosen.map((note, index) => ({
      ...note,
      _id: `duplicate-${stamp}-${index}`,
      start: roundTime(note.start + offset),
      end: roundTime(note.end + offset)
    }));
    commit((current) => [...current, ...copies]);
    setSelected(copies.map((note) => note._id));
  }, [commit, duration, notes, selected]);
  const mergeSelected = useCallback(() => {
    const result = mergeSelectedNotes(notes, selected, syllableByIndex);
    if (!result.selectedId || selected.length < 2) return;
    commit(result.notes);
    setSelected([result.selectedId]);
  }, [commit, notes, selected, syllableByIndex]);
  const assignSyllable = useCallback(
    (value) => {
      const syllableIndex = value === "" ? null : Number(value);
      const syllable = syllableByIndex.get(syllableIndex);
      commit((current) =>
        current.map((note) =>
          selected.includes(note._id)
            ? {
                ...note,
                syllable_index: syllableIndex,
                word_index: syllable?.word_index ?? null,
                editor_text:
                  syllableIndex == null ? "" : String(syllable?.text || "")
              }
            : note
        )
      );
    },
    [commit, selected, syllableByIndex]
  );

  const startDrag = useCallback(
    (event, note, mode) => {
      event.preventDefault();
      event.stopPropagation();
      const extend = event.shiftKey || event.ctrlKey || event.metaKey;
      const movingSelection = selected.includes(note._id)
        ? selected
        : extend
          ? [...selected, note._id]
          : [note._id];
      setSelected(movingSelection);
      const originals = new Map(
        notes
          .filter((item) => movingSelection.includes(item._id))
          .map((item) => [item._id, { ...item }])
      );
      auditionNote(note.midi_note, 150);
      dragRef.current = {
        id: note._id,
        ids: movingSelection,
        mode,
        x: event.clientX,
        y: event.clientY,
        originals,
        snapshot: cloneNotes(notes),
        moved: false
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [auditionNote, notes, selected]
  );
  const drag = useCallback(
    (event) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = (event.clientX - state.x) / zoom;
      const rawDy = Math.round((state.y - event.clientY) / rowHeight);
      if (
        Math.abs(event.clientX - state.x) > 1 ||
        Math.abs(event.clientY - state.y) > 1
      )
        state.moved = true;
      const dy = event.shiftKey ? 0 : rawDy;

      if (state.mode === "move") {
        const safeDx = constrainedMoveDelta(
          state.snapshot,
          state.ids,
          dx,
          duration
        );
        const previewMidi = clamp(
          (state.originals.get(state.id)?.midi_note ?? 60) + dy,
          0,
          127
        );
        if (state.previewMidi !== previewMidi) {
          state.previewMidi = previewMidi;
          auditionNote(previewMidi, 95);
        }
        replace(
          (current) =>
            current.map((note) => {
              const original = state.originals.get(note._id);
              if (!original) return note;
              return {
                ...note,
                start: roundTime(original.start + safeDx),
                end: roundTime(original.end + safeDx),
                midi_note: clamp(original.midi_note + dy, 0, 127)
              };
            }),
          false
        );
        return;
      }

      const original = state.originals.get(state.id);
      if (!original) return;
      const bounds = resizeBounds(state.snapshot, state.id, duration);
      if (!bounds) return;

      let { start } = original;
      let { end } = original;
      if (state.mode === "left") {
        // The left handle can freely extend left until the song start or the previous note.
        start = clamp(original.start + dx, bounds.minStart, bounds.maxStart);
      } else {
        // The right handle stops at the next note, so notes never overlap.
        end = clamp(original.end + dx, bounds.minEnd, bounds.maxEnd);
      }

      if (
        !state.lastResizePreview ||
        performance.now() - state.lastResizePreview > 90
      ) {
        state.lastResizePreview = performance.now();
        auditionNote(original.midi_note, 85);
      }
      replace(
        (current) =>
          current.map((note) =>
            note._id === state.id
              ? { ...note, start: roundTime(start), end: roundTime(end) }
              : note
          ),
        false
      );
    },
    [auditionNote, duration, replace, rowHeight, zoom]
  );
  const endDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    if (state.moved) {
      remember(state.snapshot);
      const current = notes.find((note) => note._id === state.id);
      if (current) auditionNote(current.midi_note, 170);
    }
  }, [auditionNote, notes, remember]);

  const marqueeSelection = useCallback(
    (state) => {
      const hit = marqueeHitIds({
        notes,
        x1: state.x1,
        y1: state.y1,
        x2: state.x2,
        y2: state.y2,
        keyboardWidth,
        zoom,
        rowHeight,
        maxMidi
      });
      return [...new Set([...(state.base || []), ...hit])];
    },
    [keyboardWidth, maxMidi, notes, rowHeight, zoom]
  );

  const startMarquee = useCallback(
    (event) => {
      if (
        event.button !== 0 ||
        event.target.closest?.(
          ".melody-editor-note, .melody-editor-piano-key, .melody-editor-playhead"
        )
      )
        return;
      event.preventDefault();
      const canvas = rollCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const state = {
        pointerId: event.pointerId,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        additive,
        base: additive ? [...selected] : []
      };
      selectionRef.current = state;
      setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
      if (!additive) setSelected([]);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [selected]
  );

  const updateMarquee = useCallback(
    (event) => {
      const state = selectionRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const canvas = rollCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      state.x2 = event.clientX - rect.left;
      state.y2 = event.clientY - rect.top;
      setSelectionBox({
        x1: state.x1,
        y1: state.y1,
        x2: state.x2,
        y2: state.y2
      });

      // Highlight notes while the rectangle is moving, not only after mouse-up.
      if (
        Math.abs(state.x2 - state.x1) >= 2 ||
        Math.abs(state.y2 - state.y1) >= 2
      ) {
        setSelected(marqueeSelection(state));
      }
    },
    [marqueeSelection]
  );

  const endMarquee = useCallback(
    (event) => {
      const state = selectionRef.current;
      if (
        !state ||
        (event?.pointerId != null && state.pointerId !== event.pointerId)
      )
        return;
      selectionRef.current = null;
      setSelectionBox(null);
      const dragged =
        Math.abs(state.x2 - state.x1) >= 3 ||
        Math.abs(state.y2 - state.y1) >= 3;
      if (!dragged) {
        if (!state.additive) setSelected([]);
        return;
      }
      setSelected(marqueeSelection(state));
    },
    [marqueeSelection]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      const { target } = event;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !isHotkeyScopeActive(workspaceRef.current)
      )
        return;
      const editable = isEditableHotkeyTarget(target);
      const mod = event.ctrlKey || event.metaKey;
      const { code } = event;

      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      };

      if (mod && code === "KeyZ" && event.shiftKey) {
        consume();
        redo();
        return;
      }
      if (mod && code === "KeyZ") {
        consume();
        undo();
        return;
      }
      if (mod && code === "KeyY") {
        consume();
        redo();
        return;
      }
      if (mod && code === "KeyS") {
        consume();
        saveRef.current?.();
        return;
      }
      if (!editable && mod && code === "KeyA") {
        consume();
        selectAll();
        return;
      }
      if (!editable && mod && code === "KeyC") {
        consume();
        copySelected();
        return;
      }
      if (!editable && mod && code === "KeyX") {
        consume();
        copySelected();
        deleteSelected();
        return;
      }
      if (!editable && mod && code === "KeyV") {
        consume();
        pasteNotes();
        return;
      }
      if (!editable && mod && code === "KeyD") {
        consume();
        duplicateSelected();
        return;
      }

      if (event.code === "Space") {
        consume();
        playing ? pause() : play();
        return;
      }
      if (editable) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        consume();
        deleteSelected();
        return;
      }
      if (event.key === "Escape") {
        if (selected.length) {
          consume();
          clearSelection();
        }
        return;
      }
      if (event.key === "Home") {
        consume();
        seek(0);
        return;
      }
      if (event.key === "End") {
        consume();
        seek(duration);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        consume();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        if (mod) {
          nudgeSelected(direction * (event.shiftKey ? 0.25 : 0.05), 0);
          return;
        }
        selectAdjacentNote(direction);
        return;
      }
      if (!selected.length) return;
      if (event.key === "ArrowUp") {
        consume();
        nudgeSelected(0, event.shiftKey ? 12 : 1);
        return;
      }
      if (event.key === "ArrowDown") {
        consume();
        nudgeSelected(0, event.shiftKey ? -12 : -1);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    clearSelection,
    copySelected,
    deleteSelected,
    duplicateSelected,
    duration,
    nudgeSelected,
    pasteNotes,
    pause,
    play,
    playing,
    redo,
    seek,
    selectAdjacentNote,
    selectAll,
    selected.length,
    undo
  ]);

  const save = useCallback(async () => {
    if (!song?.id) return;
    setSaving(true);
    try {
      const serializable = notes.map(({ _id: _, ...note }) => note);
      const result = await api.saveSongEditor(song.id, serializable);
      setPayload(result);
      reset(result.song_map?.notes || serializable);
      setSelected([]);
      await onSaved?.();
    } catch (error) {
      await notify(`Не удалось сохранить редактор: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [notes, notify, onSaved, reset, song?.id]);

  saveRef.current = save;

  const restoreAi = useCallback(async () => {
    if (
      !payload?.ai_backup_exists ||
      !(await confirmDialog(
        "Вернуть исходный результат AI? Ручные изменения будут потеряны."
      ))
    )
      return;
    try {
      const result = await api.resetSongEditor(song.id);
      setPayload(result);
      reset(result.song_map?.notes || []);
      setSelected([]);
      await onSaved?.();
    } catch (error) {
      await notify(`Не удалось восстановить AI: ${getErrorMessage(error)}`);
    }
  }, [
    confirmDialog,
    notify,
    onSaved,
    payload?.ai_backup_exists,
    reset,
    song?.id
  ]);

  const selectedNote = notes.find((note) => note._id === selected[0]);

  return (
    <section
      ref={workspaceRef}
      className="melody-editor-workspace"
      aria-label={`Редактор мелодии ${song?.title || ""}`}
    >
      <header className="melody-editor-header">
        <div className="melody-editor-title-block">
          <span className="melody-editor-eyebrow">
            {song?.title || "Песня"} · VOCAL MELODY EDITOR
          </span>
        </div>
        <div className="melody-editor-statusline">
          <span className="melody-editor-status-pill">
            {selected.length
              ? `Выбрано ${selected.length}`
              : "Готов к редактированию"}
          </span>
          <span className="melody-editor-timecode">
            {time.toFixed(2)} / {duration.toFixed(2)} сек
          </span>
        </div>
      </header>

      {loading ? (
        <div className="melody-editor-loading">Загружаем SongMap…</div>
      ) : (
        <div className="melody-editor-layout">
          <div className="melody-editor-stage">
            <div className="melody-editor-topdeck melody-editor-topdeck-v11">
              <div
                className="melody-editor-action-groups"
                role="toolbar"
                aria-label="Инструменты редактора"
              >
                <div className="melody-editor-tool-group is-nav">
                  <ToolbarButton
                    icon={ArrowLeft}
                    label="Назад"
                    tone="neutral"
                    onClick={() => {
                      pause();
                      onClose?.();
                    }}
                  />
                  <ToolbarButton
                    icon={Save}
                    label={saving ? "Сохранение…" : "Сохранить"}
                    disabled={saving}
                    tone="pink"
                    active
                    onClick={save}
                  />
                </div>
                <div className="melody-editor-tool-group is-history">
                  <ToolbarButton
                    icon={Undo2}
                    label="Отменить"
                    tone="blue"
                    onClick={undo}
                  />
                  <ToolbarButton
                    icon={Redo2}
                    label="Вернуть отменённое"
                    tone="blue"
                    onClick={redo}
                  />
                </div>
                <div className="melody-editor-tool-group is-ai">
                  {payload?.ai_backup_exists && (
                    <ToolbarButton
                      icon={RotateCcw}
                      label="Вернуть результат AI"
                      tone="amber"
                      onClick={restoreAi}
                    />
                  )}
                  <ToolbarButton
                    icon={Crosshair}
                    label={
                      autoScroll
                        ? "Автопрокрутка включена"
                        : "Автопрокрутка выключена"
                    }
                    tone="cyan"
                    active={autoScroll}
                    onClick={toggleAutoScroll}
                  />
                </div>
                <div className="melody-editor-tool-group is-transport">
                  <ToolbarButton
                    icon={playing ? Pause : Play}
                    label={playing ? "Стоп" : "Воспроизвести"}
                    tone="green"
                    active={playing}
                    onClick={playing ? pause : play}
                  />
                  <label
                    className="melody-editor-speed"
                    htmlFor="melody-editor-playback-rate"
                  >
                    <span>Скорость</span>
                    <select
                      id="melody-editor-playback-rate"
                      value={playbackRate}
                      onChange={(event) =>
                        setPlaybackRate(Number(event.target.value) || 1)
                      }
                    >
                      <option value="0.5">50%</option>
                      <option value="0.65">65%</option>
                      <option value="0.75">75%</option>
                      <option value="0.85">85%</option>
                      <option value="1">100%</option>
                    </select>
                  </label>
                </div>
                <div className="melody-editor-tool-group is-edit">
                  <ToolbarButton
                    icon={Merge}
                    label="Соединить выбранные"
                    disabled={selected.length < 2}
                    tone="amber"
                    onClick={mergeSelected}
                  />
                  <ToolbarButton
                    icon={Trash2}
                    label="Удалить выбранные"
                    disabled={!selected.length}
                    danger
                    tone="red"
                    onClick={deleteSelected}
                  />
                </div>
              </div>

              <div className="melody-editor-compact-dials">
                <EffectDial
                  label="Вокал"
                  value={volumes.vocals}
                  onChange={(value) =>
                    setVolumes((v) => ({ ...v, vocals: Number(value) }))
                  }
                />
                <EffectDial
                  label="Мелодия"
                  value={volumes.melody}
                  accent="secondary"
                  onChange={(value) =>
                    setVolumes((v) => ({ ...v, melody: Number(value) }))
                  }
                />
                <EffectDial
                  label="Минус"
                  value={volumes.instrumental}
                  onChange={(value) =>
                    setVolumes((v) => ({ ...v, instrumental: Number(value) }))
                  }
                />
              </div>

              <div className="melody-editor-transport melody-editor-waveform-only">
                <SongStrip
                  song={song}
                  currentTime={time}
                  duration={duration}
                  onSeek={seek}
                />
              </div>

              <div
                className={`melody-editor-inline-selection ${selected.length ? "is-active" : ""}`}
              >
                {selectedNote ? (
                  <>
                    <strong>{noteName(selectedNote.midi_note)}</strong>
                    <span>
                      {selected.length > 1
                        ? `${selected.length} нот`
                        : `${selectedNote.start.toFixed(2)}–${selectedNote.end.toFixed(2)}с`}
                    </span>
                    <select
                      aria-label="Текст / слог"
                      value={selectedNote?.syllable_index ?? ""}
                      onChange={(event) => assignSyllable(event.target.value)}
                    >
                      <option value="">Без текста</option>
                      {syllables.map((item) => (
                        <option key={item.index} value={item.index}>
                          {item.text} · #{item.index}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span>Выберите ноту</span>
                )}
              </div>
            </div>
            <audio
              ref={vocalsRef}
              preload="metadata"
              src={api.getAudioTrackUrl(song.id, "vocals")}
            />
            <audio
              ref={instrumentalRef}
              preload="metadata"
              src={api.getAudioTrackUrl(song.id, "instrumental")}
              onEnded={pause}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                if (playheadDragRef.current || !event.currentTarget.paused)
                  return;
                const current = event.currentTarget.currentTime || 0;
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
              }}
            />

            <div
              ref={rollShellRef}
              className="melody-editor-roll-shell"
              onScroll={syncScrollState}
            >
              <div
                ref={rollCanvasRef}
                className="melody-editor-roll-canvas"
                style={{ width: laneWidth, height: laneHeight }}
                onPointerDown={startMarquee}
                onPointerMove={(event) => {
                  drag(event);
                  updateMarquee(event);
                }}
                onPointerUp={(event) => {
                  endDrag();
                  endMarquee(event);
                }}
                onPointerCancel={(event) => {
                  endDrag();
                  endMarquee(event);
                }}
                onDoubleClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  seek((event.clientX - rect.left - keyboardWidth) / zoom);
                }}
              >
                {Array.from({ length: maxMidi - minMidi + 1 }, (_, idx) => {
                  const midi = maxMidi - idx;
                  const black = BLACK_KEYS.has(((midi % 12) + 12) % 12);
                  return (
                    <div
                      key={`row-${midi}`}
                      className={`melody-editor-pitch-row ${black ? "is-black" : "is-white"}`}
                      style={{
                        left: keyboardWidth,
                        top: idx * rowHeight,
                        height: rowHeight
                      }}
                    />
                  );
                })}

                <div
                  className="melody-editor-keyboard"
                  style={{ width: keyboardWidth, height: laneHeight }}
                >
                  {whiteKeyGeometry.map(({ midi, top, height }) => (
                    <div
                      key={`white-${midi}`}
                      className="melody-editor-piano-key is-white"
                      style={{ top, width: keyboardWidth, height }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        auditionNote(midi, 220);
                      }}
                    >
                      <span>{noteName(midi)}</span>
                    </div>
                  ))}
                  {Array.from(
                    { length: maxMidi - minMidi + 1 },
                    (_, idx) => maxMidi - idx
                  )
                    .filter((midi) => BLACK_KEYS.has(((midi % 12) + 12) % 12))
                    .map((midi) => {
                      const center = (maxMidi - midi + 0.5) * rowHeight;
                      const height = rowHeight * 0.68;
                      return (
                        <div
                          key={`black-${midi}`}
                          className="melody-editor-piano-key is-black"
                          style={{
                            top: center - height / 2,
                            width: keyboardWidth * 0.64,
                            height
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            auditionNote(midi, 220);
                          }}
                        >
                          <span>{noteName(midi)}</span>
                        </div>
                      );
                    })}
                </div>
                <div
                  className="melody-editor-zero-time"
                  style={{ left: keyboardWidth }}
                >
                  0:00
                </div>

                {notes.map((note) => {
                  const top = (maxMidi - note.midi_note) * rowHeight + 1;
                  const left = keyboardWidth + note.start * zoom;
                  const width = Math.max(6, (note.end - note.start) * zoom);
                  const active = selected.includes(note._id);
                  const displayLabel = displayTextForNote(
                    note,
                    syllableByIndex,
                    labelOwnerBySyllable
                  );
                  return (
                    <div
                      key={note._id}
                      className={`melody-editor-note ${active ? "is-selected" : ""}`}
                      onPointerDown={(event) => startDrag(event, note, "move")}
                      style={{
                        left,
                        top,
                        width,
                        height: Math.max(8, rowHeight - 2)
                      }}
                      title={`${noteName(note.midi_note)} · ${note.start.toFixed(3)}–${note.end.toFixed(3)}`}
                    >
                      <span
                        className="melody-editor-note-handle is-left"
                        onPointerDown={(event) =>
                          startDrag(event, note, "left")
                        }
                      />
                      <span className="melody-editor-note-label">
                        {displayLabel}
                      </span>
                      <span
                        className="melody-editor-note-handle is-right"
                        onPointerDown={(event) =>
                          startDrag(event, note, "right")
                        }
                      />
                    </div>
                  );
                })}

                {selectionBox && (
                  <div
                    className="melody-editor-selection-box"
                    style={{
                      left: Math.min(selectionBox.x1, selectionBox.x2),
                      top: Math.min(selectionBox.y1, selectionBox.y2),
                      width: Math.abs(selectionBox.x2 - selectionBox.x1),
                      height: Math.abs(selectionBox.y2 - selectionBox.y1)
                    }}
                  />
                )}

                <div
                  className="melody-editor-playhead"
                  role="slider"
                  aria-label="Позиция воспроизведения"
                  aria-valuemin="0"
                  aria-valuemax={duration}
                  aria-valuenow={time}
                  tabIndex={0}
                  onPointerDown={startPlayheadDrag}
                  onPointerMove={movePlayheadDrag}
                  onPointerUp={endPlayheadDrag}
                  onPointerCancel={endPlayheadDrag}
                >
                  <span className="melody-editor-playhead-handle" />
                </div>
              </div>
            </div>

            <div
              className="melody-editor-cubase-scrollbar is-horizontal"
              aria-label="Горизонтальная прокрутка"
            >
              <div
                className="melody-editor-scroll-track"
                onPointerDown={(event) => {
                  const shell = rollShellRef.current;
                  if (!shell) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const max = Math.max(
                    1,
                    shell.scrollWidth - shell.clientWidth
                  );
                  shell.scrollLeft = clamp(
                    ((event.clientX - rect.left) / rect.width) * max,
                    0,
                    max
                  );
                  syncScrollState();
                }}
              >
                <span
                  className="melody-editor-scroll-thumb"
                  onPointerDown={(event) => startScrollThumbDrag(event, "x")}
                  onPointerMove={moveScrollThumbDrag}
                  onPointerUp={endScrollThumbDrag}
                  onPointerCancel={endScrollThumbDrag}
                  style={{
                    width: `${Math.max(7, (scrollState.clientWidth / scrollState.scrollWidth) * 100)}%`,
                    left: `${(scrollState.left / Math.max(1, scrollState.scrollWidth - scrollState.clientWidth)) * Math.max(0, 100 - Math.max(7, (scrollState.clientWidth / scrollState.scrollWidth) * 100))}%`
                  }}
                />
              </div>
              <label
                htmlFor="melody-editor-horizontal-zoom"
                className="melody-editor-inline-zoom"
                title="Горизонтальный масштаб · Ctrl+Shift+колесо"
              >
                <MoveHorizontal size={12} />
                <input
                  id="melody-editor-horizontal-zoom"
                  type="range"
                  min="36"
                  max="600"
                  step="1"
                  value={zoom}
                  onChange={(event) =>
                    setHorizontalZoomAnchored(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div
              className="melody-editor-cubase-scrollbar is-vertical"
              aria-label="Вертикальная прокрутка"
            >
              <div
                className="melody-editor-scroll-track"
                onPointerDown={(event) => {
                  const shell = rollShellRef.current;
                  if (!shell) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const max = Math.max(
                    1,
                    shell.scrollHeight - shell.clientHeight
                  );
                  shell.scrollTop = clamp(
                    ((event.clientY - rect.top) / rect.height) * max,
                    0,
                    max
                  );
                  syncScrollState();
                }}
              >
                <span
                  className="melody-editor-scroll-thumb"
                  onPointerDown={(event) => startScrollThumbDrag(event, "y")}
                  onPointerMove={moveScrollThumbDrag}
                  onPointerUp={endScrollThumbDrag}
                  onPointerCancel={endScrollThumbDrag}
                  style={{
                    height: `${Math.max(7, (scrollState.clientHeight / scrollState.scrollHeight) * 100)}%`,
                    top: `${(scrollState.top / Math.max(1, scrollState.scrollHeight - scrollState.clientHeight)) * Math.max(0, 100 - Math.max(7, (scrollState.clientHeight / scrollState.scrollHeight) * 100))}%`
                  }}
                />
              </div>
              <label
                htmlFor="melody-editor-vertical-zoom"
                className="melody-editor-inline-zoom is-vertical"
                title="Вертикальный масштаб · Ctrl+колесо"
              >
                <MoveVertical size={12} />
                <input
                  id="melody-editor-vertical-zoom"
                  type="range"
                  min="10"
                  max="36"
                  step="1"
                  value={verticalZoom}
                  onChange={(event) =>
                    setVerticalZoomAnchored(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
