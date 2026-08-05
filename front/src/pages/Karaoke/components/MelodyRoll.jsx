import { midiToWesternNote } from "../utils/format";
import { getMelodyCue, getMelodyRange, getVisibleNotes } from "../utils/melody";

export default function MelodyRoll({
  notes,
  currentTime,
  sungMidi,
  isPitchDetected,
  isPitchAttacking,
  pitchRestProgress,
  keyShift,
  songTitle,
  noteRangeMin,
  noteRangeMax
}) {
  const width = 1000;
  const height = 310;
  const scaleWidth = 38;
  const noteLaneStart = 54;
  // Keep a moderately shorter window: notes are more legible without making
  // the timeline feel detached from the music.
  const windowSeconds = 10;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = getVisibleNotes(notes, viewStart, viewEnd);
  // A fixed song-wide range keeps pitch lanes in the same place while the
  // timeline moves. Explicit song settings have priority over inferred notes.
  const { minMidi, maxMidi, pitchRange } = getMelodyRange({
    notes,
    keyShift,
    noteRangeMin,
    noteRangeMax,
    fallbackMidi: sungMidi
  });
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(22, Math.max(7, rowHeight - 6));
  const { activeMidi, targetMidi } = getMelodyCue({
    notes: visibleNotes,
    currentTime,
    keyShift
  });
  const isInTune =
    isPitchDetected &&
    Number.isFinite(sungMidi) &&
    Number.isFinite(targetMidi) &&
    Math.abs(sungMidi - targetMidi) <= 0.7;
  const indicatorMidi = Number.isFinite(sungMidi) ? sungMidi : targetMidi;
  const hasLivePitch = isPitchDetected && Number.isFinite(sungMidi);
  const visibleMidiLanes = [
    ...new Set(visibleNotes.map((note) => note.midi + keyShift))
  ].sort((a, b) => a - b);
  const displayMidiLanes = visibleMidiLanes.length
    ? Array.from(
        { length: visibleMidiLanes.at(-1) - visibleMidiLanes[0] + 5 },
        (_, index) => visibleMidiLanes[0] - 2 + index
      )
    : [];

  const x = (time) =>
    noteLaneStart +
    ((time - viewStart) / windowSeconds) * (width - noteLaneStart);
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;
  const pitchY = Number.isFinite(indicatorMidi)
    ? y(indicatorMidi) + rowHeight / 2
    : height - 16;
  const indicatorY =
    pitchY +
    (height - 16 - pitchY) * Math.min(1, Math.max(0, pitchRestProgress));

  return (
    <div className="melody-roll">
      <div className="melody-roll-header">
        <div>
          <div className="melody-roll-caption">Мелодическая карта</div>
          <strong>{songTitle}</strong>
        </div>
        <div
          className="melody-roll-legend"
          aria-label="Обозначения мелодической карты"
        >
          <span>
            <i className="melody-legend-dot melody-legend-reference" />
            Эталон
          </span>
          <span>
            <i className="melody-legend-dot melody-legend-active" />
            Сейчас
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-label="Ноты мелодии"
      >
        <defs>
          <linearGradient id="melody-note-past" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#a5b4fc" stopOpacity=".46" />
            <stop offset="1" stopColor="#6366f1" stopOpacity=".2" />
          </linearGradient>
          <linearGradient id="melody-note-upcoming" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f0abfc" stopOpacity=".92" />
            <stop offset="1" stopColor="#db2777" stopOpacity=".62" />
          </linearGradient>
          <linearGradient id="melody-note-active" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#dbeafe" />
            <stop offset=".45" stopColor="#a5b4fc" />
            <stop offset="1" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient id="melody-note-hit" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#dcfce7" />
            <stop offset=".45" stopColor="#4ade80" />
            <stop offset="1" stopColor="#16a34a" />
          </linearGradient>
          <filter
            id="melody-active-glow"
            x="-40%"
            y="-100%"
            width="180%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="melody-playhead-glow"
            x="-150%"
            y="-20%"
            width="400%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {displayMidiLanes.map((midi) => {
          const isOctave = midi % 12 === 0;
          const isCurrentPitch = activeMidi === midi;
          return (
            <g key={midi}>
              {isCurrentPitch && (
                <rect
                  x="2"
                  y={y(midi) + 1}
                  width={scaleWidth - 4}
                  height={Math.max(9, rowHeight - 2)}
                  rx="7"
                  fill="rgba(129,140,248,.22)"
                />
              )}
              <line
                x1={noteLaneStart}
                x2={width}
                y1={y(midi) + rowHeight}
                y2={y(midi) + rowHeight}
                stroke={
                  isOctave ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.055)"
                }
              />
              {isCurrentPitch && (
                <path
                  d={`M27 ${y(midi) + rowHeight / 2 - 5} L39 ${y(midi) + rowHeight / 2} L27 ${y(midi) + rowHeight / 2 + 5}Z`}
                  fill="#c4b5fd"
                />
              )}
              <text
                x="18"
                y={y(midi) + rowHeight / 2 + 4}
                textAnchor="middle"
                fill={
                  isCurrentPitch
                    ? "#f5f3ff"
                    : isOctave
                      ? "rgba(245,243,255,.9)"
                      : "rgba(221,214,254,.63)"
                }
                fontSize={rowHeight < 16 ? "9" : "12"}
                fontWeight={isCurrentPitch || isOctave ? "800" : "650"}
              >
                {midiToWesternNote(midi)}
              </text>
            </g>
          );
        })}
        {visibleNotes.map((n, i) => {
          const isCurrent = currentTime >= n.start && currentTime < n.end;
          const isHit = isInTune && isCurrent;
          const isPast = n.end < currentTime;
          const pastOpacity = isPast
            ? Math.max(0.08, 1 - (currentTime - n.end) / 2.4)
            : 1;
          const noteX = Math.max(noteLaneStart, x(n.start));
          // Keep event boundaries visible even when two consecutive syllables
          // have the same pitch.  Without a deliberate screen-space gap they
          // look like one long note despite being separate MIDI events.
          const noteWidth = Math.max(3, Math.min(width, x(n.end)) - noteX - 7);
          const noteY = y(n.midi + keyShift) + (rowHeight - noteHeight) / 2;
          return (
            <g
              key={i}
              opacity={pastOpacity}
              className={`melody-note-platform ${isCurrent ? "is-current" : ""} ${isHit ? "is-hit" : ""}`}
            >
              <rect
                x={noteX}
                y={noteY}
                width={noteWidth}
                height={noteHeight}
                rx={Math.min(9, Math.max(3.5, noteHeight / 3))}
                fill={
                  isHit
                    ? "url(#melody-note-hit)"
                    : isCurrent
                      ? "url(#melody-note-active)"
                      : isPast
                        ? "url(#melody-note-past)"
                        : "url(#melody-note-upcoming)"
                }
                filter={isCurrent ? "url(#melody-active-glow)" : undefined}
                stroke={
                  isHit
                    ? "#86efac"
                    : isCurrent
                      ? "#c4b5fd"
                      : isPast
                        ? "rgba(165,180,252,.52)"
                        : "rgba(251,207,232,.8)"
                }
                strokeWidth="1.25"
              />
              {isCurrent && (
                <circle
                  cx={Math.min(width - 10, noteX + noteWidth - 7)}
                  cy={noteY + noteHeight / 2}
                  r={Math.min(8, noteHeight / 2 + 2)}
                  fill="rgba(255,255,255,.08)"
                  stroke="#e0e7ff"
                  strokeWidth="2.5"
                />
              )}
            </g>
          );
        })}
        {Number.isFinite(indicatorMidi) &&
          indicatorMidi >= minMidi - 1 &&
          indicatorMidi <= maxMidi + 1 && (
            <g
              transform={`translate(${x(currentTime)} 0)`}
              opacity={hasLivePitch ? 1 : 0.38}
            >
              <path
                d={`M-88 ${indicatorY} C-58 ${indicatorY - 10}, -26 ${indicatorY + 10}, 0 ${indicatorY}`}
                fill="none"
                stroke={
                  hasLivePitch
                    ? isInTune
                      ? "rgba(134,239,172,.78)"
                      : "rgba(249,168,212,.64)"
                    : "rgba(219,234,254,.18)"
                }
                strokeWidth="4"
                strokeLinecap="round"
                opacity=".7"
              />
              <circle
                cy={indicatorY}
                r="14"
                fill={
                  hasLivePitch
                    ? isInTune
                      ? "rgba(34,197,94,.22)"
                      : "rgba(244,114,182,.2)"
                    : "rgba(219,234,254,.08)"
                }
                style={{
                  transition: isPitchAttacking ? "none" : "cy .11s linear"
                }}
              />
              <circle
                cy={indicatorY}
                r="7"
                fill={
                  hasLivePitch
                    ? isInTune
                      ? "#86efac"
                      : "#f9a8d4"
                    : "rgba(219,234,254,.14)"
                }
                stroke={hasLivePitch ? "#fff" : "rgba(255,255,255,.45)"}
                strokeWidth="2"
                style={{
                  transition: isPitchAttacking ? "none" : "cy .11s linear"
                }}
              />
            </g>
          )}
      </svg>
    </div>
  );
}
