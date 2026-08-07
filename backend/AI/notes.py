from __future__ import annotations

import math
import statistics
from bisect import bisect_left

from .models import PitchFrame, Syllable, VocalNote

NOTE_DECODER_VERSION = "sustained-note-events-v3"


def hz_to_midi(hz: float) -> float:
    return 69.0 + 12.0 * math.log2(float(hz) / 440.0)


def _median_filter(values: list[float], radius: int = 2) -> list[float]:
    if not values:
        return []
    output: list[float] = []
    for index in range(len(values)):
        lo = max(0, index - radius)
        hi = min(len(values), index + radius + 1)
        output.append(float(statistics.median(values[lo:hi])))
    return output


def _weighted_median(values: list[float], weights: list[float]) -> float:
    if not values:
        raise ValueError("weighted median requires at least one value")
    pairs = sorted(zip(values, weights), key=lambda item: item[0])
    total = sum(max(0.0, weight) for _, weight in pairs)
    if total <= 1e-12:
        return float(statistics.median(values))
    cursor = 0.0
    midpoint = total / 2.0
    for value, weight in pairs:
        cursor += max(0.0, weight)
        if cursor >= midpoint:
            return float(value)
    return float(pairs[-1][0])


def _voiced_runs(
    frames: list[PitchFrame],
    *,
    max_gap: float,
    min_confidence: float,
) -> list[list[PitchFrame]]:
    usable = [
        frame
        for frame in frames
        if frame.voiced
        and frame.frequency > 0
        and frame.confidence >= min_confidence
    ]
    if not usable:
        return []

    runs: list[list[PitchFrame]] = [[usable[0]]]
    for frame in usable[1:]:
        if frame.time - runs[-1][-1].time > max_gap:
            runs.append([frame])
        else:
            runs[-1].append(frame)
    return runs


def _sustained_pitch_segments(
    run: list[PitchFrame],
    *,
    split_semitones: float,
    min_note: float,
) -> list[list[PitchFrame]]:
    """Split only on a *sustained* pitch-center change.

    The previous decoder split as soon as a single FCPE frame moved by roughly
    0.7 semitone. Singing vibrato commonly crosses that amount, which produced
    machine-gun MIDI. This decoder requires a new pitch level to persist for a
    useful musical duration before creating another note event.
    """
    if len(run) < 2:
        return [run] if run else []

    midi = [hz_to_midi(frame.frequency) for frame in run]
    smooth = _median_filter(midi, radius=8)
    step = statistics.median(
        [b.time - a.time for a, b in zip(run, run[1:]) if b.time > a.time]
    ) if len(run) > 1 else 0.01
    step = max(0.005, min(0.04, float(step)))

    # Require ~70 ms of stable evidence. Short ornaments remain pitch bends;
    # sustained melodic moves become separate notes.
    sustain_frames = max(4, int(round(max(0.065, min_note) / step)))
    history_frames = max(5, int(round(0.09 / step)))
    threshold = max(0.62, float(split_semitones))

    boundaries = [0]
    segment_start = 0
    index = sustain_frames
    while index < len(run):
        history_start = max(segment_start, index - history_frames)
        baseline = statistics.median(smooth[history_start:index])
        future_end = min(len(run), index + sustain_frames)
        if future_end - index < sustain_frames:
            break
        future = smooth[index:future_end]
        future_center = statistics.median(future)
        delta = future_center - baseline

        if abs(delta) >= threshold:
            same_direction = sum(
                1
                for value in future
                if (value - baseline) * delta > 0
                and abs(value - baseline) >= threshold * 0.65
            )
            # A true note transition has most future frames on the new side of
            # the old center. Symmetric vibrato does not.
            if same_direction >= math.ceil(len(future) * 0.75):
                boundary = index
                left_duration = run[boundary - 1].time - run[segment_start].time + step
                right_duration = run[future_end - 1].time - run[boundary].time + step
                if left_duration >= min_note and right_duration >= min_note:
                    boundaries.append(boundary)
                    segment_start = boundary
                    index = boundary + sustain_frames
                    continue
        index += 1

    boundaries.append(len(run))
    segments = [run[a:b] for a, b in zip(boundaries, boundaries[1:]) if b > a]

    # Merge tiny fragments into the closest neighbour instead of dropping them.
    merged: list[list[PitchFrame]] = []
    for segment in segments:
        duration = segment[-1].time - segment[0].time + step
        if duration >= min_note or not merged:
            merged.append(segment)
            continue
        previous = merged[-1]
        previous_center = statistics.median(hz_to_midi(f.frequency) for f in previous)
        center = statistics.median(hz_to_midi(f.frequency) for f in segment)
        if abs(center - previous_center) < 2.0:
            previous.extend(segment)
        else:
            merged.append(segment)
    return merged


def _bend_curve(
    segment: list[PitchFrame],
    *,
    start: float,
    base: int,
    duration: float,
) -> tuple[tuple[float, float], ...]:
    if not segment:
        return ()
    midi = _median_filter([hz_to_midi(frame.frequency) for frame in segment], radius=1)
    result: list[tuple[float, float]] = []
    last_time = -1.0
    last_cents: float | None = None
    for index, (frame, value) in enumerate(zip(segment, midi)):
        relative = max(0.0, min(duration, frame.time - start))
        cents = max(-199.0, min(199.0, (value - base) * 100.0))
        # MIDI pitch-bend does not need a 100 Hz control stream. Keep changes
        # at ~25 ms resolution unless the bend changed materially.
        if index not in {0, len(segment) - 1}:
            if relative - last_time < 0.025 and last_cents is not None and abs(cents - last_cents) < 12.0:
                continue
        result.append((relative, cents))
        last_time = relative
        last_cents = cents
    return tuple(result)


def _note_from_segment(
    segment: list[PitchFrame],
    syllable: Syllable,
    *,
    min_note: float,
) -> VocalNote | None:
    if not segment:
        return None
    step = (
        statistics.median([b.time - a.time for a, b in zip(segment, segment[1:]) if b.time > a.time])
        if len(segment) > 1
        else 0.01
    )
    step = max(0.005, min(0.04, float(step)))
    start = max(syllable.start, segment[0].time)
    end = min(syllable.end, segment[-1].time + step)
    if end - start < min_note:
        return None

    values = [hz_to_midi(frame.frequency) for frame in segment]
    energies = [max(frame.energy, 1e-4) for frame in segment]
    max_energy = max(energies) if energies else 1.0
    weights = [
        max(0.02, frame.confidence) * (0.35 + 0.65 * energy / max_energy)
        for frame, energy in zip(segment, energies)
    ]
    center = _weighted_median(values, weights)
    base = max(0, min(127, int(round(center))))
    confidence = sum(frame.confidence for frame in segment) / len(segment)
    velocity = max(42, min(118, int(round(62 + confidence * 48))))
    cents = _bend_curve(segment, start=start, base=base, duration=end - start)
    return VocalNote(
        start,
        end,
        base,
        velocity,
        syllable.word_index,
        syllable.index,
        cents,
    )


def build_vocal_notes(
    pitch: list[PitchFrame],
    syllables: list[Syllable],
    min_note: float = 0.055,
    split_semitones: float = 0.78,
    max_gap: float = 0.05,
    min_confidence: float = 0.42,
) -> list[VocalNote]:
    """Decode a monophonic singing performance into note events.

    Syllable boundaries are the primary linguistic attacks. Inside a syllable we
    create another MIDI note only for a sustained melodic transition. Vibrato,
    portamento and short pitch excursions stay on the current note as bends.
    """
    frames = sorted(pitch, key=lambda frame: frame.time)
    times = [frame.time for frame in frames]
    output: list[VocalNote] = []

    for syllable in syllables:
        left = bisect_left(times, syllable.start)
        right = bisect_left(times, syllable.end + 1e-9, lo=left)
        syllable_frames = frames[left:right]
        runs = _voiced_runs(
            syllable_frames,
            max_gap=max_gap,
            min_confidence=min_confidence,
        )
        for run in runs:
            for segment in _sustained_pitch_segments(
                run,
                split_semitones=split_semitones,
                min_note=min_note,
            ):
                note = _note_from_segment(segment, syllable, min_note=min_note)
                if note is not None:
                    output.append(note)

    ordered = sorted(output, key=lambda note: (note.start, note.end))
    monophonic: list[VocalNote] = []
    for note in ordered:
        if monophonic and note.start < monophonic[-1].end:
            previous = monophonic[-1]
            trimmed_end = max(previous.start, note.start)
            if trimmed_end - previous.start >= min_note:
                monophonic[-1] = VocalNote(
                    previous.start,
                    trimmed_end,
                    previous.midi_note,
                    previous.velocity,
                    previous.word_index,
                    previous.syllable_index,
                    tuple(
                        (time, cents)
                        for time, cents in previous.cents
                        if time <= trimmed_end - previous.start + 1e-9
                    ),
                )
            else:
                monophonic.pop()
        monophonic.append(note)
    return monophonic


def build_game_notes(vocal: list[VocalNote], min_note: float = 0.08) -> list[VocalNote]:
    """Create a stable karaoke scoring melody from the detailed vocal MIDI."""
    output: list[VocalNote] = []
    for note in vocal:
        clean = VocalNote(
            note.start,
            note.end,
            int(note.midi_note),
            note.velocity,
            note.word_index,
            note.syllable_index,
            (),
        )
        if clean.end - clean.start < min_note:
            continue

        if output:
            previous = output[-1]
            same_unit = (
                clean.word_index == previous.word_index
                and clean.syllable_index == previous.syllable_index
            )
            tiny_gap = clean.start - previous.end <= 0.055
            # Merge same-pitch fragments. Also absorb a one-semitone micro-event
            # when it is very short; these are commonly residual vibrato edges.
            if same_unit and tiny_gap and (
                clean.midi_note == previous.midi_note
                or (
                    abs(clean.midi_note - previous.midi_note) == 1
                    and clean.end - clean.start < 0.13
                )
            ):
                weighted_pitch = (
                    previous.midi_note * (previous.end - previous.start)
                    + clean.midi_note * (clean.end - clean.start)
                ) / max(1e-6, clean.end - previous.start)
                output[-1] = VocalNote(
                    previous.start,
                    clean.end,
                    int(round(weighted_pitch)),
                    max(previous.velocity, clean.velocity),
                    previous.word_index,
                    previous.syllable_index,
                    (),
                )
                continue
        output.append(clean)
    return output
