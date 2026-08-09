from __future__ import annotations

import math

from .models import PitchFrame

PITCH_STABILIZER_VERSION = "harmonic-viterbi-v1"
_HARMONIC_SHIFTS = (0.0, -12.0, 12.0, -19.01955, 19.01955, -24.0, 24.0)


def _midi(hz: float) -> float:
    return 69 + 12 * math.log2(hz / 440.0)


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69.0) / 12.0)


def _transition_cost(left: float, right: float) -> float:
    distance = min(24.0, abs(right - left))
    return 0.12 * distance + 0.035 * distance * distance


def _shift_cost(shift: float, confidence: float) -> float:
    if abs(shift) < 0.01:
        return 0.0
    base = 1.0 if abs(shift) < 13 else 1.25 if abs(shift) < 20 else 1.5
    # Trust high-confidence FCPE output more, while still permitting a short
    # harmonic excursion to be folded back onto the continuous lead melody.
    return base * (0.72 + 0.38 * max(0.0, min(1.0, confidence)))


def _stabilize_voiced_run(run: list[PitchFrame]) -> list[PitchFrame]:
    """Select the most plausible monophonic path through harmonic candidates.

    Source-separated vocals still contain reverb and backing harmonies. FCPE can
    briefly jump to the 2nd/3rd harmonic (12 or 19 semitones). A dynamic path
    removes those short detours but preserves a genuine sustained register jump,
    because corrected candidates pay an emission cost on every frame.
    """
    if len(run) < 3:
        return run
    candidates: list[list[tuple[float, float]]] = []
    for frame in run:
        raw = _midi(frame.frequency)
        values = [
            (raw + shift, shift)
            for shift in _HARMONIC_SHIFTS
            if 28.0 <= raw + shift <= 100.0
        ]
        candidates.append(values)

    costs = [_shift_cost(shift, run[0].confidence) for _, shift in candidates[0]]
    parents: list[list[int]] = [[-1] * len(candidates[0])]
    for index in range(1, len(run)):
        next_costs: list[float] = []
        next_parents: list[int] = []
        for value, shift in candidates[index]:
            choices = [
                cost + _transition_cost(previous_value, value)
                for cost, (previous_value, _) in zip(
                    costs, candidates[index - 1], strict=False
                )
            ]
            parent = min(range(len(choices)), key=choices.__getitem__)
            next_costs.append(choices[parent] + _shift_cost(shift, run[index].confidence))
            next_parents.append(parent)
        costs = next_costs
        parents.append(next_parents)

    selected = [0] * len(run)
    selected[-1] = min(range(len(costs)), key=costs.__getitem__)
    for index in range(len(run) - 1, 0, -1):
        selected[index - 1] = parents[index][selected[index]]

    output: list[PitchFrame] = []
    for frame, options, option_index in zip(run, candidates, selected, strict=False):
        midi, shift = options[option_index]
        output.append(
            PitchFrame(
                frame.time,
                _hz(midi),
                frame.confidence * (0.97 if shift else 1.0),
                frame.voiced,
                frame.energy,
            )
        )
    return output


def _stabilize_harmonics(frames: list[PitchFrame]) -> list[PitchFrame]:
    output = list(frames)
    index = 0
    while index < len(frames):
        frame = frames[index]
        if not frame.voiced or frame.frequency <= 0:
            index += 1
            continue
        end = index + 1
        while (
            end < len(frames)
            and frames[end].voiced
            and frames[end].frequency > 0
            and frames[end].time - frames[end - 1].time <= 0.035
        ):
            end += 1
        output[index:end] = _stabilize_voiced_run(frames[index:end])
        index = end
    return output


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    """Repair tiny pitch-tracker failures without smoothing real singing detail.

    Handles one-frame voicing holes and short octave-error runs up to about 60 ms.
    Vibrato, slides and true melodic changes are deliberately left untouched.
    """
    if len(frames) < 3:
        return frames
    out = _stabilize_harmonics(frames)
    for i in range(1, len(out) - 1):
        prev, cur, nxt = out[i - 1], out[i], out[i + 1]
        if (
            not cur.voiced
            and prev.voiced
            and nxt.voiced
            and nxt.time - prev.time <= 0.035
            and abs(_midi(prev.frequency) - _midi(nxt.frequency)) < 0.6
        ):
            hz = math.sqrt(prev.frequency * nxt.frequency)
            out[i] = PitchFrame(
                cur.time, hz, min(prev.confidence, nxt.confidence) * 0.85, True, cur.energy
            )

    # Correct short contiguous octave slips when stable neighbours on both sides
    # agree. This removes violent pitch-bends while preserving actual octave jumps.
    i = 1
    while i < len(out) - 1:
        if not out[i].voiced or not out[i - 1].voiced:
            i += 1
            continue
        reference = _midi(out[i - 1].frequency)
        delta = _midi(out[i].frequency) - reference
        if abs(abs(delta) - 12.0) > 1.2:
            i += 1
            continue
        direction = 1 if delta > 0 else -1
        j = i
        while j < len(out) - 1 and j - i < 7 and out[j].voiced:
            current_delta = _midi(out[j].frequency) - reference
            if direction * current_delta < 10.5 or direction * current_delta > 13.5:
                break
            j += 1
        if j > i and j < len(out) and out[j].voiced:
            after = _midi(out[j].frequency)
            elapsed = out[j - 1].time - out[i].time + 0.01
            if abs(after - reference) < 0.8 and elapsed <= 0.075:
                target_hz = math.sqrt(out[i - 1].frequency * out[j].frequency)
                for k in range(i, j):
                    frame = out[k]
                    out[k] = PitchFrame(
                        frame.time, target_hz, frame.confidence * 0.9, True, frame.energy
                    )
                i = j
                continue
        i += 1
    return out
