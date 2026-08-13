from __future__ import annotations

import math
import statistics
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .audio import load_mono
from .models import PitchFrame, Syllable, VocalNote, Word

NOTE_DECODER_VERSION = "acoustic-notes-v31-conservative-register-verifier"
_NOTE_DIAGNOSTICS: ContextVar[dict | None] = ContextVar("note_diagnostics", default=None)


def get_note_diagnostics() -> dict:
    return dict(_NOTE_DIAGNOSTICS.get() or {})


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
    pairs = sorted(zip(values, weights, strict=False), key=lambda item: item[0])
    total = sum(max(0.0, weight) for _, weight in pairs)
    if total <= 1e-12:
        return float(statistics.median(values))
    cursor = 0.0
    midpoint = total / 2.0
    for value, weight in pairs:
        cursor += max(0.0, weight)
        if cursor >= midpoint:
            return float(value)


def _robust_pitch_center(values: list[float], weights: list[float]) -> float:
    """Return the perceived centre of a sung pitch without following vibrato lobes.

    A plain median can land almost one semitone off-centre when a finite note ends
    on one side of a wide vibrato cycle.  For compact, vibrato-sized distributions
    use the midpoint of robust lower/upper quantiles; for wider contours keep the
    weighted median so slides and true transitions are not averaged together.
    """
    if not values:
        raise ValueError("pitch centre requires at least one value")
    array = np.asarray(values, dtype=float)
    q10, q25, q75, q90 = np.percentile(array, [10, 25, 75, 90])
    if float(q90 - q10) <= 2.6:
        return float((q25 + q75) / 2.0)
    return _weighted_median(values, weights)


@dataclass(frozen=True)
class _NoteTimingProfile:
    """Timing tolerances learned from the current pitch/note stream.

    Absolute millisecond constants used to make post-processing behave
    differently on slow and fast material.  The profile instead derives its
    windows from the actual tracker hop, decoded note durations and observed
    inter-note gaps of the current recording.
    """

    frame_step: float
    note_scale: float
    gap_scale: float
    merge_gap: float
    micro_duration: float
    spike_duration: float
    neighbour_radius: float
    phrase_gap: float
    attack_history_frames: int
    attack_future_frames: int
    attack_weak: float
    attack_strong: float


def _robust_frame_step(frames: list[PitchFrame], fallback: float) -> float:
    gaps = [b.time - a.time for a, b in zip(frames, frames[1:], strict=False) if b.time > a.time]
    if not gaps:
        return max(float(fallback), 1e-4)
    # Ignore sparse discontinuities without assuming a specific tracker hop.
    median = float(statistics.median(gaps))
    compact = [gap for gap in gaps if gap <= median * 3.0]
    return max(float(statistics.median(compact or gaps)), 1e-4)


def _note_timing_profile(
    frames: list[PitchFrame],
    notes: list[VocalNote],
    *,
    min_note_hint: float,
) -> _NoteTimingProfile:
    hint = max(float(min_note_hint), 1e-4)
    step = _robust_frame_step(frames, hint / 6.0)

    durations = sorted(note.end - note.start for note in notes if note.end > note.start + step)
    note_scale = float(statistics.median(durations)) if durations else max(hint, step * 6.0)
    note_scale = max(note_scale, step * 4.0)

    gaps = sorted(
        right.start - left.end
        for left, right in zip(notes, notes[1:], strict=False)
        if 0.0 < right.start - left.end <= note_scale
    )
    gap_scale = float(statistics.median(gaps)) if gaps else step * 3.0
    gap_scale = max(step, gap_scale)

    # All windows below are relative to measured properties of this recording.
    # Ratios describe intent (micro-fragment, local neighbourhood, phrase gap);
    # no song-specific wall-clock timestamp can pin a particular section.
    merge_gap = max(step * 2.5, min(note_scale * 0.18, gap_scale * 1.25))
    micro_duration = max(step * 5.0, note_scale * 0.30)
    spike_duration = max(step * 7.0, note_scale * 0.38)
    neighbour_radius = max(note_scale * 0.65, gap_scale * 2.5)
    phrase_gap = max(note_scale * 0.50, gap_scale * 2.0)
    history_frames = max(3, int(round(note_scale * 0.14 / step)))
    future_frames = max(2, int(round(note_scale * 0.08 / step)))
    attack_weak, attack_strong = 0.34, 0.38

    return _NoteTimingProfile(
        frame_step=step,
        note_scale=note_scale,
        gap_scale=gap_scale,
        merge_gap=merge_gap,
        micro_duration=micro_duration,
        spike_duration=spike_duration,
        neighbour_radius=neighbour_radius,
        phrase_gap=phrase_gap,
        attack_history_frames=history_frames,
        attack_future_frames=future_frames,
        attack_weak=attack_weak,
        attack_strong=attack_strong,
    )


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
    """Decode stable MIDI states instead of threshold-splitting every wobble.

    Singing pitch is continuous: vibrato and portamento routinely cross a
    semitone rounding boundary without a new note attack.  The old splitter
    created a new MIDI event as soon as a local median moved ~0.8 semitone,
    which over-segmented choruses badly.  This decoder uses hysteresis over the
    whole voiced run. A new pitch centre must win for a sustained interval, or
    have strong re-attack evidence, before it becomes a new MIDI note.
    """
    if len(run) < 2:
        return [run] if run else []

    observed = _median_filter([hz_to_midi(frame.frequency) for frame in run], radius=2)
    gaps = [
        b.time - a.time for a, b in zip(run, run[1:], strict=False) if 0 < b.time - a.time <= 0.08
    ]
    step = max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))
    min_frames = max(4, int(math.ceil(min_note / step)))
    normal_confirmation = max(min_note * 1.5, step * 8.0)
    fast_confirmation = max(min_note, step * 5.0)
    # A note centre follows the median of the current accepted segment.  A
    # challenger has to remain separated from it for long enough.  This is much
    # less sensitive to vibrato than repeatedly comparing two short windows.
    # These are normalized attack-strength thresholds, not wall-clock song
    # constants. Regression coverage confirms they separate true re-attacks from
    # wide vibrato; keep them calibrated while exposing their distribution in
    # diagnostics instead of adapting them per phrase.
    weak_attack, strong_attack = 0.45, 0.55
    boundaries = [0]
    segment_start = 0
    i = min_frames
    while i < len(run):
        history = observed[segment_start:i]
        center = statistics.median(history)
        delta_now = observed[i] - center

        # Normal vibrato/portamento remains pitch bend inside one note.  Large
        # changes need slightly less separation because harmonic stabilization
        # has already removed most isolated octave errors.
        threshold = max(0.95, float(split_semitones) + 0.12)
        if abs(delta_now) < threshold:
            i += 1
            continue

        attack = _local_frame_attack_strength(run, i)
        separation = abs(delta_now) / max(threshold, 1e-6)
        if attack >= strong_attack:
            confirmation = fast_confirmation
        elif separation >= 1.8:
            # A stable jump far beyond the vibrato band needs less temporal
            # proof than a near-threshold move. This lets fast melodies survive
            # without weakening the wide-vibrato guard.
            confirmation = max(min_note, normal_confirmation * 0.75)
        else:
            confirmation = normal_confirmation
        needed = max(min_frames, int(math.ceil(confirmation / step)))
        if i + needed > len(run):
            break
        # Never manufacture a tail note from the last lobe of a vibrato.  When
        # there is no acoustic re-attack, require enough remaining audio to prove
        # that the new pitch is a sustained destination rather than an unfinished
        # oscillation at end-of-phrase.
        tail_factor = 1.5 if separation >= 1.8 else 2.0
        tail_evidence = max(normal_confirmation * tail_factor, min_note * 2.0)
        if attack < weak_attack and len(run) - i < max(
            needed, int(math.ceil(tail_evidence / step))
        ):
            break
        future = observed[i : i + needed]
        new_center = statistics.median(future)
        delta = new_center - center
        if abs(delta) < threshold:
            i += 1
            continue

        # Most frames must consistently support the new side.  A glissando that
        # merely passes through another semitone therefore stays one bent note.
        supporters = [
            value
            for value in future
            if (value - center) * delta > 0 and abs(value - center) >= threshold * 0.82
        ]
        if len(supporters) < math.ceil(needed * 0.82):
            i += 1
            continue

        # Wide vibrato can remain beyond a semitone for 70-120 ms and used to
        # satisfy the short confirmation window.  A real note transition stays
        # near the destination; vibrato returns through the old centre.  Inspect
        # a longer look-ahead before accepting a boundary.
        lookahead_duration = max(normal_confirmation * 3.0, min_note * 3.5)
        lookahead_frames = max(needed, int(math.ceil(lookahead_duration / step)))
        lookahead = observed[i : min(len(observed), i + lookahead_frames)]
        if len(lookahead) >= needed + 2:
            return_band = max(0.48, threshold * 0.62)
            returns_to_old = sum(abs(value - center) <= return_band for value in lookahead)
            destination = statistics.median(future)
            stays_near_destination = sum(
                abs(value - destination) <= max(0.62, threshold * 0.72) for value in lookahead
            )
            if returns_to_old >= max(
                2, int(math.ceil(len(lookahead) * 0.16))
            ) and stays_near_destination < int(math.ceil(len(lookahead) * 0.70)):
                i += 1
                continue

        # Require a reasonably stable destination. Wide sweeps are represented
        # with pitch bend and do not manufacture a staircase of MIDI notes.
        spread = float(np.percentile(future, 90) - np.percentile(future, 10))
        allowed_spread = 1.45 if abs(delta) >= 5.0 else 0.82
        if spread > allowed_spread:
            i += 1
            continue

        boundaries.append(i)
        segment_start = i
        i += needed

    boundaries.append(len(run))
    segments = [
        run[left:right]
        for left, right in zip(boundaries, boundaries[1:], strict=False)
        if right > left
    ]

    return segments


def _local_frame_attack_strength(run: list[PitchFrame], index: int) -> float:
    """0..1 attack estimate for pitch-state confirmation."""
    if index <= 0 or index >= len(run):
        return 0.0
    before = [max(0.0, run[i].energy) for i in range(max(0, index - 6), index)]
    after = [max(0.0, run[i].energy) for i in range(index, min(len(run), index + 4))]
    baseline = statistics.median(before)
    current = max(after)
    if baseline <= 1e-8:
        return 1.0 if current > 1e-5 else 0.0
    ratio = current / baseline
    return max(0.0, min(1.0, (ratio - 1.25) / 0.90))


def _energy_reattack_boundaries(segment: list[PitchFrame], min_note: float) -> list[int]:
    """Find short energy valleys followed by a clear same-pitch re-attack."""
    if len(segment) < 12:
        return []
    steps = [b.time - a.time for a, b in zip(segment, segment[1:], strict=False) if b.time > a.time]
    step = max(0.005, min(0.04, statistics.median(steps) if steps else 0.01))
    min_frames = max(5, int(round(max(min_note, step * 5.0) / step)))
    energies = [max(0.0, f.energy) for f in segment]
    positive = [e for e in energies if e > 0]
    if not positive:
        return []
    typical = statistics.median(positive)
    if typical <= 1e-8:
        return []
    low_threshold = typical * 0.52
    min_low = max(2, int(round(max(step * 2.0, min_note * 0.25) / step)))
    max_low = max(min_low, int(round(max(step * 4.0, min_note * 1.8) / step)))
    context = max(3, int(round(max(step * 3.0, min_note * 0.75) / step)))
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
        before = statistics.median(energies[left - context : left])
        valley = statistics.median(energies[left:right])
        after = statistics.median(energies[right : right + context])
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
    midi = _median_filter([hz_to_midi(frame.frequency) for frame in segment], radius=1)
    result: list[tuple[float, float]] = []
    last_time = -1.0
    last_cents: float | None = None
    for index, (frame, value) in enumerate(zip(segment, midi, strict=False)):
        relative = max(0.0, min(duration, frame.time - start))
        cents = max(-199.0, min(199.0, (value - base) * 100.0))
        # MIDI pitch-bend does not need a 100 Hz control stream. Keep changes
        # at ~25 ms resolution unless the bend changed materially.
        if index not in {0, len(segment) - 1} and (
            relative - last_time
            < max(
                duration / max(12, len(segment)),
                _robust_frame_step(segment, duration / max(1, len(segment))) * 2.0,
            )
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
            [b.time - a.time for a, b in zip(segment, segment[1:], strict=False) if b.time > a.time]
        )
        if len(segment) > 1
        else max(min_note / 6.0, 1e-4)
    )
    step = max(float(step), 1e-4)
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


def _decode_pitch_only(
    frames: list[PitchFrame],
    *,
    min_note: float,
    split_semitones: float,
    max_gap: float,
    min_confidence: float,
) -> list[VocalNote]:
    """Decode the acoustic contour first; lyrics never manufacture boundaries."""
    output: list[VocalNote] = []
    for run in _voiced_runs(frames, max_gap=max_gap, min_confidence=min_confidence):
        for pitch_segment in _sustained_pitch_segments(
            run, split_semitones=split_semitones, min_note=min_note
        ):
            for segment in _split_on_reattacks(pitch_segment, min_note):
                note = _note_from_segment(segment, None, min_note=min_note)
                if note is not None:
                    output.append(note)
    return sorted(output, key=lambda note: (note.start, note.end, note.midi_note))


def _attach_soft_lyric_labels(notes: list[VocalNote], syllables: list[Syllable]) -> list[VocalNote]:
    """Attach the best lyric label without changing note timing or pitch.

    The proximity tolerance is derived from the local note/syllable timing
    instead of a fixed millisecond allowance, so fast and slow songs are treated
    proportionally.
    """
    if not syllables:
        return notes
    note_durations = sorted(note.end - note.start for note in notes if note.end > note.start)
    syllable_durations = sorted(
        syllable.end - syllable.start for syllable in syllables if syllable.end > syllable.start
    )
    note_scale = statistics.median(note_durations) if note_durations else 0.0
    syllable_scale = statistics.median(syllable_durations) if syllable_durations else note_scale
    proximity = (
        max(1e-4, min(value for value in (note_scale * 0.35, syllable_scale * 0.30) if value > 0.0))
        if (note_scale > 0.0 or syllable_scale > 0.0)
        else 1e-4
    )

    result: list[VocalNote] = []
    for note in notes:
        midpoint = (note.start + note.end) / 2.0
        overlaps = [
            (
                max(0.0, min(note.end, syllable.end) - max(note.start, syllable.start)),
                -abs(midpoint - (syllable.start + syllable.end) / 2.0),
                syllable,
            )
            for syllable in syllables
        ]
        overlap, _, owner = max(overlaps, key=lambda item: (item[0], item[1]))
        distance = min(abs(note.end - owner.start), abs(note.start - owner.end))
        if overlap <= 0 and distance > proximity:
            result.append(note)
            continue
        result.append(
            VocalNote(
                note.start,
                note.end,
                note.midi_note,
                note.velocity,
                owner.word_index,
                owner.index,
                note.cents,
            )
        )
    return result


def _word_activity_intervals(
    words: list[Word],
    *,
    pad: float = 0.09,
    merge_gap: float = 0.18,
) -> list[tuple[float, float]]:
    """Build phrase activity from forced-aligned WORDS, not synthetic syllables."""
    if not words:
        return []
    raw = [
        (max(0.0, word.start - pad), word.end + pad)
        for word in sorted(words, key=lambda item: (item.start, item.end))
    ]
    merged: list[tuple[float, float]] = []
    for start, end in raw:
        if not merged or start - merged[-1][1] > merge_gap:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _adaptive_lyric_timing(
    words: list[Word], syllables: list[Syllable], min_note: float
) -> tuple[float, float, float]:
    spans = [
        max(0.0, item.end - item.start) for item in (words or syllables) if item.end > item.start
    ]
    gaps = [
        b.start - a.end
        for a, b in zip((words or syllables), (words or syllables)[1:], strict=False)
        if b.start - a.end > 0
    ]
    typical = float(statistics.median(spans)) if spans else max(min_note * 4.0, 0.20)
    gap = float(statistics.median(gaps)) if gaps else max(min_note, typical * 0.18)
    pad = max(min_note * 0.55, min(typical * 0.16, gap * 0.75))
    merge = max(pad * 1.5, min(typical * 0.38, gap * 1.35))
    nearest = max(min_note * 0.65, min(pad, typical * 0.18))
    return pad, merge, nearest


def _filter_to_lyric_phrases(
    notes: list[VocalNote],
    syllables: list[Syllable],
    *,
    min_note: float,
    words: list[Word] | None = None,
) -> list[VocalNote]:
    """Use lyrics only as a soft phrase-activity mask.

    Individual syllable boundaries are approximate, so they must never cut an
    acoustic note.  We only reject notes wholly outside lyric-active phrases.
    Notes that overlap a phrase keep their original attack/release (with a small
    tolerance) so forced-alignment jitter cannot shorten the MIDI melody.
    """
    if not syllables and not words:
        return notes
    # Forced-aligned word timestamps are acoustic model outputs.  Syllable
    # timestamps are synthesized downstream, so they are only a fallback here.
    pad, merge_gap, nearest_limit = _adaptive_lyric_timing(words or [], syllables, min_note)
    intervals = _word_activity_intervals(
        words or [], pad=pad, merge_gap=merge_gap
    ) or _lyric_activity_intervals(syllables, pad=pad, merge_gap=merge_gap)
    result: list[VocalNote] = []
    for note in notes:
        best_overlap = 0.0
        nearest = float("inf")
        for start, end in intervals:
            best_overlap = max(best_overlap, min(note.end, end) - max(note.start, start))
            if note.end < start:
                nearest = min(nearest, start - note.end)
            elif note.start > end:
                nearest = min(nearest, note.start - end)
            else:
                nearest = 0.0
        if best_overlap > 0 or nearest <= nearest_limit:
            result.append(note)
    return result


def _make_monophonic(notes: list[VocalNote], min_note: float) -> list[VocalNote]:
    ordered = sorted(notes, key=lambda note: (note.start, note.end, note.midi_note))
    output: list[VocalNote] = []
    for note in ordered:
        if not output:
            output.append(note)
            continue
        previous = output[-1]
        if note.start >= previous.end:
            output.append(note)
            continue
        # Pitch-derived segments should rarely overlap.  When they do, split at
        # the midpoint of the competing attacks instead of deleting either note.
        boundary = max(previous.start, min(previous.end, (previous.end + note.start) / 2.0))
        if boundary - previous.start >= min_note:
            output[-1] = VocalNote(
                previous.start,
                boundary,
                previous.midi_note,
                previous.velocity,
                previous.word_index,
                previous.syllable_index,
                tuple(
                    (time, cents)
                    for time, cents in previous.cents
                    if time <= boundary - previous.start + 1e-9
                ),
            )
        elif previous.end - previous.start < note.end - note.start:
            output.pop()
        adjusted_start = max(note.start, output[-1].end if output else note.start)
        if note.end - adjusted_start >= min_note:
            offset = adjusted_start - note.start
            output.append(
                VocalNote(
                    adjusted_start,
                    note.end,
                    note.midi_note,
                    note.velocity,
                    note.word_index,
                    note.syllable_index,
                    tuple(
                        (max(0.0, time - offset), cents)
                        for time, cents in note.cents
                        if time >= offset - 1e-9
                    ),
                )
            )
    return output


def _audio_harmonic_salience(
    magnitude: np.ndarray,
    frame_index: int,
    midi_note: float,
    *,
    sample_rate: int,
    n_fft: int,
) -> float:
    """How well a candidate fundamental explains one vocal-spectrum frame."""
    if frame_index < 0 or frame_index >= magnitude.shape[1]:
        return -12.0
    frequency = 440.0 * 2 ** ((float(midi_note) - 69.0) / 12.0)
    column = magnitude[:, frame_index]
    useful = column[1 : min(len(column), int(5000 * n_fft / sample_rate) + 2)]
    noise = float(np.median(useful)) + 1e-7 if useful.size else 1e-7
    score = 0.0
    fundamental_ratio = 0.0
    for harmonic, weight in enumerate((2.1, 1.35, 1.0, 0.78, 0.60, 0.45, 0.35), start=1):
        target = frequency * harmonic
        if target >= sample_rate / 2 or target > 5000:
            break
        center = int(round(target * n_fft / sample_rate))
        lo = max(1, center - 2)
        hi = min(len(column), center + 3)
        peak = float(np.max(column[lo:hi]))
        ratio = peak / noise
        if harmonic == 1:
            fundamental_ratio = ratio
        score += weight * math.log1p(max(0.0, ratio))
    if fundamental_ratio < 2.0:
        score -= 2.0 - fundamental_ratio
    return score


def _audio_verify_note_register(
    notes: list[VocalNote],
    audio: str | Path | None,
    profile: _NoteTimingProfile,
    *,
    fmin_hz: float,
    fmax_hz: float,
) -> list[VocalNote]:
    """Resolve FCPE octave/harmonic mistakes after note segmentation.

    Dense choruses make frame-level F0 trackers jump between a fundamental and
    its harmonics.  Deciding per frame caused both jitter and destroyed genuine
    short leaps.  Here every already-segmented note is treated as one acoustic
    observation.  FCPE's note, fast YIN and the actual harmonic spectrum vote on
    the register, while a duration/lyric-aware sequence model supplies only a
    weak continuity prior.
    """
    if not notes or audio is None:
        return list(notes)
    try:
        import librosa

        waveform, sample_rate = load_mono(audio, 16_000)
        if waveform.size < 1024:
            return list(notes)
        hop = 160
        yin = librosa.yin(
            waveform,
            fmin=float(fmin_hz),
            fmax=float(min(fmax_hz, sample_rate * 0.45)),
            sr=sample_rate,
            frame_length=1024,
            hop_length=hop,
            center=True,
        )
        n_fft = 2048
        magnitude = np.abs(
            librosa.stft(waveform, n_fft=n_fft, hop_length=hop, win_length=n_fft, center=True)
        ).astype(np.float32, copy=False)
        onset = librosa.onset.onset_strength(
            y=waveform, sr=sample_rate, hop_length=hop, center=True
        ).astype(np.float32, copy=False)
        onset_reference = float(np.percentile(onset, 82)) if onset.size else 0.0
    except Exception:
        return list(notes)

    original = [int(note.midi_note) for note in notes]
    global_center = statistics.median(original)
    q10, q90 = (
        np.percentile(np.asarray(original, dtype=float), [10, 90])
        if len(original) > 2
        else (global_center - 7, global_center + 7)
    )
    observed_span = max(7.0, float(q90 - q10))
    register_margin = max(12.0, min(24.0, observed_span * 1.5))
    register_low = max(0, int(math.floor(global_center - register_margin)))
    register_high = min(127, int(math.ceil(global_center + register_margin)))

    candidate_rows: list[list[int]] = []
    emission_rows: list[list[float]] = []
    yin_centers: list[int] = []
    yin_available: list[bool] = []
    for note in notes:
        start_index = max(0, int(round(note.start * sample_rate / hop)))
        end_index = min(
            len(yin),
            max(start_index + 1, int(round(note.end * sample_rate / hop))),
        )
        yin_values = [
            hz_to_midi(float(yin[index]))
            for index in range(start_index, end_index)
            if np.isfinite(yin[index]) and float(yin[index]) > 0
        ]
        yin_center = (
            int(round(statistics.median(yin_values))) if yin_values else int(note.midi_note)
        )
        yin_centers.append(int(yin_center))
        yin_available.append(bool(yin_values))
        candidates: list[int] = []
        # FCPE octave/third-harmonic mistakes show up very clearly on dense
        # choruses.  Consider only musically meaningful harmonic alternatives
        # plus the independent YIN estimate; the sequence decoder below still
        # requires actual audio support before rewriting a note.
        for shift in (-24, -19, -12, 0, 12, 19, 24):
            value = int(note.midi_note + shift)
            if register_low <= value <= register_high and value not in candidates:
                candidates.append(value)
        for value in (yin_center, yin_center - 12, yin_center + 12):
            value = int(value)
            if register_low <= value <= register_high and value not in candidates:
                candidates.append(value)
        if not candidates:
            candidates = [int(note.midi_note)]

        duration = max(profile.frame_step, note.end - note.start)
        target_spacing = max(profile.frame_step * 3.0, duration / 10.0)
        sample_count = max(3, min(10, int(duration / target_spacing) + 1))
        left = note.start + duration * 0.12
        right = max(left, note.end - duration * 0.08)
        sample_times = np.linspace(left, right, sample_count)

        emissions: list[float] = []
        for candidate in candidates:
            spectral_values = [
                _audio_harmonic_salience(
                    magnitude,
                    min(magnitude.shape[1] - 1, max(0, int(round(time * sample_rate / hop)))),
                    candidate,
                    sample_rate=sample_rate,
                    n_fft=n_fft,
                )
                for time in sample_times
            ]
            spectral = float(statistics.median(spectral_values)) if spectral_values else -12.0
            # Long stable FCPE notes require stronger acoustic evidence before an
            # octave rewrite. Short fragments, which are the common chorus error,
            # are easier to correct.
            relative_duration = duration / max(profile.note_scale, profile.frame_step)
            if candidate == note.midi_note:
                source_prior = 0.38 + min(0.75, relative_duration * 0.45)
            else:
                # Rewrites are allowed, but never for free. The prior scales
                # with this recording's typical note duration, not wall-clock
                # seconds learned from a particular test track.
                source_prior = -(0.18 + min(0.65, relative_duration * 0.25))
            yin_support = (
                1.15 * math.exp(-0.5 * ((candidate - yin_center) / 0.75) ** 2)
                if yin_values
                else 0.0
            )
            emissions.append(spectral * 0.72 + source_prior + yin_support)
        candidate_rows.append(candidates)
        emission_rows.append(emissions)

    def _is_strong_attack(note_index: int) -> bool:
        if note_index <= 0 or not len(onset) or onset_reference <= 0:
            return False
        current_note = notes[note_index]
        onset_index = min(
            len(onset) - 1,
            max(0, int(round(current_note.start * sample_rate / hop))),
        )
        return float(onset[onset_index]) >= onset_reference

    # IMPORTANT: never carry register-state through the whole song. In dense
    # choruses one wrong octave can otherwise become the preferred predecessor
    # for dozens of following notes. Decode short acoustic phrases independently.
    groups: list[tuple[int, int]] = []
    group_start = 0
    for index in range(1, len(notes)):
        gap = notes[index].start - notes[index - 1].end
        span = notes[index].start - notes[group_start].start
        strong_attack = _is_strong_attack(index)
        reset = (
            gap >= profile.phrase_gap
            or (span >= profile.note_scale * 3.0 and strong_attack)
            or span >= profile.note_scale * 8.0
        )
        if reset:
            groups.append((group_start, index))
            group_start = index
    groups.append((group_start, len(notes)))

    selected_states = [0] * len(notes)
    for group_lo, group_hi in groups:
        local_scores: list[list[float]] = [list(emission_rows[group_lo])]
        local_back: list[list[int]] = [[-1] * len(candidate_rows[group_lo])]
        for index in range(group_lo + 1, group_hi):
            previous_note = notes[index - 1]
            current_note = notes[index]
            gap = current_note.start - previous_note.end
            strong_attack = _is_strong_attack(index)
            if strong_attack:
                transition_scale = 0.18
            elif gap > max(profile.merge_gap, profile.gap_scale * 1.2):
                transition_scale = 0.48
            else:
                transition_scale = 1.0

            row_scores: list[float] = []
            row_back: list[int] = []
            for current_state, current_pitch in enumerate(candidate_rows[index]):
                best_score = -float("inf")
                best_previous = 0
                for previous_state, previous_pitch in enumerate(candidate_rows[index - 1]):
                    delta = abs(current_pitch - previous_pitch)
                    transition = 0.07 * min(delta, 2) + 0.34 * max(0, delta - 2)
                    if not strong_attack and any(
                        abs(delta - harmonic) <= 1.1 for harmonic in (12, 19, 24)
                    ):
                        transition += 1.45
                    value = local_scores[-1][previous_state] - transition * transition_scale
                    if value > best_score:
                        best_score = value
                        best_previous = previous_state
                row_scores.append(best_score + emission_rows[index][current_state])
                row_back.append(best_previous)
            local_scores.append(row_scores)
            local_back.append(row_back)

        local_state = max(
            range(len(local_scores[-1])),
            key=lambda item: local_scores[-1][item],
        )
        local_states = [local_state]
        for local_index in range(len(local_scores) - 1, 0, -1):
            local_state = local_back[local_index][local_state]
            local_states.append(local_state)
        local_states.reverse()
        for offset, state in enumerate(local_states):
            selected_states[group_lo + offset] = state

    # Viterbi continuity is only a proposal.  A register rewrite, especially an
    # octave/third-harmonic rewrite, must also win on independent local evidence.
    # This prevents one attractive harmonic state from changing dozens of notes.
    verified: list[VocalNote] = []
    accepted_changes: list[dict[str, object]] = []
    rejected_changes: list[dict[str, object]] = []

    for index, note in enumerate(notes):
        proposed = int(candidate_rows[index][selected_states[index]])
        chosen = proposed
        if proposed != int(note.midi_note):
            delta = abs(proposed - int(note.midi_note))
            original_state = (
                candidate_rows[index].index(int(note.midi_note))
                if int(note.midi_note) in candidate_rows[index]
                else None
            )
            selected_state = selected_states[index]
            selected_emission = float(emission_rows[index][selected_state])
            original_emission = (
                float(emission_rows[index][original_state])
                if original_state is not None
                else selected_emission
            )
            emission_margin = selected_emission - original_emission
            yin_center = int(yin_centers[index])
            has_yin = bool(yin_available[index])
            candidate_yin_distance = abs(proposed - yin_center)
            original_yin_distance = abs(int(note.midi_note) - yin_center)
            strong_attack = _is_strong_attack(index)

            # Required evidence scales with the size of the rewrite.  Octave and
            # double-octave corrections need an independent YIN vote and a clear
            # emission win; small local corrections remain possible with less.
            if delta >= 19:
                required_margin = 1.75
            elif delta >= 12:
                required_margin = 1.20
            elif delta >= 7:
                required_margin = 0.85
            else:
                required_margin = 0.45
            if strong_attack:
                required_margin += 0.30

            yin_supports_rewrite = (
                has_yin
                and candidate_yin_distance <= 1.5
                and original_yin_distance >= max(3.0, min(6.0, delta * 0.35))
            )
            if delta >= 12:
                accept = yin_supports_rewrite and emission_margin >= required_margin
            else:
                accept = emission_margin >= required_margin and (
                    yin_supports_rewrite
                    or not has_yin
                    or candidate_yin_distance <= original_yin_distance
                )

            decision = {
                "index": index,
                "start": round(note.start, 4),
                "end": round(note.end, 4),
                "original_midi": int(note.midi_note),
                "proposed_midi": proposed,
                "semitone_delta": proposed - int(note.midi_note),
                "emission_margin": round(emission_margin, 4),
                "yin_center_midi": yin_center if has_yin else None,
                "candidate_yin_distance": round(candidate_yin_distance, 3) if has_yin else None,
                "original_yin_distance": round(original_yin_distance, 3) if has_yin else None,
                "strong_attack": bool(strong_attack),
                "required_margin": round(required_margin, 3),
            }
            if accept:
                accepted_changes.append({**decision, "reason": "independent_audio_evidence"})
            else:
                chosen = int(note.midi_note)
                rejected_changes.append({**decision, "reason": "insufficient_independent_evidence"})

        cents = note.cents if chosen == note.midi_note else ()
        verified.append(
            VocalNote(
                note.start,
                note.end,
                chosen,
                note.velocity,
                note.word_index,
                note.syllable_index,
                cents,
            )
        )

    changed = []
    for idx, (before, after) in enumerate(zip(notes, verified, strict=False)):
        if before.midi_note != after.midi_note:
            changed.append(
                {
                    "index": idx,
                    "start": round(before.start, 4),
                    "end": round(before.end, 4),
                    "original_midi": before.midi_note,
                    "verified_midi": after.midi_note,
                    "semitone_delta": after.midi_note - before.midi_note,
                    "reason": "audio_register_verification",
                }
            )

    def _bucket(delta: int) -> str:
        value = abs(int(delta))
        if value >= 19:
            return "harmonic_19_plus"
        if value >= 12:
            return "octave_12_plus"
        if value >= 7:
            return "large_7_11"
        if value >= 3:
            return "medium_3_6"
        return "small_1_2"

    accepted_buckets: dict[str, int] = {}
    rejected_buckets: dict[str, int] = {}
    for item in accepted_changes:
        key = _bucket(int(item["semitone_delta"]))
        accepted_buckets[key] = accepted_buckets.get(key, 0) + 1
    for item in rejected_changes:
        key = _bucket(int(item["semitone_delta"]))
        rejected_buckets[key] = rejected_buckets.get(key, 0) + 1

    diag = dict(_NOTE_DIAGNOSTICS.get() or {})
    diag["register_verification"] = {
        "checked_notes": len(notes),
        "changed_notes": len(changed),
        "accepted_proposals": len(accepted_changes),
        "rejected_proposals": len(rejected_changes),
        "accepted_buckets": accepted_buckets,
        "rejected_buckets": rejected_buckets,
        "changes": changed[:200],
        "accepted_details": accepted_changes[:200],
        "rejected_details": rejected_changes[:200],
        "fmin_hz": float(fmin_hz),
        "fmax_hz": float(fmax_hz),
    }
    _NOTE_DIAGNOSTICS.set(diag)
    return verified


def _repair_isolated_harmonic_notes(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    """Repair only strongly isolated harmonic-register mistakes.

    This is deliberately local and attack-aware. It cannot establish a new
    long-term register and therefore cannot create the cumulative drift that a
    song-wide sequence model can. Genuine leaps with a re-attack or a phrase
    gap are preserved.
    """
    if len(notes) < 3:
        return list(notes)
    work = list(notes)
    harmonic_shifts = (-24, -19, -12, 12, 19, 24)
    for index in range(1, len(work) - 1):
        left, current, right = work[index - 1], work[index], work[index + 1]
        left_gap = current.start - left.end
        right_gap = right.start - current.end
        if left_gap > profile.phrase_gap or right_gap > profile.phrase_gap:
            continue
        if _pitch_attack_strength(frames, current.start, profile) >= profile.attack_strong:
            continue
        # Only trust the neighbourhood when both sides agree on one register.
        if abs(left.midi_note - right.midi_note) > 5:
            continue
        target = (left.midi_note + right.midi_note) / 2.0
        original_distance = abs(current.midi_note - target)
        if original_distance < 7.5:
            continue
        candidates = [current.midi_note + shift for shift in harmonic_shifts]
        candidate = min(candidates, key=lambda value: abs(value - target))
        candidate_distance = abs(candidate - target)
        improvement = original_distance - candidate_distance
        duration = current.end - current.start
        neighbourhood_spread = abs(left.midi_note - right.midi_note)
        allowed_distance = max(2.5, min(5.0, neighbourhood_spread + 3.0))
        required_improvement = max(4.0, original_distance * 0.55)
        if candidate_distance > allowed_distance or improvement < required_improvement:
            continue
        # Long notes require an exceptionally clear local-register consensus.
        long_note = profile.note_scale * 1.35
        very_long_note = profile.note_scale * 2.4
        if duration > long_note and not (duration <= very_long_note and candidate_distance <= 3.0):
            continue
        work[index] = VocalNote(
            current.start,
            current.end,
            int(round(candidate)),
            current.velocity,
            current.word_index,
            current.syllable_index,
            (),
        )
    return work


def _merge_verified_fragments(
    notes: list[VocalNote],
    frames: list[PitchFrame] | None,
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    """Merge register-repair fragments without deleting real same-pitch attacks."""
    if not notes:
        return []
    output = [notes[0]]
    for note in notes[1:]:
        previous = output[-1]
        same_pitch = note.midi_note == previous.midi_note
        same_unit = (
            note.word_index == previous.word_index
            and note.syllable_index == previous.syllable_index
        )
        attack = _pitch_attack_strength(frames or [], note.start, profile)
        if (
            same_pitch
            and same_unit
            and 0.0 <= note.start - previous.end <= profile.merge_gap
            and attack < profile.attack_weak
        ):
            output[-1] = VocalNote(
                previous.start,
                max(previous.end, note.end),
                previous.midi_note,
                max(previous.velocity, note.velocity),
                previous.word_index,
                previous.syllable_index,
                (),
            )
        else:
            output.append(note)
    return output


def build_vocal_notes(
    pitch: list[PitchFrame],
    syllables: list[Syllable],
    min_note: float = 0.055,
    split_semitones: float = 0.78,
    max_gap: float = 0.05,
    min_confidence: float = 0.42,
    words: list[Word] | None = None,
    audio: str | Path | None = None,
    activity_segments: list[tuple[float, float, str]]
    | tuple[tuple[float, float, str], ...]
    | None = None,
    fmin_hz: float = 55.0,
    fmax_hz: float = 1400.0,
) -> list[VocalNote]:
    """Build MIDI from the acoustic pitch contour, with lyrics as soft context.

    Crucially, approximate syllable timestamps never create or cut notes.  Pitch
    determines attacks, releases and melismas.  Lyrics only suppress pitch events
    far outside aligned vocal phrases and supply word/syllable labels afterwards.
    """
    _NOTE_DIAGNOSTICS.set({})
    frames = sorted(pitch, key=lambda frame: frame.time)
    ordered_syllables = sorted(syllables, key=lambda item: (item.start, item.end))
    # Lyrics/alignment are metadata only.  Even synchronized LRC lines are not
    # precise enough to gate note extraction: intros, pickups, melismas and
    # line-level offsets can otherwise delete valid acoustic melody. Decode the
    # complete pitch contour and attach text only after note events exist.
    notes = _decode_pitch_only(
        frames,
        min_note=min_note,
        split_semitones=split_semitones,
        max_gap=max_gap,
        min_confidence=min_confidence,
    )
    # Reverb, echo and backing-vocal leakage can remain pitched after source
    # separation. Keep complete acoustic notes around aligned word phrases, but
    # discard isolated pitch islands in instrumental gaps. The soft mask never
    # cuts a note or invents timing/pitch, and its adaptive padding preserves
    # pickups and releases around imperfect forced-alignment boundaries.
    notes = _filter_to_lyric_phrases(
        notes,
        ordered_syllables,
        min_note=min_note,
        words=words,
    )
    if ordered_syllables:
        notes = _attach_soft_lyric_labels(notes, ordered_syllables)
    notes = _make_monophonic(notes, min_note)
    timing = _note_timing_profile(frames, notes, min_note_hint=min_note)
    notes = _audio_verify_note_register(notes, audio, timing, fmin_hz=fmin_hz, fmax_hz=fmax_hz)
    notes = _repair_isolated_harmonic_notes(notes, frames, timing)
    notes = _merge_verified_fragments(notes, frames, timing)
    notes = _consolidate_micro_fragments(notes, frames, timing)
    # Do not run a second octave/harmonic repair pass here.  A second pass can
    # undo the audio-verified register chosen above and makes the decoder
    # order-dependent.
    notes = _repair_short_isolated_spikes(notes, frames, timing)
    notes = _merge_same_pitch_gaps(notes, frames, timing)
    notes = _repair_note_outliers(notes)
    diag = dict(_NOTE_DIAGNOSTICS.get() or {})
    diag["timing_profile"] = {
        "frame_step": timing.frame_step,
        "note_scale": timing.note_scale,
        "gap_scale": timing.gap_scale,
        "merge_gap": timing.merge_gap,
        "attack_weak": timing.attack_weak,
        "attack_strong": timing.attack_strong,
    }
    _NOTE_DIAGNOSTICS.set(diag)
    return notes


def _pitch_attack_strength(
    frames: list[PitchFrame],
    timestamp: float,
    profile: _NoteTimingProfile | None = None,
) -> float:
    """Estimate a local vocal re-attack around a note boundary from RMS energy."""
    if not frames:
        return 0.0
    times = [frame.time for frame in frames]
    import bisect

    index = bisect.bisect_left(times, timestamp)
    if profile is None:
        step = _robust_frame_step(frames, 1e-2)
        scale = max(step * 6.0, step)
        history_count = max(3, int(round(scale * 0.7 / step)))
        future_count = max(2, int(round(scale * 0.4 / step)))
    else:
        history_count = profile.attack_history_frames
        future_count = profile.attack_future_frames
    history = [max(0.0, frames[i].energy) for i in range(max(0, index - history_count), index)]
    future = [
        max(0.0, frames[i].energy) for i in range(index, min(len(frames), index + future_count))
    ]
    if not history or not future:
        return 0.0
    baseline = statistics.median(history)
    current = max(future)
    if baseline <= 1e-8:
        return 1.0 if current > 1e-5 else 0.0
    ratio = current / baseline
    return max(0.0, min(1.0, (ratio - 1.22) / 0.88))


def _consolidate_micro_fragments(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    """Collapse vibrato/quantization fragments without erasing real attacks.

    Adjacent semitone toggles are common when a continuous sung note vibrates
    around the rounding boundary.  A short fragment is merged only when there
    is no acoustic re-attack and both events carry the same lyric label.
    """
    if len(notes) < 2:
        return list(notes)
    work = list(notes)

    # First remove short A-B-A excursions when the surrounding note agrees.
    index = 1
    while index < len(work) - 1:
        left, middle, right = work[index - 1], work[index], work[index + 1]
        middle_duration = middle.end - middle.start
        same_outer = abs(left.midi_note - right.midi_note) <= 0
        same_unit = (
            left.word_index == middle.word_index == right.word_index
            and left.syllable_index == middle.syllable_index == right.syllable_index
        )
        close = (
            middle.start - left.end <= profile.merge_gap
            and right.start - middle.end <= profile.merge_gap
        )
        if (
            same_outer
            and same_unit
            and close
            and middle_duration <= profile.micro_duration
            and abs(middle.midi_note - left.midi_note) <= 2
            and _pitch_attack_strength(frames, middle.start, profile) < profile.attack_weak
        ):
            work[index - 1 : index + 2] = [
                VocalNote(
                    left.start,
                    right.end,
                    left.midi_note,
                    max(left.velocity, middle.velocity, right.velocity),
                    left.word_index,
                    left.syllable_index,
                    (),
                )
            ]
            index = max(1, index - 1)
            continue
        index += 1

    output: list[VocalNote] = []
    for note in work:
        if not output:
            output.append(note)
            continue
        previous = output[-1]
        gap = note.start - previous.end
        same_unit = (
            note.word_index == previous.word_index
            and note.syllable_index == previous.syllable_index
        )
        delta = abs(note.midi_note - previous.midi_note)
        short_side = (
            min(note.end - note.start, previous.end - previous.start) <= profile.micro_duration
        )
        no_attack = _pitch_attack_strength(frames, note.start, profile) < profile.attack_weak
        should_merge = (
            gap <= profile.merge_gap
            and same_unit
            and no_attack
            and (delta == 0 or (delta == 1 and short_side))
        )
        if not should_merge:
            output.append(note)
            continue
        if delta == 0:
            base = previous.midi_note
        else:
            left_duration = previous.end - previous.start
            right_duration = note.end - note.start
            base = previous.midi_note if left_duration >= right_duration else note.midi_note
        output[-1] = VocalNote(
            previous.start,
            max(previous.end, note.end),
            base,
            max(previous.velocity, note.velocity),
            previous.word_index,
            previous.syllable_index,
            (),
        )
    return output


def _repair_short_isolated_spikes(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    """Repair a short pitch spike only when nearby notes form a tight cluster."""
    if len(notes) < 3:
        return list(notes)
    work = list(notes)
    for i in range(1, len(work) - 1):
        mid = work[i]
        if (
            mid.end - mid.start > profile.spike_duration
            or _pitch_attack_strength(frames, mid.start, profile) >= 0.32
        ):
            continue
        neighbours = []
        for j in range(max(0, i - 2), min(len(work), i + 3)):
            if j == i:
                continue
            candidate = work[j]
            if (
                candidate.end < mid.start - profile.neighbour_radius
                or candidate.start > mid.end + profile.neighbour_radius
            ):
                continue
            neighbours.append(candidate.midi_note)
        if len(neighbours) < 2:
            continue
        target = int(round(statistics.median(neighbours)))
        tight = sum(abs(value - target) <= 2 for value in neighbours) >= max(2, len(neighbours) - 1)
        if tight and abs(mid.midi_note - target) >= 5:
            work[i] = VocalNote(
                mid.start,
                mid.end,
                target,
                mid.velocity,
                mid.word_index,
                mid.syllable_index,
                (),
            )
    return work


def _merge_same_pitch_gaps(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    if not notes:
        return []
    output = [notes[0]]
    for note in notes[1:]:
        prev = output[-1]
        gap = note.start - prev.end
        if (
            note.midi_note == prev.midi_note
            and 0 <= gap <= max(profile.merge_gap, profile.gap_scale * 1.5)
            and _pitch_attack_strength(frames, note.start, profile) < 0.28
        ):
            output[-1] = VocalNote(
                prev.start,
                note.end,
                prev.midi_note,
                max(prev.velocity, note.velocity),
                prev.word_index if prev.word_index == note.word_index else None,
                prev.syllable_index if prev.syllable_index == note.syllable_index else None,
                (),
            )
        else:
            output.append(note)
    return output


def _repair_note_outliers(notes: list[VocalNote]) -> list[VocalNote]:
    """Preserve decoded pitches.

    Older versions shifted short events by +/-12 semitones when neighbouring
    notes looked smoother.  That can erase real octave ornaments, so pitch is no
    longer rewritten after acoustic segmentation.
    """
    return list(notes)


def build_game_notes(
    vocal: list[VocalNote],
    syllables: list[Syllable] | None = None,
    min_note: float = 0.0,
) -> list[VocalNote]:
    """Build karaoke/scoring events from acoustic notes and aligned syllables.

    Acoustic notes remain the musical truth.  The game/reference layer is more
    granular: if one sustained pitch spans N aligned syllables, it emits N
    consecutive events at the same MIDI pitch.  A syllable boundary is never
    discarded merely because two lyric events are close in time; when raw
    boundaries collapse, the acoustic note is partitioned proportionally across
    the participating syllables instead.  This preserves lyric granularity
    without inventing pitch changes.
    """
    ordered_syllables = sorted(
        syllables or [],
        key=lambda item: (item.start, item.end, item.index),
    )
    result: list[VocalNote] = []
    threshold = max(0.0, float(min_note))

    for note in vocal:
        duration = float(note.end) - float(note.start)
        if duration <= 0 or duration < threshold:
            continue

        overlaps = [
            syllable
            for syllable in ordered_syllables
            if min(note.end, syllable.end) - max(note.start, syllable.start) > 0.0
        ]
        # A syllable can be encountered through overlapping artifacts more than
        # once in defensive callers.  Keep one canonical owner per syllable id.
        unique: list[Syllable] = []
        seen: set[int] = set()
        for syllable in overlaps:
            key = int(syllable.index)
            if key in seen:
                continue
            seen.add(key)
            unique.append(syllable)
        overlaps = unique

        if len(overlaps) <= 1:
            owner = overlaps[0] if overlaps else None
            result.append(
                VocalNote(
                    note.start,
                    note.end,
                    int(note.midi_note),
                    note.velocity,
                    owner.word_index if owner else note.word_index,
                    owner.index if owner else note.syllable_index,
                    (),
                )
            )
            continue

        # Preferred cuts follow the aligned start of each following syllable.
        raw_cuts = (
            [float(note.start)]
            + [
                max(float(note.start), min(float(note.end), float(syllable.start)))
                for syllable in overlaps[1:]
            ]
            + [float(note.end)]
        )

        # If every cut is strictly increasing, retain the acoustic/lyric
        # boundaries exactly.  Otherwise (e.g. several aligned syllables share a
        # near-identical timestamp), partition the *same acoustic note* using
        # relative lyric overlap weights.  This guarantees one game event per
        # overlapping syllable without any fixed millisecond floor.
        strictly_increasing = all(
            right > left for left, right in zip(raw_cuts, raw_cuts[1:], strict=False)
        )
        if strictly_increasing:
            boundaries = raw_cuts
        else:
            weights = [
                max(
                    1e-9,
                    min(float(note.end), float(syllable.end))
                    - max(float(note.start), float(syllable.start)),
                )
                for syllable in overlaps
            ]
            total = max(1e-9, sum(weights))
            boundaries = [float(note.start)]
            accumulated = 0.0
            for weight in weights[:-1]:
                accumulated += weight
                boundaries.append(float(note.start) + duration * (accumulated / total))
            boundaries.append(float(note.end))

        # One segment per participating syllable, same detected pitch.
        for owner, left, right in zip(overlaps, boundaries[:-1], boundaries[1:], strict=True):
            result.append(
                VocalNote(
                    left,
                    right,
                    int(note.midi_note),
                    note.velocity,
                    owner.word_index,
                    owner.index,
                    (),
                )
            )
    return result
