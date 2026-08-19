from __future__ import annotations

import math
import statistics
from collections import Counter
from collections.abc import Sequence
from contextvars import ContextVar
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from .audio import load_mono
from .models import PitchFrame, Syllable, VocalNote, Word
from .utils.numeric import clamp01, energy_attack_strength

NOTE_DECODER_VERSION = "acoustic-notes-v33-boundary-lyrics-association"
_NOTE_DIAGNOSTICS: ContextVar[dict | None] = ContextVar("note_diagnostics", default=None)


def get_note_diagnostics() -> dict: return dict(_NOTE_DIAGNOSTICS.get() or {})


def hz_to_midi(hz: float) -> float: return 69.0 + 12.0 * math.log2(float(hz) / 440.0)


def _median_filter(values: list[float], radius: int=2) -> list[float]: return [float(statistics.median(values[max(0, i - radius):i + radius + 1])) for i in range(len(values))]


def _weighted_median(values: list[float], weights: list[float]) -> float:
    if not values: raise ValueError("weighted median requires at least one value")
    pairs = sorted(zip(values, weights, strict=False), key=lambda item: item[0])
    total = sum(max(0.0, weight) for _, weight in pairs)
    if total <= 1e-12: return float(statistics.median(values))
    cursor, midpoint = 0.0, total / 2.0
    for value, weight in pairs:
        cursor += max(0.0, weight)
        if cursor >= midpoint: return float(value)


def _robust_pitch_center(values: list[float], weights: list[float]) -> float:
    if not values: raise ValueError("pitch centre requires at least one value")
    array = np.asarray(values, dtype=float)
    q10, q25, q75, q90 = np.percentile(array, [10, 25, 75, 90])
    return float((q25 + q75) / 2.0) if float(q90 - q10) <= 2.6 else _weighted_median(values, weights)


@dataclass(frozen=True)
class _NoteTimingProfile:

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
    if not gaps: return max(float(fallback), 1e-4)
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

    merge_gap, micro_duration, spike_duration, neighbour_radius, phrase_gap, history_frames, future_frames = max(step * 2.5, min(note_scale * 0.18, gap_scale * 1.25)), max(step * 5.0, note_scale * 0.3), max(step * 7.0, note_scale * 0.38), max(note_scale * 0.65, gap_scale * 2.5), max(note_scale * 0.5, gap_scale * 2.0), max(3, int(round(note_scale * 0.14 / step))), max(2, int(round(note_scale * 0.08 / step)))
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
    if not usable: return []

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
    if len(run) < 2: return [run] if run else []

    observed, gaps = _median_filter([hz_to_midi(frame.frequency) for frame in run], radius=2), [b.time - a.time for a, b in zip(run, run[1:], strict=False) if 0 < b.time - a.time <= 0.08]
    step = max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))
    min_frames, normal_confirmation, fast_confirmation = max(4, int(math.ceil(min_note / step))), max(min_note * 1.5, step * 8.0), max(min_note, step * 5.0)
    weak_attack, strong_attack = 0.45, 0.55
    boundaries, segment_start, i = [0], 0, min_frames
    while i < len(run):
        history = observed[segment_start:i]
        center = statistics.median(history)
        delta_now = observed[i] - center

        threshold = max(0.95, float(split_semitones) + 0.12)
        if abs(delta_now) < threshold:
            i += 1
            continue

        attack = _local_frame_attack_strength(run, i)
        separation = abs(delta_now) / max(threshold, 1e-6)
        if attack >= strong_attack:
            confirmation = fast_confirmation
        elif separation >= 1.8:
            confirmation = max(min_note, normal_confirmation * 0.75)
        else:
            confirmation = normal_confirmation
        needed = max(min_frames, int(math.ceil(confirmation / step)))
        if i + needed > len(run): break
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

        supporters = [
            value
            for value in future
            if (value - center) * delta > 0 and abs(value - center) >= threshold * 0.82
        ]
        if len(supporters) < math.ceil(needed * 0.82):
            i += 1
            continue

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
    if index <= 0 or index >= len(run): return 0.0
    before = [max(0.0, run[i].energy) for i in range(max(0, index - 6), index)]
    after = [max(0.0, run[i].energy) for i in range(index, min(len(run), index + 4))]
    return energy_attack_strength(before, after)


def _energy_reattack_boundaries(segment: list[PitchFrame], min_note: float) -> list[int]:
    if len(segment) < 12: return []
    steps = [b.time - a.time for a, b in zip(segment, segment[1:], strict=False) if b.time > a.time]
    step = max(0.005, min(0.04, statistics.median(steps) if steps else 0.01))
    min_frames, energies = max(5, int(round(max(min_note, step * 5.0) / step))), [max(0.0, f.energy) for f in segment]
    positive = [e for e in energies if e > 0]
    if not positive: return []
    typical = statistics.median(positive)
    if typical <= 1e-8: return []
    low_threshold, min_low = typical * 0.52, max(2, int(round(max(step * 2.0, min_note * 0.25) / step)))
    max_low, context, boundaries, i = max(min_low, int(round(max(step * 4.0, min_note * 1.8) / step))), max(3, int(round(max(step * 3.0, min_note * 0.75) / step))), [], min_frames
    while i < len(segment) - min_frames:
        if energies[i] > low_threshold:
            i += 1
            continue
        left = i
        while i < len(segment) and energies[i] <= low_threshold: i += 1
        right = i
        width = right - left
        if not min_low <= width <= max_low: continue
        if left < context or right + context > len(segment): continue
        before = statistics.median(energies[left - context : left])
        valley = statistics.median(energies[left:right])
        after = statistics.median(energies[right : right + context])
        if (
            before >= typical * 0.62
            and after >= typical * 0.68
            and valley <= min(before, after) * 0.55
        ):
            boundary = right
            if boundary >= min_frames and len(segment) - boundary >= min_frames: boundaries.append(boundary)
    return boundaries


def _split_on_reattacks(segment: list[PitchFrame], min_note: float) -> list[list[PitchFrame]]:
    boundaries = _energy_reattack_boundaries(segment, min_note)
    if not boundaries: return [segment]
    edges = [0, *boundaries, len(segment)]
    parts, durations = [segment[left:right] for left, right in zip(edges, edges[1:], strict=False) if right > left], []
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
    return [segment] if any((value < min_note for value in durations)) else parts


def _bend_curve(
    segment: list[PitchFrame],
    *,
    start: float,
    base: int,
    duration: float,
) -> tuple[tuple[float, float], ...]:
    if not segment: return ()
    midi = _median_filter([hz_to_midi(frame.frequency) for frame in segment], radius=1)
    result: list[tuple[float, float]] = []
    last_time = -1.0
    last_cents: float | None = None
    for index, (frame, value) in enumerate(zip(segment, midi, strict=False)):
        relative = max(0.0, min(duration, frame.time - start))
        cents = max(-199.0, min(199.0, (value - base) * 100.0))
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
    if not segment: return None
    step = (
        statistics.median(
            [b.time - a.time for a, b in zip(segment, segment[1:], strict=False) if b.time > a.time]
        )
        if len(segment) > 1
        else max(min_note / 6.0, 1e-4)
    )
    step, start = max(float(step), 0.0001), segment[0].time
    end = segment[-1].time + step
    if end - start < min_note: return None

    values, energies = [hz_to_midi(frame.frequency) for frame in segment], [max(frame.energy, 0.0001) for frame in segment]
    max_energy = max(energies) if energies else 1.0
    weights = [
        max(0.02, frame.confidence) * (0.35 + 0.65 * energy / max_energy)
        for frame, energy in zip(segment, energies, strict=False)
    ]
    center = _robust_pitch_center(values, weights)
    base, confidence = max(0, min(127, int(round(center)))), sum((frame.confidence for frame in segment)) / len(segment)
    velocity, cents = max(42, min(118, int(round(62 + confidence * 48)))), _bend_curve(segment, start=start, base=base, duration=end - start)
    return VocalNote(
        start,
        end,
        base,
        velocity,
        syllable.word_index if syllable is not None else None,
        syllable.index if syllable is not None else None,
        cents,
    )


def _merge_padded_intervals(
    items: Sequence[Syllable | Word], *, pad: float, merge_gap: float
) -> list[tuple[float, float]]:
    raw = [
        (max(0.0, item.start - pad), item.end + pad)
        for item in sorted(items, key=lambda item: (item.start, item.end))
    ]
    merged: list[tuple[float, float]] = []
    for start, end in raw:
        if not merged or start - merged[-1][1] > merge_gap:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _lyric_activity_intervals(syllables: list[Syllable], *, pad: float=0.035, merge_gap: float=0.11) -> list[tuple[float, float]]: return _merge_padded_intervals(syllables, pad=pad, merge_gap=merge_gap) if syllables else []


def _word_activity_intervals(words: list[Word], *, pad: float=0.09, merge_gap: float=0.18) -> list[tuple[float, float]]: return _merge_padded_intervals(words, pad=pad, merge_gap=merge_gap) if words else []


def _decode_pitch_only(
    frames: list[PitchFrame],
    *,
    min_note: float,
    split_semitones: float,
    max_gap: float,
    min_confidence: float,
) -> list[VocalNote]:
    output: list[VocalNote] = []
    for run in _voiced_runs(frames, max_gap=max_gap, min_confidence=min_confidence):
        for pitch_segment in _sustained_pitch_segments(
            run, split_semitones=split_semitones, min_note=min_note
        ):
            for segment in _split_on_reattacks(pitch_segment, min_note):
                note = _note_from_segment(segment, None, min_note=min_note)
                if note is not None: output.append(note)
    return sorted(output, key=lambda note: (note.start, note.end, note.midi_note))


def _attach_soft_lyric_labels(notes: list[VocalNote], syllables: list[Syllable]) -> list[VocalNote]:
    if not syllables: return notes

    result: list[VocalNote] = []
    for note in notes:
        linked = _overlapping_owner_syllables(note, syllables)
        if not linked:
            result.append(note)
            continue
        owner = max(
            linked,
            key=lambda syllable: min(note.end, syllable.end) - max(note.start, syllable.start),
        )
        result.append(
            replace(
                note, word_index=owner.word_index, syllable_index=owner.index,
                syllable_indices=tuple(syllable.index for syllable in linked),
            )
        )
    return result


def _overlapping_owner_syllables(note: VocalNote, syllables: list[Syllable]) -> list[Syllable]: return sorted((syllable for syllable in syllables if min(note.end, syllable.end) - max(note.start, syllable.start) > 1e-09), key=lambda syllable: (syllable.start, syllable.end, syllable.index))


def _adaptive_lyric_timing(
    words: list[Word], syllables: list[Syllable], min_note: float
) -> tuple[float, float, float]:
    spans, gaps = [max(0.0, item.end - item.start) for item in words or syllables if item.end > item.start], [b.start - a.end for a, b in zip(words or syllables, (words or syllables)[1:], strict=False) if b.start - a.end > 0]
    typical = float(statistics.median(spans)) if spans else max(min_note * 4.0, 0.20)
    gap = float(statistics.median(gaps)) if gaps else max(min_note, typical * 0.18)
    pad = max(min_note * 0.55, min(typical * 0.16, gap * 0.75))
    merge, nearest = max(pad * 1.5, min(typical * 0.38, gap * 1.35)), min(0.03, max(min_note * 0.65, min(pad, typical * 0.18)))
    return pad, merge, nearest


def _filter_to_lyric_phrases(
    notes: list[VocalNote],
    syllables: list[Syllable],
    *,
    min_note: float,
    words: list[Word] | None = None,
) -> list[VocalNote]:
    if not syllables and not words: return notes
    pad, merge_gap, nearest_limit = _adaptive_lyric_timing(words or [], syllables, min_note)
    intervals = _word_activity_intervals(words or [], pad=pad, merge_gap=merge_gap) or _lyric_activity_intervals(syllables, pad=pad, merge_gap=merge_gap)
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
        if best_overlap > 0 or nearest <= nearest_limit: result.append(note)
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
        elif previous.end - previous.start < note.end - note.start: output.pop()
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
    if frame_index < 0 or frame_index >= magnitude.shape[1]: return -12.0
    frequency, column = 440.0 * 2 ** ((float(midi_note) - 69.0) / 12.0), magnitude[:, frame_index]
    useful = column[1 : min(len(column), int(5000 * n_fft / sample_rate) + 2)]
    noise, score, fundamental_ratio = float(np.median(useful)) + 1e-07 if useful.size else 1e-07, 0.0, 0.0
    for harmonic, weight in enumerate((2.1, 1.35, 1.0, 0.78, 0.60, 0.45, 0.35), start=1):
        target = frequency * harmonic
        if target >= sample_rate / 2 or target > 5000: break
        center = int(round(target * n_fft / sample_rate))
        lo = max(1, center - 2)
        hi = min(len(column), center + 3)
        peak = float(np.max(column[lo:hi]))
        ratio = peak / noise
        if harmonic == 1: fundamental_ratio = ratio
        score += weight * math.log1p(max(0.0, ratio))
    if fundamental_ratio < 2.0: score -= 2.0 - fundamental_ratio
    return score


def _audio_verify_note_register(
    notes: list[VocalNote],
    audio: str | Path | None,
    profile: _NoteTimingProfile,
    *,
    fmin_hz: float,
    fmax_hz: float,
) -> list[VocalNote]:
    if not notes or audio is None: return list(notes)
    try:
        import librosa

        waveform, sample_rate = load_mono(audio, 16_000)
        if waveform.size < 1024: return list(notes)
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
    register_low, register_high = max(0, int(math.floor(global_center - register_margin))), min(127, int(math.ceil(global_center + register_margin)))

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
        for shift in (-24, -19, -12, 0, 12, 19, 24):
            value = int(note.midi_note + shift)
            if register_low <= value <= register_high and value not in candidates: candidates.append(value)
        for value in (yin_center, yin_center - 12, yin_center + 12):
            value = int(value)
            if register_low <= value <= register_high and value not in candidates: candidates.append(value)
        if not candidates: candidates = [int(note.midi_note)]

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
            relative_duration = duration / max(profile.note_scale, profile.frame_step)
            if candidate == note.midi_note:
                source_prior = 0.38 + min(0.75, relative_duration * 0.45)
            else:
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
        if note_index <= 0 or not len(onset) or onset_reference <= 0: return False
        current_note = notes[note_index]
        onset_index = min(
            len(onset) - 1,
            max(0, int(round(current_note.start * sample_rate / hop))),
        )
        return float(onset[onset_index]) >= onset_reference

    # IMPORTANT: never carry register-state through the whole song. In dense
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
            if strong_attack := _is_strong_attack(index):
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
        for offset, state in enumerate(local_states): selected_states[group_lo + offset] = state

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

            required_margin = next(
                margin for threshold, margin in ((19, 1.75), (12, 1.20), (7, 0.85), (0, 0.45))
                if delta >= threshold
            )
            if strong_attack: required_margin += 0.30

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
        verified.append(replace(note, midi_note=chosen, cents=cents, syllable_indices=()))

    changed = [
        {
            "index": idx,
            "start": round(before.start, 4),
            "end": round(before.end, 4),
            "original_midi": before.midi_note,
            "verified_midi": after.midi_note,
            "semitone_delta": after.midi_note - before.midi_note,
            "reason": "audio_register_verification",
        }
        for idx, (before, after) in enumerate(zip(notes, verified, strict=False))
        if before.midi_note != after.midi_note
    ]

    def _bucket(delta: int) -> str:
        value = abs(int(delta))
        if value >= 19: return "harmonic_19_plus"
        if value >= 12: return "octave_12_plus"
        if value >= 7: return "large_7_11"
        return 'medium_3_6' if value >= 3 else 'small_1_2'

    accepted_buckets, rejected_buckets, diag = Counter((_bucket(int(item['semitone_delta'])) for item in accepted_changes)), Counter((_bucket(int(item['semitone_delta'])) for item in rejected_changes)), dict(_NOTE_DIAGNOSTICS.get() or {})
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
    if len(notes) < 3: return list(notes)
    work, harmonic_shifts = list(notes), (-24, -19, -12, 12, 19, 24)
    for index in range(1, len(work) - 1):
        left, current, right = work[index - 1], work[index], work[index + 1]
        left_gap = current.start - left.end
        right_gap = right.start - current.end
        if left_gap > profile.phrase_gap or right_gap > profile.phrase_gap: continue
        if _pitch_attack_strength(frames, current.start, profile) >= profile.attack_strong: continue
        if abs(left.midi_note - right.midi_note) > 5: continue
        target = (left.midi_note + right.midi_note) / 2.0
        original_distance = abs(current.midi_note - target)
        if original_distance < 7.5: continue
        candidates = [current.midi_note + shift for shift in harmonic_shifts]
        candidate = min(candidates, key=lambda value: abs(value - target))
        candidate_distance = abs(candidate - target)
        improvement = original_distance - candidate_distance
        duration = current.end - current.start
        neighbourhood_spread = abs(left.midi_note - right.midi_note)
        allowed_distance = max(2.5, min(5.0, neighbourhood_spread + 3.0))
        required_improvement = max(4.0, original_distance * 0.55)
        if candidate_distance > allowed_distance or improvement < required_improvement: continue
        long_note = profile.note_scale * 1.35
        very_long_note = profile.note_scale * 2.4
        if duration > long_note and not (duration <= very_long_note and candidate_distance <= 3.0): continue
        work[index] = replace(
            current, midi_note=int(round(candidate)), cents=(), syllable_indices=()
        )
    return work


def _merge_verified_fragments(
    notes: list[VocalNote],
    frames: list[PitchFrame] | None,
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    if not notes: return []
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
            output[-1] = replace(
                previous, end=max(previous.end, note.end),
                velocity=max(previous.velocity, note.velocity), cents=(), syllable_indices=(),
            )
        else:
            output.append(note)
    return output


def build_vocal_notes(
    pitch: list[PitchFrame],
    syllables: list[Syllable],
    min_note: float = 0.07,
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
    _NOTE_DIAGNOSTICS.set({})
    frames, ordered_syllables = sorted(pitch, key=lambda frame: frame.time), sorted(syllables, key=lambda item: (item.start, item.end))
    notes = _decode_pitch_only(
        frames,
        min_note=min_note,
        split_semitones=split_semitones,
        max_gap=max_gap,
        min_confidence=min_confidence,
    )
    notes = _filter_to_lyric_phrases(
        notes,
        ordered_syllables,
        min_note=min_note,
        words=words,
    )
    if ordered_syllables: notes = _attach_soft_lyric_labels(notes, ordered_syllables)
    notes = _make_monophonic(notes, min_note)
    timing = _note_timing_profile(frames, notes, min_note_hint=min_note)
    notes = _audio_verify_note_register(notes, audio, timing, fmin_hz=fmin_hz, fmax_hz=fmax_hz)
    notes = _repair_isolated_harmonic_notes(notes, frames, timing)
    notes = _merge_verified_fragments(notes, frames, timing)
    notes = _consolidate_micro_fragments(notes, frames, timing)
    notes = _repair_short_isolated_spikes(notes, frames, timing)
    notes = _merge_same_pitch_gaps(notes, frames, timing)
    notes, diag = _repair_note_outliers(notes), dict(_NOTE_DIAGNOSTICS.get() or {})
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
    if not frames: return 0.0
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
    future = [max(0.0, frames[i].energy) for i in range(index, min(len(frames), index + future_count))]
    return energy_attack_strength(history, future, threshold=1.22, scale=0.88)


def _consolidate_micro_fragments(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    if len(notes) < 2: return list(notes)
    work, index = list(notes), 1
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
                replace(
                    left, end=right.end, velocity=max(left.velocity, middle.velocity, right.velocity),
                    cents=(), syllable_indices=(),
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
        output[-1] = replace(
            previous, end=max(previous.end, note.end), midi_note=base,
            velocity=max(previous.velocity, note.velocity), cents=(), syllable_indices=(),
        )
    return output


def _repair_short_isolated_spikes(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    if len(notes) < 3: return list(notes)
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
            if j == i: continue
            candidate = work[j]
            if (
                candidate.end < mid.start - profile.neighbour_radius
                or candidate.start > mid.end + profile.neighbour_radius
            ):
                continue
            neighbours.append(candidate.midi_note)
        if len(neighbours) < 2: continue
        target = int(round(statistics.median(neighbours)))
        tight = sum(abs(value - target) <= 2 for value in neighbours) >= max(2, len(neighbours) - 1)
        if tight and abs(mid.midi_note - target) >= 5: work[i] = replace(mid, midi_note=target, cents=(), syllable_indices=())
    return work


def _merge_same_pitch_gaps(
    notes: list[VocalNote],
    frames: list[PitchFrame],
    profile: _NoteTimingProfile,
) -> list[VocalNote]:
    if not notes: return []
    output = [notes[0]]
    for note in notes[1:]:
        prev = output[-1]
        gap = note.start - prev.end
        if (
            note.midi_note == prev.midi_note
            and 0 <= gap <= max(profile.merge_gap, profile.gap_scale * 1.5)
            and _pitch_attack_strength(frames, note.start, profile) < 0.28
        ):
            output[-1] = replace(
                prev, end=note.end, velocity=max(prev.velocity, note.velocity),
                word_index=prev.word_index if prev.word_index == note.word_index else None,
                syllable_index=prev.syllable_index if prev.syllable_index == note.syllable_index else None,
                cents=(), syllable_indices=(),
            )
        else:
            output.append(note)
    return output


def _repair_note_outliers(notes: list[VocalNote]) -> list[VocalNote]: return list(notes)


def build_game_notes(
    vocal: list[VocalNote],
    syllables: list[Syllable] | None = None,
    min_note: float = 0.0,
) -> list[VocalNote]:
    ordered_syllables = sorted(
        syllables or [],
        key=lambda item: (item.start, item.end, item.index),
    )
    result: list[VocalNote] = []
    threshold = max(0.0, float(min_note))

    for note in vocal:
        duration = float(note.end) - float(note.start)
        if duration <= 0 or duration < threshold: continue

        overlaps = _overlapping_owner_syllables(note, ordered_syllables)
        seen: set[int] = set()
        overlaps = [
            syllable
            for syllable in overlaps
            if (key := int(syllable.index)) not in seen and not seen.add(key)
        ]

        owner = max(
            overlaps,
            key=lambda syllable: min(note.end, syllable.end) - max(note.start, syllable.start),
            default=None,
        )
        linked_indices = tuple(syllable.index for syllable in overlaps)
        primary_index = owner.index if owner else None
        result.append(
            replace(
                note, midi_note=int(note.midi_note), word_index=owner.word_index if owner else None,
                syllable_index=primary_index, cents=(), syllable_indices=linked_indices,
            )
        )
    return result
