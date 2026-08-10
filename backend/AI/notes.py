from __future__ import annotations

import math
import statistics
from pathlib import Path

import numpy as np

from .audio import load_mono

from .models import PitchFrame, Syllable, VocalNote, Word

NOTE_DECODER_VERSION = "acoustic-only-note-events-v26"


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
        b.time - a.time
        for a, b in zip(run, run[1:], strict=False)
        if 0 < b.time - a.time <= 0.08
    ]
    step = max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))
    min_frames = max(4, int(math.ceil(min_note / step)))
    confirm_frames = max(min_frames, int(math.ceil(0.075 / step)))

    # A note centre follows the median of the current accepted segment.  A
    # challenger has to remain separated from it for long enough.  This is much
    # less sensitive to vibrato than repeatedly comparing two short windows.
    boundaries = [0]
    segment_start = 0
    i = min_frames
    while i < len(run):
        history = observed[segment_start:i]
        if len(history) < min_frames:
            i += 1
            continue
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
        needed = max(min_frames, int(math.ceil((0.045 if attack >= 0.55 else 0.075) / step)))
        if i + needed > len(run):
            break
        future = observed[i:i + needed]
        new_center = statistics.median(future)
        delta = new_center - center
        if abs(delta) < threshold:
            i += 1
            continue

        # Most frames must consistently support the new side.  A glissando that
        # merely passes through another semitone therefore stays one bent note.
        supporters = [
            value for value in future
            if (value - center) * delta > 0 and abs(value - center) >= threshold * 0.82
        ]
        if len(supporters) < math.ceil(needed * 0.82):
            i += 1
            continue

        # Require a reasonably stable destination. Wide sweeps are represented
        # with pitch bend and do not manufacture a staircase of MIDI notes.
        spread = float(np.percentile(future, 90) - np.percentile(future, 10))
        allowed_spread = 1.45 if abs(delta) >= 5.0 else 0.82
        if spread > allowed_spread:
            i += 1
            continue

        # Avoid leaving an unusably short previous event unless this is a clear
        # acoustic re-attack.
        if i - segment_start < min_frames and attack < 0.70:
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

    # Merge any residual too-short piece into its closest-pitch neighbour.
    output: list[list[PitchFrame]] = []
    for segment in segments:
        duration = segment[-1].time - segment[0].time + step
        if duration >= min_note or not output:
            output.append(segment)
            continue
        output[-1].extend(segment)
    if len(output) >= 2:
        last = output[-1]
        duration = last[-1].time - last[0].time + step
        if duration < min_note:
            output[-2].extend(output.pop())
    return output


def _local_frame_attack_strength(run: list[PitchFrame], index: int) -> float:
    """0..1 attack estimate for pitch-state confirmation."""
    if index <= 0 or index >= len(run):
        return 0.0
    before = [max(0.0, run[i].energy) for i in range(max(0, index - 6), index)]
    after = [max(0.0, run[i].energy) for i in range(index, min(len(run), index + 4))]
    if not before or not after:
        return 0.0
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


def _attach_soft_lyric_labels(
    notes: list[VocalNote], syllables: list[Syllable]
) -> list[VocalNote]:
    """Attach the best lyric label without changing note timing or pitch."""
    if not syllables:
        return notes
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
        # A nearby syllable can label an onset that precedes the aligned text by
        # a few tens of milliseconds.  Otherwise leave backing/noise unlabeled.
        distance = min(abs(note.end - owner.start), abs(note.start - owner.end))
        if overlap <= 0 and distance > 0.12:
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
    intervals = (
        _word_activity_intervals(words or [], pad=0.09, merge_gap=0.18)
        or _lyric_activity_intervals(syllables, pad=0.09, merge_gap=0.18)
    )
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
        if best_overlap > 0 or nearest <= 0.055:
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
                tuple((time, cents) for time, cents in previous.cents if time <= boundary - previous.start + 1e-9),
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
                    tuple((max(0.0, time - offset), cents) for time, cents in note.cents if time >= offset - 1e-9),
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
        if hi <= lo:
            continue
        peak = float(np.max(column[lo:hi]))
        ratio = peak / noise
        if harmonic == 1:
            fundamental_ratio = ratio
        score += weight * math.log1p(max(0.0, ratio))
    if fundamental_ratio < 2.0:
        score -= (2.0 - fundamental_ratio)
    return score


def _audio_verify_note_register(
    notes: list[VocalNote],
    audio: str | Path | None,
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
            fmin=55.0,
            fmax=1000.0,
            sr=sample_rate,
            frame_length=1024,
            hop_length=hop,
            center=True,
        )
        n_fft = 2048
        magnitude = np.abs(
            librosa.stft(
                waveform, n_fft=n_fft, hop_length=hop, win_length=n_fft, center=True
            )
        ).astype(np.float32, copy=False)
        onset = librosa.onset.onset_strength(
            y=waveform, sr=sample_rate, hop_length=hop, center=True
        ).astype(np.float32, copy=False)
        onset_reference = float(np.percentile(onset, 82)) if onset.size else 0.0
    except Exception:
        return list(notes)

    original = [int(note.midi_note) for note in notes]
    global_center = statistics.median(original)
    register_low = max(28, int(math.floor(global_center - 19)))
    register_high = min(96, int(math.ceil(global_center + 19)))

    candidate_rows: list[list[int]] = []
    emission_rows: list[list[float]] = []
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

        duration = max(0.001, note.end - note.start)
        sample_count = max(3, min(10, int(duration / 0.03) + 1))
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
            if candidate == note.midi_note:
                source_prior = 0.38 + min(0.75, duration * 1.8)
            else:
                # Rewrites are allowed, but never for free. Long sustained raw
                # notes keep a modest prior unless another candidate clearly
                # explains the waveform better.
                source_prior = -(0.18 + min(0.65, duration * 0.9))
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
            gap >= 0.12
            or (span >= 1.35 and strong_attack)
            or span >= 4.0
        )
        if reset:
            groups.append((group_start, index))
            group_start = index
    groups.append((group_start, len(notes)))

    selected_states = [0] * len(notes)
    for group_lo, group_hi in groups:
        if group_hi <= group_lo:
            continue
        local_scores: list[list[float]] = [list(emission_rows[group_lo])]
        local_back: list[list[int]] = [[-1] * len(candidate_rows[group_lo])]
        for index in range(group_lo + 1, group_hi):
            previous_note = notes[index - 1]
            current_note = notes[index]
            gap = current_note.start - previous_note.end
            strong_attack = _is_strong_attack(index)
            if strong_attack:
                transition_scale = 0.18
            elif gap > 0.06:
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
                    value = (
                        local_scores[-1][previous_state]
                        - transition * transition_scale
                    )
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

    verified: list[VocalNote] = []
    for index, note in enumerate(notes):
        midi_note = candidate_rows[index][selected_states[index]]
        # Existing bends are relative to the old base note.  Keeping them after
        # an octave repair would reintroduce the wrong contour, so corrected
        # notes intentionally start with a clean bend curve.
        cents = note.cents if midi_note == note.midi_note else ()
        verified.append(
            VocalNote(
                note.start,
                note.end,
                midi_note,
                note.velocity,
                note.word_index,
                note.syllable_index,
                cents,
            )
        )
    return verified



def _repair_isolated_harmonic_notes(
    notes: list[VocalNote],
    frames: list[PitchFrame],
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
        if left_gap > 0.16 or right_gap > 0.16:
            continue
        if _pitch_attack_strength(frames, current.start) >= 0.38:
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
        if candidate_distance > 4.0 or improvement < 6.5:
            continue
        # Long notes require an exceptionally clear local-register consensus.
        if duration > 0.38 and not (duration <= 0.72 and candidate_distance <= 3.0):
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

def _merge_verified_fragments(notes: list[VocalNote], *, max_gap: float = 0.035) -> list[VocalNote]:
    """Merge fragments that became the same note after register verification."""
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
        if same_pitch and same_unit and note.start - previous.end <= max_gap:
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
    activity_segments: list[tuple[float, float, str]] | tuple[tuple[float, float, str], ...] | None = None,
) -> list[VocalNote]:
    """Build MIDI from the acoustic pitch contour, with lyrics as soft context.

    Crucially, approximate syllable timestamps never create or cut notes.  Pitch
    determines attacks, releases and melismas.  Lyrics only suppress pitch events
    far outside aligned vocal phrases and supply word/syllable labels afterwards.
    """
    frames = sorted(pitch, key=lambda frame: frame.time)
    ordered_syllables = sorted(syllables, key=lambda item: (item.start, item.end))
    # Lyrics/alignment are metadata only.  Even synchronized LRC lines are not
    # precise enough to gate note extraction: intros, pickups, melismas and
    # line-level offsets can otherwise delete valid acoustic melody. Decode the
    # complete pitch contour and attach text only after note events exist.
    notes = _decode_pitch_only(
        frames, min_note=min_note, split_semitones=split_semitones,
        max_gap=max_gap, min_confidence=min_confidence,
    )
    # MIDI melody must NEVER be cut or created from lyric timestamps.
    # Forced alignment can be locally wrong even when the lyric text itself is
    # perfect (e.g. a short phrase may be stretched over many seconds).  Using
    # those intervals as an acoustic gate corrupts an otherwise valid pitch
    # contour.  Lyrics are metadata only: they may label already-existing notes,
    # but cannot change note start/end/pitch or suppress notes.
    if ordered_syllables:
        notes = _attach_soft_lyric_labels(notes, ordered_syllables)
    notes = _make_monophonic(notes, min_note)
    notes = _audio_verify_note_register(notes, audio)
    notes = _repair_isolated_harmonic_notes(notes, frames)
    notes = _merge_verified_fragments(notes)
    notes = _consolidate_micro_fragments(notes, frames)
    # Do not run a second octave/harmonic repair pass here.  A second pass can
    # undo the audio-verified register chosen above and makes the decoder
    # order-dependent.
    notes = _repair_short_isolated_spikes(notes, frames)
    notes = _merge_same_pitch_gaps(notes, frames)
    return _repair_note_outliers(notes)



def _pitch_attack_strength(frames: list[PitchFrame], timestamp: float) -> float:
    """Estimate a local vocal re-attack around a note boundary from RMS energy."""
    if not frames:
        return 0.0
    times = [frame.time for frame in frames]
    import bisect
    index = bisect.bisect_left(times, timestamp)
    history = [
        max(0.0, frames[i].energy)
        for i in range(max(0, index - 5), index)
    ]
    future = [
        max(0.0, frames[i].energy)
        for i in range(index, min(len(frames), index + 3))
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
    *,
    max_gap: float = 0.045,
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
        close = middle.start - left.end <= max_gap and right.start - middle.end <= max_gap
        if (
            same_outer
            and same_unit
            and close
            and middle_duration <= 0.095
            and abs(middle.midi_note - left.midi_note) <= 2
            and _pitch_attack_strength(frames, middle.start) < 0.35
        ):
            work[index - 1:index + 2] = [
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
        short_side = min(note.end - note.start, previous.end - previous.start) <= 0.105
        no_attack = _pitch_attack_strength(frames, note.start) < 0.32
        should_merge = (
            gap <= max_gap
            and same_unit
            and (delta == 0 or (delta == 1 and short_side and no_attack))
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
    notes: list[VocalNote], frames: list[PitchFrame], *, max_duration: float = 0.115
) -> list[VocalNote]:
    """Repair a short pitch spike only when nearby notes form a tight cluster."""
    if len(notes) < 3:
        return list(notes)
    work = list(notes)
    for i in range(1, len(work)-1):
        mid = work[i]
        if mid.end-mid.start > max_duration or _pitch_attack_strength(frames, mid.start) >= 0.32:
            continue
        neighbours = []
        for j in range(max(0, i-2), min(len(work), i+3)):
            if j == i:
                continue
            candidate = work[j]
            if candidate.end < mid.start-0.18 or candidate.start > mid.end+0.18:
                continue
            neighbours.append(candidate.midi_note)
        if len(neighbours) < 2:
            continue
        target = int(round(statistics.median(neighbours)))
        tight = sum(abs(value-target) <= 2 for value in neighbours) >= max(2, len(neighbours)-1)
        if tight and abs(mid.midi_note-target) >= 5:
            work[i] = VocalNote(
                mid.start, mid.end, target, mid.velocity,
                mid.word_index, mid.syllable_index, (),
            )
    return work


def _merge_same_pitch_gaps(
    notes: list[VocalNote], frames: list[PitchFrame], *, max_gap: float = 0.085
) -> list[VocalNote]:
    if not notes:
        return []
    output=[notes[0]]
    for note in notes[1:]:
        prev=output[-1]
        gap=note.start-prev.end
        if (
            note.midi_note == prev.midi_note
            and 0 <= gap <= max_gap
            and _pitch_attack_strength(frames, note.start) < 0.28
        ):
            output[-1]=VocalNote(
                prev.start, note.end, prev.midi_note, max(prev.velocity,note.velocity),
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

def build_game_notes(vocal: list[VocalNote], min_note: float = 0.0) -> list[VocalNote]:
    """Mirror the canonical vocal melody exactly, only removing pitch bends.

    The frontend reads reference.json/game notes while vocal.mid used a different
    detailed sequence.  That made MIDI fixes invisible in the UI and could make
    scoring disagree with the displayed melody.  There is now one canonical note
    sequence for display, scoring and MIDI note-on/off timing.
    """
    return [
        VocalNote(
            note.start,
            note.end,
            int(note.midi_note),
            note.velocity,
            note.word_index,
            note.syllable_index,
            (),
        )
        for note in vocal
        if note.end > note.start and (note.end - note.start) >= max(0.0, float(min_note))
    ]
