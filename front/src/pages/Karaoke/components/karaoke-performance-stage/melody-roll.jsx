import { midiToWesternNote } from "../../utils/format";
import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../../utils/melody";

const VIEW = {
  width: 1200,
  height: 220,
  labelWidth: 58,
  keyboardWidth: 40,
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
  const viewportSpan = Math.min(
    songMaxMidi - songMinMidi + 1,
    Math.max(10, phraseMax - phraseMin + 4)
  );
  const phraseCenter = (phraseMin + phraseMax) / 2;
  let minMidi = Math.floor(phraseCenter - viewportSpan / 2);
  minMidi = clamp(minMidi, songMinMidi, songMaxMidi - viewportSpan + 1);
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
          x="0"
          y="0"
          width={noteLaneStart}
          height={height}
          fill="url(#piano-roll-bg)"
        />

        {/* Pitch lanes and note labels. The keyboard itself is rendered separately
            below so black keys can overlap the white keys like a real piano. */}
        {lanes.map((midi) => {
          const isActive = activeMidi === midi;
          const laneY = y(midi);
          return (
            <g key={`lane-${midi}`}>
              {isActive && (
                <rect
                  x="0"
                  y={laneY}
                  width={labelWidth}
                  height={rowHeight}
                  fill="#d8173f"
                  opacity=".9"
                />
              )}
              <text
                x="18"
                y={laneY + rowHeight / 2 + Math.min(4, rowHeight * 0.24)}
                fill={isActive ? "#fff1f4" : "#b9b8c4"}
                fontSize={Math.min(12, Math.max(8.5, rowHeight * 0.58))}
                fontWeight={isActive ? "800" : "650"}
                fontFamily="Inter, Segoe UI, sans-serif"
              >
                {midiToWesternNote(midi)}
              </text>
            </g>
          );
        })}

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

            return (
              <rect
                key={`white-key-${midi}`}
                x={labelWidth}
                y={top + 0.35}
                width={keyboardWidth}
                height={Math.max(2, bottom - top - 0.7)}
                rx="1.2"
                fill={isActive ? "#ed214b" : "#dedde5"}
                stroke={isActive ? "#ff6b84" : "#20202b"}
                strokeWidth=".85"
              />
            );
          })}

        {lanes
          .filter((midi) => BLACK_KEY_CLASSES.has(((midi % 12) + 12) % 12))
          .map((midi) => {
            const center = y(midi) + rowHeight / 2;
            const blackHeight = Math.max(4, rowHeight * 0.72);
            const isActive = activeMidi === midi;
            return (
              <rect
                key={`black-key-${midi}`}
                x={labelWidth}
                y={center - blackHeight / 2}
                width={keyboardWidth * 0.62}
                height={blackHeight}
                rx="1"
                fill={isActive ? "#f3234c" : "#07070e"}
                stroke={isActive ? "#ff7188" : "#262531"}
                strokeWidth=".85"
              />
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
