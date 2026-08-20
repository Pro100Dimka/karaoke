import { translateSaved } from "../../../../i18n/runtime";
import { clamp } from "../../../../utils/math";
import { midiToWesternNote } from "../../utils/format";

const VIEW = { width: 1200, height: 288, keyboardWidth: 48, seconds: 10, lead: 2.5 };
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const isBlackKey = (note) => BLACK_KEYS.has(((note % 12) + 12) % 12);

function visibleLyricsNotes(notes, viewStart, viewEnd, keyShift) {
  return notes
    .map((note, index) => ({
      ...note,
      _renderKey: note._id || `${note.start}-${note.end}-${note.note}-${index}`,
      note: Number(note.note) + keyShift,
      start: Number(note.start),
      end: Number(note.end)
    }))
    .filter(
      (note) =>
        Number.isFinite(note.note) &&
        Number.isFinite(note.start) &&
        Number.isFinite(note.end) &&
        note.end > note.start &&
        note.end >= viewStart &&
        note.start <= viewEnd
    );
}

function melodyRange(notes, keyShift, sungNote) {
  const pitches = notes.map((note) => Number(note.note) + keyShift).filter(Number.isFinite);
  if (pitches.length === 0 && Number.isFinite(sungNote)) pitches.push(sungNote);
  if (pitches.length === 0) pitches.push(60);
  return {
    min: clamp(Math.floor(Math.min(...pitches)) - 2, 0, 127),
    max: clamp(Math.ceil(Math.max(...pitches)) + 2, 0, 127)
  };
}

function PianoKeyboard({ height, keyboardWidth, lanes, rowHeight, activeNote }) {
  return (
    <g className="melody-keyboard">
      {lanes.map((note) => {
        const black = isBlackKey(note);
        const y = height - (note - lanes[0] + 1) * rowHeight;
        const active = note === activeNote;
        return (
          <g key={`key-${note}`}>
            <rect
              fill={active ? "#ed214b" : black ? "#05050b" : "#f4f3f7"}
              fillOpacity={active ? 0.76 : black ? 0.46 : 0.18}
              height={Math.max(1, rowHeight - 0.5)}
              stroke="rgba(255,255,255,.18)"
              strokeWidth=".5"
              width={black ? keyboardWidth * 0.66 : keyboardWidth}
              x="0"
              y={y + 0.25}
            />
            {!black && rowHeight >= 8 && (
              <text
                dominantBaseline="middle"
                fill={active ? "#fff" : "rgba(255,255,255,.82)"}
                fontFamily="Inter, Segoe UI, sans-serif"
                fontSize={Math.min(10, rowHeight * 0.45)}
                fontWeight="750"
                x="4"
                y={y + rowHeight / 2}
              >
                {midiToWesternNote(note)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export default function MelodyRoll({
  notes,
  currentTime,
  sungMidi = null,
  isPitchDetected = false,
  keyShift = 0
}) {
  const { width, height, keyboardWidth, seconds, lead } = VIEW;
  const time = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
  const shift = Number.isFinite(Number(keyShift)) ? Number(keyShift) : 0;
  const viewStart = Math.max(0, time - lead);
  const viewEnd = viewStart + seconds;
  const visibleNotes = visibleLyricsNotes(notes, viewStart, viewEnd, shift);
  const { min, max } = melodyRange(notes, shift, Number(sungMidi));
  const pitchRange = Math.max(1, max - min + 1);
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(15, Math.max(5, rowHeight * 0.72));
  const lanes = Array.from({ length: pitchRange }, (_, index) => min + index);
  const laneWidth = width - keyboardWidth;
  const x = (value) => keyboardWidth + ((value - viewStart) / seconds) * laneWidth;
  const y = (note) => height - (note - min + 1) * rowHeight;
  const active = visibleNotes.find((note) => time >= note.start && time < note.end);
  const indicator = Number(sungMidi);
  const playheadX = x(time);

  return (
    <div className="melody-roll">
      <svg
        aria-label={translateSaved("Ноты мелодии")}
        height="100%"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <defs>
          <linearGradient id="piano-roll-bg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#080812" />
            <stop offset="1" stopColor="#070811" />
          </linearGradient>
          <linearGradient id="piano-roll-note" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd6dc" />
            <stop offset=".3" stopColor="#ff7c90" />
            <stop offset="1" stopColor="#f3224c" />
          </linearGradient>
          <linearGradient id="piano-roll-note-current" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff0f3" />
            <stop offset=".3" stopColor="#ff9bab" />
            <stop offset="1" stopColor="#ed123f" />
          </linearGradient>
        </defs>

        <rect
          className="piano-roll-keyboard-bed"
          fill="url(#piano-roll-bg)"
          height={height}
          opacity=".32"
          width={keyboardWidth}
          x="0"
          y="0"
        />
        <PianoKeyboard
          activeNote={active?.note ?? null}
          height={height}
          keyboardWidth={keyboardWidth}
          lanes={lanes}
          rowHeight={rowHeight}
        />

        {visibleNotes.map((note) => {
          const noteX = Math.max(keyboardWidth, x(note.start));
          const noteRight = Math.min(width, x(note.end));
          const current = time >= note.start && time < note.end;
          const past = note.end <= time;
          const opacity = past ? clamp(0.56 * (1 - (time - note.end) / 2.8), 0.04, 0.56) : 1;
          return (
            <rect
              key={note._renderKey}
              className={
                current ? "melody-note-current" : past ? "melody-note-past" : "melody-note"
              }
              data-end={note.end}
              data-midi={note.note}
              data-start={note.start}
              fill={current ? "url(#piano-roll-note-current)" : "url(#piano-roll-note)"}
              height={noteHeight}
              opacity={opacity}
              rx={Math.min(8, noteHeight / 2)}
              stroke="#ffc0ca"
              strokeOpacity={past ? 0.42 : 0.94}
              strokeWidth="1.1"
              width={Math.max(1.5, noteRight - noteX)}
              x={noteX}
              y={y(note.note) + (rowHeight - noteHeight) / 2}
            />
          );
        })}

        {isPitchDetected && Number.isFinite(indicator) && indicator >= min && indicator <= max && (
          <g className="melody-pitch-indicator" pointerEvents="none">
            <circle
              cx={playheadX}
              cy={y(indicator) + rowHeight / 2}
              fill="rgba(73,255,187,.16)"
              r="10"
              stroke="rgba(73,255,187,.5)"
              strokeWidth="1.4"
            />
            <circle
              cx={playheadX}
              cy={y(indicator) + rowHeight / 2}
              fill="#d9fff1"
              r="4.2"
              stroke="#31eda7"
              strokeWidth="2"
            />
          </g>
        )}

        <line
          className="melody-playhead"
          stroke="#ff2549"
          strokeWidth="2.2"
          x1={playheadX}
          x2={playheadX}
          y1="0"
          y2={height}
        />
      </svg>
    </div>
  );
}
