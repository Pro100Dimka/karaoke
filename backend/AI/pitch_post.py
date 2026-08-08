from __future__ import annotations

import math

from .models import PitchFrame


def _midi(hz: float) -> float:
    return 69 + 12 * math.log2(hz / 440.0)


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    """Repair tiny pitch-tracker failures without smoothing real singing detail.

    Handles one-frame voicing holes and short octave-error runs up to about 60 ms.
    Vibrato, slides and true melodic changes are deliberately left untouched.
    """
    if len(frames) < 3:
        return frames
    out = list(frames)
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
