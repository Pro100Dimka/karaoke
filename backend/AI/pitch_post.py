from __future__ import annotations

import math
import statistics

from .models import PitchFrame

# Harmonic tracking is needed on dense vocal stems, but transitions must become
# cheap at a real acoustic re-attack.  This keeps short melodic leaps while
# folding unsupported octave/harmonic detours back onto the lead trajectory.
PITCH_STABILIZER_VERSION = "attack-aware-harmonic-viterbi-v3"
_HARMONIC_SHIFTS = (0.0, -12.0, 12.0, -19.01955, 19.01955, -24.0, 24.0)


def _midi(hz: float) -> float:
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def _hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def _frame_step(frames: list[PitchFrame]) -> float:
    gaps = [
        b.time - a.time
        for a, b in zip(frames, frames[1:], strict=False)
        if 0 < b.time - a.time <= 0.08
    ]
    return max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))


def _attack_strength(run: list[PitchFrame], index: int) -> float:
    """Return 0..1 re-attack evidence from the already-computed vocal energy.

    A true new sung note often starts with renewed energy, while a tracker jump
    to an octave/harmonic usually happens inside one continuous voiced sound.
    Only strong relative rises count; ordinary vibrato/dynamics stay near zero.
    """
    if index <= 0:
        return 0.0
    current = max(0.0, run[index].energy)
    lo = max(0, index - 5)
    history = [max(0.0, run[i].energy) for i in range(lo, index)]
    if not history:
        return 0.0
    baseline = statistics.median(history)
    if baseline <= 1e-8:
        return 1.0 if current > 1e-5 else 0.0
    ratio = current / baseline
    # No discount below ~1.25x; full attack discount at ~2.1x.
    return max(0.0, min(1.0, (ratio - 1.25) / 0.85))


def _transition_cost(left: float, right: float, attack: float) -> float:
    distance = min(24.0, abs(right - left))
    base = 0.12 * distance + 0.035 * distance * distance
    # At a strong acoustic attack, a real large melodic leap should be allowed.
    # Still keep a small cost so noise does not make the path completely free.
    scale = 1.0 - 0.88 * max(0.0, min(1.0, attack))
    return base * max(0.12, scale)


def _shift_cost(shift: float, confidence: float) -> float:
    if abs(shift) < 0.01:
        return 0.0
    magnitude = abs(shift)
    base = 1.0 if magnitude < 13 else 1.25 if magnitude < 20 else 1.5
    # Never treat fallback confidence as absolute truth.  Confidence only adds a
    # modest source prior; sustained raw notes still win because a correction
    # pays this emission cost on every frame.
    trust = max(0.0, min(1.0, confidence))
    return base * (0.78 + 0.28 * trust)


def _stabilize_voiced_run(run: list[PitchFrame]) -> list[PitchFrame]:
    if len(run) < 3:
        return list(run)

    candidates: list[list[tuple[float, float]]] = []
    for frame in run:
        raw = _midi(frame.frequency)
        values = [
            (raw + shift, shift)
            for shift in _HARMONIC_SHIFTS
            if 28.0 <= raw + shift <= 100.0
        ]
        candidates.append(values or [(raw, 0.0)])

    attacks = [_attack_strength(run, index) for index in range(len(run))]
    costs = [_shift_cost(shift, run[0].confidence) for _, shift in candidates[0]]
    parents: list[list[int]] = [[-1] * len(candidates[0])]

    for index in range(1, len(run)):
        next_costs: list[float] = []
        next_parents: list[int] = []
        attack = attacks[index]
        for value, shift in candidates[index]:
            choices = [
                cost + _transition_cost(previous_value, value, attack)
                for cost, (previous_value, _) in zip(
                    costs, candidates[index - 1], strict=False
                )
            ]
            parent = min(range(len(choices)), key=choices.__getitem__)
            next_costs.append(
                choices[parent] + _shift_cost(shift, run[index].confidence)
            )
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
                frame.confidence * (0.97 if abs(shift) > 0.01 else 1.0),
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


def _repair_single_frame_holes(frames: list[PitchFrame]) -> list[PitchFrame]:
    out = list(frames)
    step = _frame_step(out)
    for index in range(1, len(out) - 1):
        prev, cur, nxt = out[index - 1], out[index], out[index + 1]
        if cur.voiced or not prev.voiced or not nxt.voiced:
            continue
        if prev.frequency <= 0 or nxt.frequency <= 0:
            continue
        if nxt.time - prev.time > step * 2.8:
            continue
        if abs(_midi(prev.frequency) - _midi(nxt.frequency)) > 0.55:
            continue
        out[index] = PitchFrame(
            cur.time,
            math.sqrt(prev.frequency * nxt.frequency),
            min(prev.confidence, nxt.confidence) * 0.84,
            True,
            cur.energy,
        )
    return out


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    """Denoise harmonic/octave tracker errors without flattening real attacks.

    `max_octave_jump` remains for API compatibility.  The decoder works on
    absolute harmonic candidates and uses energy re-attacks to relax continuity
    exactly where a genuine new sung note is most plausible.
    """
    if len(frames) < 3:
        return list(frames)
    return _repair_single_frame_holes(_stabilize_harmonics(frames))
