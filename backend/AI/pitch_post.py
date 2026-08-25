from __future__ import annotations

import numpy as np

from .models import PitchFrame

PITCH_STABILIZER_VERSION = "clean-v1"


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    if len(frames) < 3:
        return list(frames)
    # A song's pitch track runs to thousands of frames, so the smoothing
    # itself is vectorized with numpy; only building the (usually few)
    # actually-changed PitchFrame objects stays a Python loop, since
    # PitchFrame is an immutable per-frame record, not an array value.
    frequency = np.fromiter((item.frequency for item in frames), dtype=float, count=len(frames))
    voiced = np.fromiter((item.voiced for item in frames), dtype=bool, count=len(frames))
    window = np.ma.array(
        np.stack([frequency[:-2], frequency[1:-1], frequency[2:]], axis=1),
        mask=~np.stack([voiced[:-2], voiced[1:-1], voiced[2:]], axis=1),
    )
    enough_voiced_neighbors = window.count(axis=1) >= 2
    stabilized = np.ma.median(window, axis=1)
    center_voiced = voiced[1:-1]
    should_update = center_voiced & enough_voiced_neighbors

    result = list(frames)
    for offset in np.flatnonzero(should_update):
        index = int(offset) + 1
        frame = frames[index]
        result[index] = PitchFrame(
            frame.time, float(stabilized[offset]), frame.confidence, True, frame.energy
        )
    return result


def refine_pitch_confidence(frames, *_args, **_kwargs):
    return list(frames)


def fuse_pitch_with_yin(primary, *_args, **_kwargs):
    return list(primary)
