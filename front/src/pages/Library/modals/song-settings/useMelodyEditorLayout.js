import { useCallback, useMemo } from "react";
import { canonicalLyricProjection } from "./melody-editor-operations";
import { BLACK_KEYS } from "./melody-editor-state";

export default function useMelodyEditorLayout({ notes, payload, verticalZoom, zoom }) {
  const songMap = payload?.song_map || {};
  const duration = Number(songMap.duration) || Math.max(1, ...notes.map((note) => note.end));
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
  const lyricProjection = useMemo(() => canonicalLyricProjection(syllables), [syllables]);
  const noteAtTime = useCallback(
    (value) => notes.find((note) => note.start <= value && note.end > value) || null,
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
    ).filter((midi) => !BLACK_KEYS.includes(((midi % 12) + 12) % 12));
    const centers = white.map((midi) => (maxMidi - midi + 0.5) * rowHeight);
    return white.map((midi, index) => {
      const center = centers[index];
      const previous = index > 0 ? centers[index - 1] : Math.max(0, center - rowHeight * 2);
      const next =
        index + 1 < centers.length
          ? centers[index + 1]
          : Math.min(laneHeight, center + rowHeight * 2);
      const top = index === 0 ? 0 : (previous + center) / 2;
      const bottom = index === centers.length - 1 ? laneHeight : (center + next) / 2;
      return { midi, top, height: Math.max(1, bottom - top) };
    });
  }, [laneHeight, maxMidi, minMidi, rowHeight]);

  return {
    duration,
    keyboardWidth,
    laneHeight,
    laneWidth,
    lyricProjection,
    maxMidi,
    minMidi,
    noteAtTime,
    rowHeight,
    syllableByIndex,
    syllables,
    whiteKeyGeometry
  };
}
