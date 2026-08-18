import { translateSaved } from "../../../../i18n/runtime";
import { clamp } from "../../../../utils/math";
import { midiToWesternNote } from "../../utils/format";
import { getMelodyCue, getMelodyRange, getVisibleNotes } from "../../utils/melody";

const VIEW = { width: 1200, height: 288, labelWidth: 0, keyboardWidth: 48, seconds: 10 };
const BLACK_KEY_CLASSES = [1, 3, 6, 8, 10];
export default function MelodyRoll({
  notes,
  currentTime,
  sungMidi,
  isPitchDetected,
  keyShift,
  noteRangeMin,
  noteRangeMax
}) {
  const { width, height, labelWidth, keyboardWidth, seconds: windowSeconds } = VIEW;
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
  const { activeMidi, targetMidi } = getMelodyCue({ notes: visibleNotes, currentTime, keyShift });
  const indicatorMidi = Number.isFinite(sungMidi) ? sungMidi : targetMidi;

  // Keep one stable vertical scale for the whole song and NEVER crop valid
  // reference notes. The previous hard 24-semitone viewport silently hid any
  // notes outside two octaves. Songs with a wider vocal range therefore looked
  // increasingly broken when later phrases moved outside that artificial
  // window. getMelodyRange() already includes a small safety margin, so render
  // that complete range instead of following the current phrase.
  const minMidi = clamp(Math.floor(songMinMidi), 0, 127);
  const maxMidi = clamp(Math.ceil(songMaxMidi), minMidi, 127);
  const pitchRange = Math.max(1, maxMidi - minMidi + 1);
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(15, Math.max(5, rowHeight * 0.72));
  const lanes = Array.from({ length: pitchRange }, (_, index) => minMidi + index);
  const x = (time) =>
    noteLaneStart + ((time - viewStart) / windowSeconds) * (width - noteLaneStart);
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;
  const playheadX = x(currentTime);
  return (
    <div className="melody-roll">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        aria-label={translateSaved("Ноты мелодии")}
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
        {(() => {
          const naturals = lanes.filter(
            (midi) => !BLACK_KEY_CLASSES.includes(((midi % 12) + 12) % 12)
          );
          const naturalHeight = height / naturals.length;
          return naturals.map((midi, index) => {
            const keyTop = height - (index + 1) * naturalHeight + 0.3;
            const keyHeight = Math.max(2, naturalHeight - 0.6);
            const isActive = activeMidi === midi;
            return (
              <g key={`white-key-${midi}`}>
                <rect
                  x={labelWidth}
                  y={keyTop}
                  width={keyboardWidth}
                  height={keyHeight}
                  rx="1"
                  fill={isActive ? "#ed214b" : "#f4f3f7"}
                  fillOpacity={isActive ? ".72" : ".18"}
                />
                <text
                  x={5}
                  y={keyTop + keyHeight / 2}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fill={isActive ? "#fff" : "rgba(255,255,255,.82)"}
                  fontSize={Math.min(11, Math.max(7.5, keyHeight * 0.34))}
                  fontWeight={isActive ? "850" : "700"}
                  fontFamily="Inter, Segoe UI, sans-serif"
                >
                  {midiToWesternNote(midi)}
                </text>
              </g>
            );
          });
        })()}

        {(() => {
          const naturals = lanes.filter(
            (midi) => !BLACK_KEY_CLASSES.includes(((midi % 12) + 12) % 12)
          );
          const naturalHeight = height / naturals.length;
          const naturalIndex = new Map(naturals.map((midi, index) => [midi, index]));
          return lanes
            .filter((midi) => BLACK_KEY_CLASSES.includes(((midi % 12) + 12) % 12))
            .map((midi) => {
              const lowerNatural = [...naturals].reverse().find((value) => value < midi);
              const index = naturalIndex.get(lowerNatural);
              if (index == null) return null;
              const boundaryY = height - (index + 1) * naturalHeight;
              const blackHeight = naturalHeight * 0.62;
              const keyY = boundaryY - blackHeight / 2;
              const keyWidth = keyboardWidth * 0.64;
              const isActive = activeMidi === midi;
              return (
                <g key={`black-key-${midi}`}>
                  <rect
                    x={labelWidth}
                    y={keyY}
                    width={keyWidth}
                    height={blackHeight}
                    rx="1"
                    fill={isActive ? "#f3234c" : "#05050b"}
                    fillOpacity={isActive ? ".76" : ".42"}
                    stroke={isActive ? "#ff7188" : "rgba(255,255,255,.22)"}
                    strokeWidth=".65"
                  />
                  <text
                    x={4}
                    y={keyY + blackHeight / 2}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fill={isActive ? "#fff" : "rgba(255,255,255,.9)"}
                    fontSize={Math.min(9.5, Math.max(7, blackHeight * 0.42))}
                    fontWeight="800"
                    fontFamily="Inter, Segoe UI, sans-serif"
                  >
                    {midiToWesternNote(midi)}
                  </text>
                </g>
              );
            });
        })()}

        {/* Melody notes. */}
        {visibleNotes.map((note, index) => {
          const midi = note.midi + (Number(keyShift) || 0);
          if (midi < minMidi || midi > maxMidi) return null;
          const isCurrent = currentTime >= note.start && currentTime < note.end;
          const noteX = Math.max(noteLaneStart, x(note.start));
          const noteRight = Math.min(width, x(note.end));
          const noteWidth = Math.max(1.5, noteRight - noteX);
          const noteY = y(midi) + (rowHeight - noteHeight) / 2;
          const secondsPast = Math.max(0, currentTime - note.end);
          const isPast = note.end <= currentTime;
          const pastOpacity = isPast ? clamp(0.56 * (1 - secondsPast / 2.8), 0.035, 0.56) : 1;
          return (
            <g
              key={`note-${index}`}
              opacity={pastOpacity}
              className={isPast ? "melody-note-past" : undefined}
            >
              <rect
                x={noteX}
                y={noteY}
                width={noteWidth}
                height={noteHeight}
                rx={Math.min(8, noteHeight / 2)}
                fill={isCurrent ? "url(#piano-roll-note-current)" : "url(#piano-roll-note)"}
                fillOpacity={isPast ? ".34" : "1"}
                stroke="#ffc0ca"
                strokeOpacity={isPast ? ".42" : ".94"}
                strokeWidth="1.1"
              />
              <line
                x1={noteX + Math.min(7, noteWidth * 0.08)}
                x2={noteX + noteWidth - Math.min(7, noteWidth * 0.08)}
                y1={noteY + 2}
                y2={noteY + 2}
                stroke="#fff"
                strokeOpacity={isPast ? ".18" : ".54"}
                strokeWidth="1"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {isPitchDetected &&
          Number.isFinite(indicatorMidi) &&
          indicatorMidi >= minMidi &&
          indicatorMidi <= maxMidi && (
            <g className="melody-pitch-indicator" pointerEvents="none">
              <circle
                cx={playheadX}
                cy={y(indicatorMidi) + rowHeight / 2}
                r="10"
                fill="rgba(73, 255, 187, .16)"
                stroke="rgba(73, 255, 187, .5)"
                strokeWidth="1.4"
              />
              <circle
                cx={playheadX}
                cy={y(indicatorMidi) + rowHeight / 2}
                r="4.2"
                fill="#d9fff1"
                stroke="#31eda7"
                strokeWidth="2"
              />
            </g>
          )}

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
