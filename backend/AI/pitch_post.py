from __future__ import annotations

from statistics import median

from .models import PitchFrame

PITCH_STABILIZER_VERSION = "clean-v1"


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    if len(frames) < 3:
        return list(frames)
    result = list(frames)
    for index in range(1, len(frames) - 1):
        window = [item.frequency for item in frames[index - 1:index + 2] if item.voiced]
        if len(window) >= 2 and frames[index].voiced:
            result[index] = PitchFrame(frames[index].time, median(window), frames[index].confidence, True, frames[index].energy)
    return result


def refine_pitch_confidence(frames, *_args, **_kwargs):
    return list(frames)


def fuse_pitch_with_yin(primary, *_args, **_kwargs):
    return list(primary)
