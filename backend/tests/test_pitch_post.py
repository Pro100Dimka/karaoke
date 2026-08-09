from __future__ import annotations

import math

from AI.models import PitchFrame
from AI.pitch_post import stabilize_pitch


def _frame(index: int, midi: float) -> PitchFrame:
    frequency = 440.0 * 2 ** ((midi - 69.0) / 12.0)
    return PitchFrame(index * 0.01, frequency, 0.95, True, 1.0)


def _midi(frame: PitchFrame) -> float:
    return 69.0 + 12.0 * math.log2(frame.frequency / 440.0)


def test_short_third_harmonic_detour_is_removed() -> None:
    frames = [*[_frame(i, 60) for i in range(20)]]
    frames.extend(_frame(i, 79.01955) for i in range(20, 27))
    frames.extend(_frame(i, 60) for i in range(27, 47))

    fixed = stabilize_pitch(frames)

    assert max(abs(_midi(frame) - 60.0) for frame in fixed[20:27]) < 0.1


def test_sustained_octave_change_is_preserved() -> None:
    frames = [_frame(i, 60) for i in range(20)]
    frames.extend(_frame(i, 72) for i in range(20, 70))

    fixed = stabilize_pitch(frames)

    assert min(_midi(frame) for frame in fixed[35:65]) > 71.9
