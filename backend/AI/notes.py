from __future__ import annotations

import math
import statistics

from .models import PitchFrame, Syllable, VocalNote

NOTE_DECODER_VERSION = "lyric-anchored-lead-v11"


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
    pairs = sorted(zip(values, weights, strict=False),
                   key=lambda item: item[0])
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


def _robust_pitch_center(values: list[float], weights: list[float]) -> float:
    """Return a stable note centre without following vibrato lobes.

    The weighted median is deliberately preferred over a histogram mode: a finite
    window of wide vibrato can spend slightly longer on one lobe and make the mode
    one semitone wrong. Median remains centred while resisting slides/outliers.
    """
    return _weighted_median(values, weights)


def _voiced_runs(
    frames: list[PitchFrame],
    *,
    max_gap: float,
    min_confidence: float,
) -> list[list[PitchFrame]]:
    usable = [
        frame
        for frame in frames
        if frame.voiced and frame.frequency > 0 and frame.confidence >= min_confidence
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
    # Detect periodic oscillation around one pitch centre before looking for steps.
    # This catches wide vibrato that can temporarily resemble two alternating notes.
    global_center = statistics.median(midi)
    signs = []
    for value in midi:
        delta = value - global_center
        signs.append(1 if delta > 0.22 else -1 if delta < -0.22 else 0)
    compact = [value for value in signs if value]
    reversals = sum(a != b for a, b in zip(compact, compact[1:], strict=False))
    ordered = sorted(midi)
    p10 = ordered[max(0, int(len(ordered) * 0.10))]
    p90 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.90))]
    oscillation_span = p90 - p10
    if reversals >= 4 and oscillation_span <= 2.8:
        return [run]
    step = (
        statistics.median(
            [b.time - a.time for a,
                b in zip(run, run[1:], strict=False) if b.time > a.time]
        )
        if len(run) > 1
        else 0.01
    )
    step = max(0.005, min(0.04, float(step)))

    # Require ~70 ms of stable evidence. Short ornaments remain pitch bends;
    # sustained melodic moves become separate notes.
    sustain_frames = max(4, int(round(max(0.065, min_note) / step)))
    history_frames = max(5, int(round(0.09 / step)))
    # Adapt the split threshold to the singer's local vibrato width.
    # Stable voices keep high sensitivity; wide vibrato needs a larger margin.
    local_diffs = [
        abs(value -
            statistics.median(smooth[max(0, i - 8): min(len(smooth), i + 9)]))
        for i, value in enumerate(smooth)
    ]
    vibrato = statistics.median(local_diffs) if local_diffs else 0.0
    threshold = max(0.62, float(split_semitones),
                    min(1.35, vibrato * 3.2 + 0.36))

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
                if (value - baseline) * delta > 0 and abs(value - baseline) >= threshold * 0.65
            )
            # A true note transition has most future frames on the new side of
            # the old center. Symmetric vibrato does not.
            if same_direction >= math.ceil(len(future) * 0.75):
                # Wide/slow vibrato can stay on one side for 70-100 ms. Look
                # farther ahead and reject a transition that clearly returns to
                # the old pitch centre. A real note change normally does not.
                probe_end = min(len(run), index +
                                max(sustain_frames, int(round(0.22 / step))))
                probe = smooth[index:probe_end]
                old_side = sum(
                    1
                    for value in probe
                    if (value - baseline) * delta < 0 and abs(value - baseline) >= threshold * 0.45
                )
                return_ratio = old_side / max(1, len(probe))
                ordered_probe = sorted(probe)
                lo_q = ordered_probe[max(0, int(len(ordered_probe) * 0.10))]
                hi_q = ordered_probe[min(
                    len(ordered_probe) - 1, int(len(ordered_probe) * 0.90))]
                probe_spread = hi_q - lo_q
                stable_new_level = probe_spread <= max(0.48, threshold * 0.72)
                if return_ratio <= 0.18 and stable_new_level:
                    boundary = index
                    left_duration = run[boundary - 1].time - \
                        run[segment_start].time + step
                    right_duration = run[future_end -
                                         1].time - run[boundary].time + step
                    if left_duration >= min_note and right_duration >= min_note:
                        boundaries.append(boundary)
                        segment_start = boundary
                        index = boundary + sustain_frames
                        continue
        index += 1

    boundaries.append(len(run))
    segments = [run[a:b]
                for a, b in zip(boundaries, boundaries[1:], strict=False) if b > a]

    # Merge tiny fragments into the closest neighbour instead of dropping them.
    merged: list[list[PitchFrame]] = []
    for segment in segments:
        duration = segment[-1].time - segment[0].time + step
        if duration >= min_note or not merged:
            merged.append(segment)
            continue
        previous = merged[-1]
        previous_center = statistics.median(
            hz_to_midi(f.frequency) for f in previous)
        center = statistics.median(hz_to_midi(f.frequency) for f in segment)
        if abs(center - previous_center) < 2.0:
            previous.extend(segment)
        else:
            merged.append(segment)
    return merged


def _energy_reattack_boundaries(segment: list[PitchFrame], min_note: float) -> list[int]:
    """Find short energy valleys followed by a clear same-pitch re-attack."""
    if len(segment) < 12:
        return []
    steps = [b.time - a.time for a,
             b in zip(segment, segment[1:], strict=False) if b.time > a.time]
    step = max(0.005, min(0.04, statistics.median(steps) if steps else 0.01))
    min_frames = max(5, int(round(max(0.08, min_note) / step)))
    energies = [max(0.0, f.energy) for f in segment]
    positive = [e for e in energies if e > 0]
    if not positive:
        return []
    typical = statistics.median(positive)
    if typical <= 1e-8:
        return []
    low_threshold = typical * 0.52
    min_low = max(2, int(round(0.018 / step)))
    max_low = max(min_low, int(round(0.11 / step)))
    context = max(3, int(round(0.045 / step)))
    boundaries = []
    i = min_frames
    while i < len(segment) - min_frames:
        if energies[i] > low_threshold:
            i += 1
            continue
        left = i
        while i < len(segment) and energies[i] <= low_threshold:
            i += 1
        right = i
        width = right - left
        if not min_low <= width <= max_low:
            continue
        if left < context or right + context > len(segment):
            continue
        before = statistics.median(energies[left - context: left])
        valley = statistics.median(energies[left:right])
        after = statistics.median(energies[right: right + context])
        if (
            before >= typical * 0.62
            and after >= typical * 0.68
            and valley <= min(before, after) * 0.55
        ):
            boundary = right
            if boundary >= min_frames and len(segment) - boundary >= min_frames:
                boundaries.append(boundary)
    return boundaries


def _split_on_reattacks(segment: list[PitchFrame], min_note: float) -> list[list[PitchFrame]]:
    boundaries = _energy_reattack_boundaries(segment, min_note)
    if not boundaries:
        return [segment]
    edges = [0, *boundaries, len(segment)]
    parts = [
        segment[left:right] for left, right in zip(edges, edges[1:], strict=False) if right > left
    ]
    # Keep only musically useful splits; otherwise return the original segment.
    durations = []
    for part in parts:
        if len(part) > 1:
            step = max(
                0.005,
                min(
                    0.04,
                    statistics.median(
                        [
                            b.time - a.time
                            for a, b in zip(part, part[1:], strict=False)
                            if b.time > a.time
                        ]
                        or [0.01]
                    ),
                ),
            )
        else:
            step = 0.01
        durations.append(part[-1].time - part[0].time + step)
    if any(value < min_note for value in durations):
        return [segment]
    return parts


def _bend_curve(
    segment: list[PitchFrame],
    *,
    start: float,
    base: int,
    duration: float,
) -> tuple[tuple[float, float], ...]:
    if not segment:
        return ()
    midi = _median_filter([hz_to_midi(frame.frequency)
                          for frame in segment], radius=1)
    result: list[tuple[float, float]] = []
    last_time = -1.0
    last_cents: float | None = None
    for index, (frame, value) in enumerate(zip(segment, midi, strict=False)):
        relative = max(0.0, min(duration, frame.time - start))
        cents = max(-199.0, min(199.0, (value - base) * 100.0))
        # MIDI pitch-bend does not need a 100 Hz control stream. Keep changes
        # at ~25 ms resolution unless the bend changed materially.
        if index not in {0, len(segment) - 1} and (
            relative - last_time < 0.025
            and last_cents is not None
            and abs(cents - last_cents) < 12.0
        ):
            continue
        result.append((relative, cents))
        last_time = relative
        last_cents = cents
    return tuple(result)


def _note_from_segment(
    segment: list[PitchFrame],
    syllable: Syllable | None,
    *,
    min_note: float,
) -> VocalNote | None:
    if not segment:
        return None
    step = (
        statistics.median(
            [b.time - a.time for a,
                b in zip(segment, segment[1:], strict=False) if b.time > a.time]
        )
        if len(segment) > 1
        else 0.01
    )
    step = max(0.005, min(0.04, float(step)))
    start = segment[0].time
    end = segment[-1].time + step
    if end - start < min_note:
        return None

    values = [hz_to_midi(frame.frequency) for frame in segment]
    energies = [max(frame.energy, 1e-4) for frame in segment]
    max_energy = max(energies) if energies else 1.0
    weights = [
        max(0.02, frame.confidence) * (0.35 + 0.65 * energy / max_energy)
        for frame, energy in zip(segment, energies, strict=False)
    ]
    center = _robust_pitch_center(values, weights)
    base = max(0, min(127, int(round(center))))
    confidence = sum(frame.confidence for frame in segment) / len(segment)
    velocity = max(42, min(118, int(round(62 + confidence * 48))))
    cents = _bend_curve(segment, start=start, base=base, duration=end - start)
    return VocalNote(
        start,
        end,
        base,
        velocity,
        syllable.word_index if syllable is not None else None,
        syllable.index if syllable is not None else None,
        cents,
    )


def _best_syllable_for_segment(
    segment: list[PitchFrame], syllables: list[Syllable]
) -> Syllable | None:
    if not syllables or not segment:
        return None
    start = segment[0].time
    end = segment[-1].time + 0.01
    midpoint = (start + end) / 2
    overlaps = []
    for syllable in syllables:
        overlap = max(0.0, min(end, syllable.end) - max(start, syllable.start))
        if overlap > 0:
            overlaps.append(
                (overlap, -abs((syllable.start + syllable.end) / 2 - midpoint), syllable)
            )
    if overlaps:
        return max(overlaps, key=lambda item: (item[0], item[1]))[2]
    return min(syllables, key=lambda item: abs((item.start + item.end) / 2 - midpoint))


def _lyric_activity_intervals(
    syllables: list[Syllable],
    *,
    pad: float = 0.035,
    merge_gap: float = 0.11,
) -> list[tuple[float, float]]:
    """Build lead-vocal activity intervals from aligned syllables.

    Nearby syllables are merged, so lyric segmentation can never manufacture
    extra musical notes. Only real phrase-sized gaps remain as cut points.
    """
    if not syllables:
        return []

    raw = [
        (max(0.0, syllable.start - pad), syllable.end + pad)
        for syllable in sorted(syllables, key=lambda item: (item.start, item.end))
    ]
    merged: list[tuple[float, float]] = []
    for start, end in raw:
        if not merged or start - merged[-1][1] > merge_gap:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _clip_note_to_lyric_activity(
    note: VocalNote,
    syllables: list[Syllable],
    *,
    min_note: float,
) -> list[VocalNote]:
    """Clip one pitch-derived note to lyric-active regions.

    This never invents a pitch event. A note is split only when it spans a real
    lyric silence (> ~110 ms), which is where backing vocals/doubles commonly
    leak into a monophonic tracker.
    """
    if not syllables:
        return [note]

    intervals = _lyric_activity_intervals(syllables)
    pieces: list[VocalNote] = []

    for active_start, active_end in intervals:
        start = max(note.start, active_start)
        end = min(note.end, active_end)
        if end - start < min_note:
            continue

        midpoint = (start + end) / 2.0
        overlapping = [
            syllable
            for syllable in syllables
            if min(end, syllable.end) - max(start, syllable.start) > 0
        ]
        syllable = (
            max(
                overlapping,
                key=lambda item: min(end, item.end) - max(start, item.start),
            )
            if overlapping
            else min(
                syllables,
                key=lambda item: abs((item.start + item.end) / 2.0 - midpoint),
            )
        )

        offset = start - note.start
        cents = tuple(
            (time - offset, value)
            for time, value in note.cents
            if offset <= time <= offset + (end - start) + 1e-9
        )
        pieces.append(
            VocalNote(
                start,
                end,
                note.midi_note,
                note.velocity,
                syllable.word_index,
                syllable.index,
                cents,
            )
        )

    return pieces


def build_vocal_notes(
    pitch: list[PitchFrame],
    syllables: list[Syllable],
    min_note: float = 0.055,
    split_semitones: float = 0.78,
    max_gap: float = 0.05,
    min_confidence: float = 0.42,
) -> list[VocalNote]:
    """Decode musical events from pitch, then gate them by lyric activity.

    Pitch alone defines note count and pitch changes. Aligned syllables only
    remove phrase-sized regions where the lead lyric is inactive, preventing
    backing vocals/doubles from causing MIDI drift around chorus transitions.
    """
    frames = sorted(pitch, key=lambda frame: frame.time)
    ordered_syllables = sorted(
        syllables, key=lambda item: (item.start, item.end))
    pitch_notes: list[VocalNote] = []

    runs = _voiced_runs(frames, max_gap=max_gap, min_confidence=min_confidence)
    for run in runs:
        for pitch_segment in _sustained_pitch_segments(
            run, split_semitones=split_semitones, min_note=min_note
        ):
            for segment in _split_on_reattacks(pitch_segment, min_note):
                # Linguistic metadata is deliberately NOT used during event
                # detection; wrong syllable counts must never create notes.
                note = _note_from_segment(segment, None, min_note=min_note)
                if note is not None:
                    pitch_notes.append(note)

    # Lyrics act only as a temporal activity mask after musical decoding.
    output: list[VocalNote] = []
    if ordered_syllables:
        for note in pitch_notes:
            output.extend(
                _clip_note_to_lyric_activity(
                    note,
                    ordered_syllables,
                    min_note=min_note,
                )
            )
    else:
        output = pitch_notes

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

    return _repair_note_outliers(monophonic)


def _repair_note_outliers(notes: list[VocalNote]) -> list[VocalNote]:
    """Repair isolated octave slips and tiny bridge notes after event decoding."""
    if len(notes) < 3:
        return notes
    out = list(notes)
    for i in range(1, len(out) - 1):
        prev, cur, nxt = out[i - 1], out[i], out[i + 1]
        dur = cur.end - cur.start
        if (
            prev.syllable_index == cur.syllable_index == nxt.syllable_index
            and abs(prev.midi_note - nxt.midi_note) <= 1
            and dur < 0.18
        ):
            for shift in (-12, 12):
                candidate = cur.midi_note + shift
                if abs(candidate - prev.midi_note) <= 1 and abs(candidate - nxt.midi_note) <= 1:
                    out[i] = VocalNote(
                        cur.start,
                        cur.end,
                        candidate,
                        cur.velocity,
                        cur.word_index,
                        cur.syllable_index,
                        cur.cents,
                    )
                    break
    return out


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
            if (
                same_unit
                and tiny_gap
                and (
                    clean.midi_note == previous.midi_note
                    or (
                        abs(clean.midi_note - previous.midi_note) == 1
                        and clean.end - clean.start < 0.13
                    )
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
