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
  const height = 264;
  const scaleWidth = 52;
  const noteLaneStart = 44;
  // Keep a moderately shorter window: notes are more legible without making
  // the timeline feel detached from the music.
  const windowSeconds = 10;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = getVisibleNotes(notes, viewStart, viewEnd);
  // A fixed song-wide range keeps pitch lanes in the same place while the
  // timeline moves. Explicit song settings have priority over inferred notes.
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
  const isInTune =
    isPitchDetected &&
    Number.isFinite(sungMidi) &&
    Number.isFinite(targetMidi) &&
    Math.abs(sungMidi - targetMidi) <= 0.7;
  const indicatorMidi = Number.isFinite(sungMidi) ? sungMidi : targetMidi;
  const hasLivePitch = isPitchDetected && Number.isFinite(sungMidi);
  const visibleMidiValues = visibleNotes.map((note) => note.midi + keyShift);
  if (Number.isFinite(indicatorMidi)) visibleMidiValues.push(indicatorMidi);

  // Keep the complete song range stable, but zoom the visible viewport around
  // the notes currently being sung. This avoids a huge empty piano roll when
  // the song-wide range is much wider than the current phrase.
  const phraseMin = visibleMidiValues.length
    ? Math.min(...visibleMidiValues)
    : songMinMidi;
  const phraseMax = visibleMidiValues.length
    ? Math.max(...visibleMidiValues)
    : songMaxMidi;
  const viewportSpan = Math.min(
    songMaxMidi - songMinMidi + 1,
    Math.max(9, phraseMax - phraseMin + 5)
  );
  const phraseCenter = (phraseMin + phraseMax) / 2;
  let minMidi = Math.floor(phraseCenter - viewportSpan / 2);
  minMidi = Math.max(
    songMinMidi,
    Math.min(minMidi, songMaxMidi - viewportSpan + 1)
  );
  const maxMidi = minMidi + viewportSpan - 1;
  const pitchRange = maxMidi - minMidi + 1;
  const rowHeight = height / pitchRange;
  const noteHeight = Math.min(20, Math.max(9, rowHeight * 0.58));
  const displayMidiLanes = Array.from(
    { length: pitchRange },
    (_, index) => minMidi + index
  );
  const timeMarkers = Array.from(
    { length: windowSeconds + 1 },
    (_, index) => viewStart + index
  );

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
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-label="Ноты мелодии"
      >
        <defs>
          <linearGradient id="melody-stage-bg" x1="0" x2="1" y1="0" y2="1">
            <stop
              offset="0"
              stopColor="var(--color-bg-deep)"
              stopOpacity=".78"
            />
            <stop
              offset=".55"
              stopColor="var(--color-surface)"
              stopOpacity=".42"
            />
            <stop
              offset="1"
              stopColor="var(--color-bg-deep)"
              stopOpacity=".88"
            />
          </linearGradient>
          <linearGradient id="melody-now-zone" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
            <stop
              offset=".48"
              stopColor="var(--color-primary)"
              stopOpacity=".12"
            />
            <stop
              offset=".5"
              stopColor="var(--color-highlight)"
              stopOpacity=".2"
            />
            <stop
              offset=".52"
              stopColor="var(--color-primary)"
              stopOpacity=".12"
            />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="melody-note-past" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0"
              stopColor="var(--color-text-soft)"
              stopOpacity=".42"
            />
            <stop
              offset="1"
              stopColor="var(--color-text-muted)"
              stopOpacity=".16"
            />
          </linearGradient>
          <linearGradient id="melody-note-upcoming" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0"
              stopColor="var(--color-highlight)"
              stopOpacity=".94"
            />
            <stop
              offset="1"
              stopColor="var(--color-primary)"
              stopOpacity=".68"
            />
          </linearGradient>
          <linearGradient id="melody-note-active" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-highlight)" />
            <stop offset=".42" stopColor="var(--color-primary-soft)" />
            <stop offset="1" stopColor="var(--color-primary)" />
          </linearGradient>
          <linearGradient id="melody-note-hit" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-highlight)" />
            <stop offset=".45" stopColor="var(--color-success)" />
            <stop
              offset="1"
              stopColor="var(--color-success-strong, var(--color-success))"
            />
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
        <rect width={width} height={height} fill="url(#melody-stage-bg)" />
        <rect
          x={Math.max(noteLaneStart, x(currentTime) - 58)}
          width="116"
          height={height}
          fill="url(#melody-now-zone)"
        />
        {timeMarkers.map((time, index) => (
          <line
            key={`time-${index}`}
            x1={x(time)}
            x2={x(time)}
            y1="0"
            y2={height}
            stroke={
              index % 2 === 0
                ? "rgba(255,255,255,.08)"
                : "rgba(255,255,255,.035)"
            }
            strokeDasharray={index % 2 === 0 ? "0" : "3 7"}
          />
        ))}
        <rect
          x="0"
          y="0"
          width={noteLaneStart}
          height={height}
          fill="rgba(4,3,12,.46)"
        />
        <line
          x1={noteLaneStart}
          x2={noteLaneStart}
          y1="0"
          y2={height}
          stroke="rgba(255,255,255,.16)"
        />
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
                  fill="var(--color-primary)"
                  fillOpacity=".2"
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
                  fill="var(--color-highlight)"
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
                      ? "rgba(255,255,255,.9)"
                      : "rgba(255,255,255,.56)"
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
                      ? "var(--color-highlight)"
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
        <g className="melody-playhead" pointerEvents="none">
          <line
            x1={x(currentTime)}
            x2={x(currentTime)}
            y1="0"
            y2={height}
            stroke="var(--color-highlight)"
            strokeWidth="1.5"
            opacity=".82"
            filter="url(#melody-playhead-glow)"
          />
          <circle
            cx={x(currentTime)}
            cy="10"
            r="4.5"
            fill="var(--color-highlight)"
            filter="url(#melody-playhead-glow)"
          />
        </g>
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
