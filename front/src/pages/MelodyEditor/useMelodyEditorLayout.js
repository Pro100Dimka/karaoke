import { useCallback, useMemo } from "react";
import { buildWhitePianoKeyGeometry } from "../../components/piano-keyboard";
import { canonicalLyricProjection } from "./melody-editor-operations";

export default function useMelodyEditorLayout({ notes, payload, verticalZoom, zoom }) {
  const lyricsSync = payload?.lyrics_sync || {};
  const duration = Number(lyricsSync.duration) || Math.max(1, ...notes.map((note) => note.end));
  const words = lyricsSync.words || [];
  const lyricProjection = useMemo(() => canonicalLyricProjection(words), [words]);
  const noteAtTime = useCallback(
    (value) => notes.find((note) => note.start <= value && note.end > value) || null,
    [notes]
  );
  const midiValues = notes.map((note) => note.note);
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
  const whiteKeyGeometry = useMemo(
    () => buildWhitePianoKeyGeometry({ minMidi, maxMidi, rowHeight, height: laneHeight }),
    [laneHeight, maxMidi, minMidi, rowHeight]
  );

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
    whiteKeyGeometry
  };
}
