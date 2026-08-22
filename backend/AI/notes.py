from __future__ import annotations

import math
from statistics import median

from .models import PitchFrame, VocalNote, Word

NOTE_DECODER_VERSION = "clean-v1"


def hz_to_midi(hz: float) -> float:
    return 69 + 12 * math.log2(float(hz) / 440)


def _segments(frames: list[PitchFrame], gap: float, split: float):
    current: list[PitchFrame] = []
    for frame in frames:
        if not frame.voiced:
            if current:
                yield current
                current = []
            continue
        if current and (frame.time - current[-1].time > gap or abs(hz_to_midi(frame.frequency) - hz_to_midi(current[-1].frequency)) >= split):
            yield current
            current = []
        current.append(frame)
    if current:
        yield current


def _owner(words: list[Word], midpoint: float, tolerance: float) -> Word | None:
    candidates = [
        (max(word.start - midpoint, midpoint - word.end, 0.0), word)
        for word in words
        if word.start - tolerance <= midpoint <= word.end + tolerance
    ]
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def build_vocal_notes(
    pitch: list[PitchFrame],
    _syllables=(),
    *,
    min_note=0.07,
    split_semitones=0.78,
    max_gap=0.05,
    min_confidence=0.38,
    words: list[Word] | None = None,
    word_boundary_tolerance=0.12,
    **_context,
) -> list[VocalNote]:
    frames = [frame for frame in pitch if frame.voiced and frame.confidence >= min_confidence]
    notes: list[VocalNote] = []
    segments = list(_segments(frames, max_gap, split_semitones))
    steps = [
        right.time - left.time
        for left, right in zip(frames, frames[1:], strict=False)
        if 0 < right.time - left.time <= max_gap
    ]
    hop = median(steps) if steps else min(max_gap, 0.01)
    for index, segment in enumerate(segments):
        start = segment[0].time
        end = segment[-1].time + hop
        if index + 1 < len(segments):
            end = min(end, segments[index + 1][0].time)
        if end - start < min_note:
            continue
        midi = round(median(hz_to_midi(frame.frequency) for frame in segment))
        owner = _owner(words or [], (start + end) / 2, word_boundary_tolerance)
        if owner is None:
            continue
        notes.append(VocalNote(start, end, midi, word_index=owner.index))
    return notes


def build_game_notes(*args, **kwargs):
    return build_vocal_notes(*args, **kwargs)


def get_note_diagnostics() -> dict:
    return {}
