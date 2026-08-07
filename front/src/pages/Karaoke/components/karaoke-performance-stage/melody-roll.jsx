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
  const timeMarkers = Array.from(
    { length: windowSeconds * 2 + 1 },
    (_, index) => viewStart + index / 2
  );

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
          <filter id="piano-roll-note-glow" x="-35%" y="-180%" width="170%" height="460%">
            <feGaussianBlur stdDeviation="4.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0.35  0 0.22 0 0 0  0 0 0.18 0 0.02  0 0 0 0.95 0"
              result="redGlow"
            />
            <feMerge>
              <feMergeNode in="redGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="piano-roll-playhead-glow" x="-500%" y="-10%" width="1100%" height="120%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="piano-roll-soft-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
        </defs>

        <rect width={width} height={height} fill="url(#piano-roll-bg)" />

        {/* Subtle red glow around the playback area, like the reference. */}
        <rect
          x={Math.max(noteLaneStart, playheadX - 170)}
          y="0"
          width="340"
          height={height}
          fill="#ff173f"
          opacity=".055"
          filter="url(#piano-roll-soft-glow)"
        />

        {/* Pitch lanes. */}
        {lanes.map((midi) => {
          const pitchClass = ((midi % 12) + 12) % 12;
          const isSharp = BLACK_KEY_CLASSES.has(pitchClass);
          const isActive = activeMidi === midi;
          const laneY = y(midi);
          return (
            <g key={`lane-${midi}`}>
              {isActive && (
                <rect
                  x="0"
                  y={laneY}
                  width={noteLaneStart}
                  height={rowHeight}
                  fill="#d8173f"
                  opacity=".78"
                />
              )}
              <line
                x1={noteLaneStart}
                x2={width}
                y1={laneY + rowHeight}
                y2={laneY + rowHeight}
                stroke={isSharp ? "#361226" : "#4a1427"}
                strokeOpacity={isSharp ? ".56" : ".72"}
                strokeWidth=".75"
              />
              <text
                x="18"
                y={laneY + rowHeight / 2 + Math.min(4, rowHeight * 0.24)}
                fill={isActive ? "#ffdae1" : "#b9b8c4"}
                fontSize={Math.min(12, Math.max(8.5, rowHeight * 0.58))}
                fontWeight={isActive ? "800" : "650"}
                fontFamily="Inter, Segoe UI, sans-serif"
              >
                {midiToWesternNote(midi)}
              </text>

              {/* Piano keyboard. White keys span the full keyboard width; black keys sit on top. */}
              {!isSharp && (
                <rect
                  x={labelWidth}
                  y={laneY + 0.45}
                  width={keyboardWidth}
                  height={Math.max(1, rowHeight - 0.9)}
                  rx="1"
                  fill={isActive ? "#ee3153" : "#d7d5df"}
                  stroke="#181722"
                  strokeWidth=".7"
                />
              )}
              {isSharp && (
                <rect
                  x={labelWidth}
                  y={laneY + rowHeight * 0.13}
                  width={keyboardWidth * 0.56}
                  height={Math.max(3, rowHeight * 0.74)}
                  rx="1"
                  fill={isActive ? "#ff3156" : "#080812"}
                  stroke="#211d2a"
                  strokeWidth=".7"
                />
              )}
            </g>
          );
        })}

        {/* Piano/key separator and vertical time grid. */}
        <line
          x1={noteLaneStart}
          x2={noteLaneStart}
          y1="0"
          y2={height}
          stroke="#4d2133"
          strokeWidth="1"
        />
        {timeMarkers.map((time, index) => (
          <line
            key={`grid-time-${index}`}
            x1={x(time)}
            x2={x(time)}
            y1="0"
            y2={height}
            stroke={index % 2 === 0 ? "#4a1b34" : "#35142a"}
            strokeOpacity={index % 2 === 0 ? ".78" : ".48"}
            strokeWidth={index % 2 === 0 ? ".85" : ".65"}
          />
        ))}

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
            <g key={`note-${index}`} filter="url(#piano-roll-note-glow)">
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
            filter="url(#piano-roll-playhead-glow)"
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
