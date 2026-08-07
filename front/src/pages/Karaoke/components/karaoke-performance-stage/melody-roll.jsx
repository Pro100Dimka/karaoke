import { midiToWesternNote } from "../../utils/format";
import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../../utils/melody";

const VIEW = {
  width: 1200,
  height: 288,
  labelWidth: 0,
  keyboardWidth: 74,
  seconds: 10
};

const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function MelodyRoll({
  notes,
  currentTime,
  sungMidi,
  isPitchDetected,
  keyShift,
  noteRangeMin,
  noteRangeMax
}) {
  const {
    width,
    height,
    labelWidth,
    keyboardWidth,
    seconds: windowSeconds
  } = VIEW;
  const noteLaneStart = labelWidth + keyboardWidth;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = getVisibleNotes(notes, viewStart, viewEnd);
  const { minMidi: songMinMidi, maxMidi: songMaxMidi } = getMelodyRange({
    notes,
    keyShift,
    noteRangeMin,
    noteRangeMax,
    fallbackMidi: sungMidi
  });
  const { activeMidi, targetMidi } = getMelodyCue({
    notes: visibleNotes,
    currentTime,
    keyShift
  });
  const indicatorMidi = Number.isFinite(sungMidi) ? sungMidi : targetMidi;
  const visibleMidiValues = visibleNotes.map((note) => note.midi + keyShift);
  if (Number.isFinite(indicatorMidi)) visibleMidiValues.push(indicatorMidi);

  const phraseMin = visibleMidiValues.length
    ? Math.min(...visibleMidiValues)
    : songMinMidi;
  const phraseMax = visibleMidiValues.length
    ? Math.max(...visibleMidiValues)
    : songMaxMidi;
  // Always show exactly two chromatic octaves (24 semitones). This keeps the
  // piano scale stable instead of zooming in/out from phrase to phrase.
  const viewportSpan = 24;
  const phraseCenter = (phraseMin + phraseMax) / 2;
  let minMidi = Math.round(phraseCenter - (viewportSpan - 1) / 2);
  minMidi = clamp(minMidi, 0, 127 - viewportSpan + 1);
  const maxMidi = minMidi + viewportSpan - 1;
  const pitchRange = maxMidi - minMidi + 1;
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(15, Math.max(9, rowHeight * 0.62));
  const lanes = Array.from({ length: pitchRange }, (_, index) => minMidi + index);
  const x = (time) =>
    noteLaneStart +
    ((time - viewStart) / windowSeconds) * (width - noteLaneStart);
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;
  const playheadX = x(currentTime);

  return (
    <div className="melody-roll">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        aria-label="Ноты мелодии"
      >
        <defs>
          <linearGradient id="piano-roll-bg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#080812" />
            <stop offset=".48" stopColor="#0a0913" />
            <stop offset="1" stopColor="#070811" />
          </linearGradient>
          <linearGradient id="piano-roll-note" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd6dc" />
            <stop offset=".18" stopColor="#ff8d9c" />
            <stop offset=".52" stopColor="#ff536c" />
            <stop offset="1" stopColor="#f3224c" />
          </linearGradient>
          <linearGradient id="piano-roll-note-current" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff0f3" />
            <stop offset=".16" stopColor="#ff9bab" />
            <stop offset=".52" stopColor="#ff4966" />
            <stop offset="1" stopColor="#ed123f" />
          </linearGradient>
        </defs>

        {/* Keep only the label + piano-key area opaque. The actual note lane is
            transparent so the karaoke scene remains visible behind the notes. */}
        <rect
          className="piano-roll-keyboard-bed"
          x="0"
          y="0"
          width={noteLaneStart}
          height={height}
          fill="url(#piano-roll-bg)"
          opacity=".32"
        />

        {/* The note names live directly on the piano keys. No separate label
            column is rendered, so the keyboard reads as one continuous instrument. */}
        {/* Real piano-style keyboard: a continuous bed of white keys first,
            then shorter black keys layered on top at C#, D#, F#, G# and A#. */}
        {lanes
          .filter((midi) => !BLACK_KEY_CLASSES.has(((midi % 12) + 12) % 12))
          .map((midi) => {
            const center = y(midi) + rowHeight / 2;
            const naturalBelow = [...lanes]
              .reverse()
              .find(
                (candidate) =>
                  candidate < midi &&
                  !BLACK_KEY_CLASSES.has(((candidate % 12) + 12) % 12)
              );
            const naturalAbove = lanes.find(
              (candidate) =>
                candidate > midi &&
                !BLACK_KEY_CLASSES.has(((candidate % 12) + 12) % 12)
            );
            const top = naturalAbove != null
              ? (center + y(naturalAbove) + rowHeight / 2) / 2
              : Math.max(0, center - rowHeight);
            const bottom = naturalBelow != null
              ? (center + y(naturalBelow) + rowHeight / 2) / 2
              : Math.min(height, center + rowHeight);
            const isActive = activeMidi === midi;

            const keyTop = top + 0.35;
            const keyHeight = Math.max(2, bottom - top - 0.7);
            return (
              <g key={`white-key-${midi}`}>
                <rect
                  x={labelWidth}
                  y={keyTop}
                  width={keyboardWidth}
                  height={keyHeight}
                  rx="1.2"
                  fill={isActive ? "#ed214b" : "#f4f3f7"}
                  fillOpacity={isActive ? ".72" : ".12"}
                  stroke={isActive ? "#ff6b84" : "#ffffff"}
                  strokeOpacity={isActive ? ".72" : ".16"}
                  strokeWidth=".8"
                />
                <text
                  x={keyboardWidth - 8}
                  y={keyTop + keyHeight / 2 + Math.min(4, keyHeight * 0.18)}
                  textAnchor="end"
                  fill={isActive ? "#fff" : "rgba(255,255,255,.72)"}
                  fontSize={Math.min(12, Math.max(8, keyHeight * 0.38))}
                  fontWeight={isActive ? "850" : "700"}
                  fontFamily="Inter, Segoe UI, sans-serif"
                >
                  {midiToWesternNote(midi)}
                </text>
              </g>
            );
          })}

        {lanes
          .filter((midi) => BLACK_KEY_CLASSES.has(((midi % 12) + 12) % 12))
          .map((midi) => {
            const center = y(midi) + rowHeight / 2;
            const blackHeight = Math.max(4, rowHeight * 0.72);
            const isActive = activeMidi === midi;
            const keyY = center - blackHeight / 2;
            const keyWidth = keyboardWidth * 0.66;
            return (
              <g key={`black-key-${midi}`}>
                <rect
                  x={labelWidth}
                  y={keyY}
                  width={keyWidth}
                  height={blackHeight}
                  rx="1"
                  fill={isActive ? "#f3234c" : "#05050b"}
                  fillOpacity={isActive ? ".76" : ".32"}
                  stroke={isActive ? "#ff7188" : "#ffffff"}
                  strokeOpacity={isActive ? ".76" : ".12"}
                  strokeWidth=".8"
                />
                <text
                  x={keyWidth - 6}
                  y={keyY + blackHeight / 2 + Math.min(3.5, blackHeight * 0.2)}
                  textAnchor="end"
                  fill={isActive ? "#fff" : "rgba(255,255,255,.82)"}
                  fontSize={Math.min(10.5, Math.max(7.5, blackHeight * 0.46))}
                  fontWeight="800"
                  fontFamily="Inter, Segoe UI, sans-serif"
                >
                  {midiToWesternNote(midi)}
                </text>
              </g>
            );
          })}

        {/* Piano/key separator. The note lane intentionally has no cell grid. */}
        <line
          x1={noteLaneStart}
          x2={noteLaneStart}
          y1="0"
          y2={height}
          stroke="#4d2133"
          strokeWidth="1"
        />

        {/* Melody notes. */}
        {visibleNotes.map((note, index) => {
          const midi = note.midi + keyShift;
          if (midi < minMidi || midi > maxMidi) return null;
          const isCurrent = currentTime >= note.start && currentTime < note.end;
          const noteX = Math.max(noteLaneStart, x(note.start));
          const noteRight = Math.min(width, x(note.end));
          const noteWidth = Math.max(5, noteRight - noteX - 5);
          const noteY = y(midi) + (rowHeight - noteHeight) / 2;
          return (
            <g key={`note-${index}`}>
              <rect
                x={noteX}
                y={noteY}
                width={noteWidth}
                height={noteHeight}
                rx={Math.min(8, noteHeight / 2)}
                fill={
                  isCurrent
                    ? "url(#piano-roll-note-current)"
                    : "url(#piano-roll-note)"
                }
                stroke="#ffc0ca"
                strokeOpacity=".94"
                strokeWidth="1.1"
              />
              <line
                x1={noteX + Math.min(7, noteWidth * 0.08)}
                x2={noteX + noteWidth - Math.min(7, noteWidth * 0.08)}
                y1={noteY + 2}
                y2={noteY + 2}
                stroke="#fff"
                strokeOpacity=".54"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Bright red playback cursor. */}
        <g pointerEvents="none">
          <line
            x1={playheadX}
            x2={playheadX}
            y1="0"
            y2={height}
            stroke="#ff2549"
            strokeWidth="2.2"
            opacity=".98"
          />
          <line
            x1={playheadX}
            x2={playheadX}
            y1="0"
            y2={height}
            stroke="#ffd7de"
            strokeWidth=".72"
            opacity=".96"
          />
        </g>
      </svg>
    </div>
  );
}
