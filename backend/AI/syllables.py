from __future__ import annotations

import math
import re
from bisect import bisect_left

from .models import PitchFrame, Syllable, Word

VOWELS = frozenset("аеёиоуыэюяіїєaeyuioAEYUIOАЕЁИОУЫЭЮЯІЇЄ")
_WORD_EDGE = re.compile(r"(^[^\w'’ʼ-]+|[^\w'’ʼ-]+$)", re.UNICODE)
SYLLABLE_ALIGNER_VERSION = "acoustic-syllables-v4-adaptive-evidence"


def split_written(word: str) -> list[str]:
    """Split a written Russian/Ukrainian/Latin word into stable display syllables.

    This is intentionally deterministic and conservative. Acoustic boundaries are
    applied later; this function only determines the number and labels of syllables.
    """
    cleaned = _WORD_EDGE.sub("", word.strip())
    if not cleaned:
        return [word] if word else []
    chars = list(cleaned)
    nuclei = [index for index, char in enumerate(chars) if char in VOWELS]
    if len(nuclei) <= 1:
        return [cleaned]

    cuts: list[int] = []
    for left, right in zip(nuclei, nuclei[1:], strict=False):
        consonants = right - left - 1
        # Keep one consonant as the onset of the following syllable; clusters keep
        # all but the first consonant with the following syllable.
        cut = left + 1 if consonants <= 1 else left + 2
        cuts.append(min(right, cut))

    parts: list[str] = []
    start = 0
    for cut in cuts:
        part = "".join(chars[start:cut])
        if part:
            parts.append(part)
        start = cut
    tail = "".join(chars[start:])
    if tail:
        parts.append(tail)
    return parts or [cleaned]


def _frame_slice(
    pitch: list[PitchFrame], times: list[float], start: float, end: float
) -> list[PitchFrame]:
    left = bisect_left(times, start)
    right = bisect_left(times, end + 1e-9, lo=left)
    return pitch[left:right]


def _local_step(frames: list[PitchFrame], span: float, count: int) -> float:
    gaps = [b.time - a.time for a, b in zip(frames, frames[1:], strict=False) if b.time > a.time]
    if gaps:
        median = sorted(gaps)[len(gaps) // 2]
        compact = [gap for gap in gaps if gap <= median * 3.0]
        if compact:
            compact.sort()
            return max(compact[len(compact) // 2], 1e-4)
        return max(median, 1e-4)
    return max(span / max(6, count * 6), 1e-4)


def _boundary_scores(word: Word, frames: list[PitchFrame], count: int) -> list[float]:
    word_span = max(0.0, word.end - word.start)
    if len(frames) < 6 or count <= 1 or word_span <= 0:
        return []
    step = _local_step(frames, word_span, count)
    edge_guard = max(step * 2.0, word_span / max(12.0, count * 8.0))

    candidates: list[tuple[float, float]] = []
    for index in range(2, len(frames) - 2):
        frame = frames[index]
        edge = min(frame.time - word.start, word.end - frame.time)
        if edge <= edge_guard:
            continue
        before = [
            item.frequency
            for item in frames[index - 2 : index]
            if item.voiced and item.frequency > 0
        ]
        after = [
            item.frequency
            for item in frames[index : index + 2]
            if item.voiced and item.frequency > 0
        ]
        jump = 0.0
        if before and after:
            ratio = max(1e-9, (sum(after) / len(after)) / (sum(before) / len(before)))
            jump = abs(12.0 * math.log2(ratio))
        confidence_drop = max(0.0, frames[index - 1].confidence - frame.confidence)
        energy_drop = max(0.0, frames[index - 1].energy - frame.energy)
        voicing_change = 1.0 if frames[index - 1].voiced != frame.voiced else 0.0
        candidates.append((jump, confidence_drop, energy_drop, voicing_change, frame.time))

    if not candidates:
        return []

    # Normalize every acoustic cue against this word itself.  Absolute energy,
    # confidence and pitch-jump scales vary hugely between singers, microphones
    # and separation quality; relative salience inside the current word is the
    # useful signal for a syllable boundary.
    def scale(values: list[float]) -> float:
        positive = sorted(value for value in values if value > 0.0)
        if not positive:
            return 1.0
        return max(positive[len(positive) // 2], positive[-1] * 0.25, 1e-6)

    jump_scale = scale([item[0] for item in candidates])
    confidence_scale = scale([item[1] for item in candidates])
    energy_scale = scale([item[2] for item in candidates])
    ranked: list[tuple[float, float]] = []
    for jump, confidence_drop, energy_drop, voicing_change, timestamp in candidates:
        score = (
            jump / jump_scale
            + confidence_drop / confidence_scale
            + energy_drop / energy_scale
            + voicing_change
        )
        ranked.append((score, timestamp))

    ranked.sort(reverse=True)
    selected: list[float] = []
    minimum_spacing = max(step * 3.0, word_span / (count * 3.0))
    # Keep the strongest well-spaced candidates.  There is deliberately no
    # song-independent absolute score threshold here; the later local search
    # around linguistic expectations decides whether a candidate is useful.
    for _score, timestamp in ranked:
        if all(abs(timestamp - existing) >= minimum_spacing for existing in selected):
            selected.append(timestamp)
        if len(selected) == count - 1:
            break
    return sorted(selected)


def _proportional_bounds(word: Word, parts: list[str]) -> list[float]:
    weights = [max(1, len(part) + 2 * sum(char in VOWELS for char in part)) for part in parts]
    total = sum(weights)
    cursor = 0
    bounds: list[float] = []
    for weight in weights[:-1]:
        cursor += weight
        bounds.append(word.start + (word.end - word.start) * cursor / total)
    return bounds


def _refine_proportional_bounds(
    word: Word, frames: list[PitchFrame], expected: list[float]
) -> list[float]:
    """Snap expected syllable boundaries to nearby acoustic transitions.

    Global top-N peaks can attach the wrong consonant cluster to a syllable.
    Search locally around each linguistic expectation instead, preserving order.
    """
    if not expected or len(frames) < 6:
        return expected
    candidates = _boundary_scores(word, frames, len(expected) + 1)
    if not candidates:
        return expected
    word_span = max(0.0, word.end - word.start)
    step = _local_step(frames, word_span, len(expected) + 1)
    span = max(step * 4.0, word_span / max(3.0, (len(expected) + 1) * 2.2))
    margin = max(step * 2.0, word_span / max(20.0, (len(expected) + 1) * 10.0))
    result = []
    prev = word.start
    for target in expected:
        nearby = [
            value for value in candidates if abs(value - target) <= span and value > prev + margin
        ]
        chosen = min(nearby, key=lambda value: abs(value - target)) if nearby else target
        chosen = max(prev + margin, min(word.end - margin, chosen))
        result.append(chosen)
        prev = chosen
    return result


def align_syllables(words: list[Word], pitch: list[PitchFrame]) -> list[Syllable]:
    ordered_pitch = sorted(pitch, key=lambda frame: frame.time)
    pitch_times = [frame.time for frame in ordered_pitch]
    result: list[Syllable] = []
    syllable_index = 0
    for word in words:
        parts = split_written(word.text)
        if not parts:
            continue
        frames = _frame_slice(ordered_pitch, pitch_times, word.start, word.end)
        expected_bounds = _proportional_bounds(word, parts)
        bounds = _refine_proportional_bounds(word, frames, expected_bounds)
        used_acoustic = any(
            abs(a - b) > 1e-4 for a, b in zip(bounds, expected_bounds, strict=False)
        )
        edges = [word.start, *bounds, word.end]
        confidence = min(1.0, max(0.0, word.confidence) * (0.92 if used_acoustic else 0.58))
        for local_index, part in enumerate(parts):
            start = edges[local_index]
            end = max(start, edges[local_index + 1])
            result.append(Syllable(start, end, part, word.index, syllable_index, confidence))
            syllable_index += 1
    # Forced alignment can produce overlapping word intervals around breaths,
    # repeats and background vocals. Each word is still split independently,
    # but downstream artifacts must be chronological and consistently indexed.
    ordered = sorted(
        result,
        key=lambda item: (item.start, item.end, item.word_index, item.index),
    )
    return [
        Syllable(
            item.start,
            item.end,
            item.text,
            item.word_index,
            index,
            item.confidence,
        )
        for index, item in enumerate(ordered)
    ]
