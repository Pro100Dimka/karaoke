from __future__ import annotations

import math
import re
from bisect import bisect_left

from .models import PitchFrame, Syllable, Word

VOWELS = frozenset("аеёиоуыэюяіїєґaeyuioAEYUIOАЕЁИОУЫЭЮЯІЇЄ")
_WORD_EDGE = re.compile(r"(^[^\w'’ʼ-]+|[^\w'’ʼ-]+$)", re.UNICODE)


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
    for left, right in zip(nuclei, nuclei[1:]):
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


def _frame_slice(pitch: list[PitchFrame], times: list[float], start: float, end: float) -> list[PitchFrame]:
    left = bisect_left(times, start)
    right = bisect_left(times, end + 1e-9, lo=left)
    return pitch[left:right]


def _boundary_scores(word: Word, frames: list[PitchFrame], count: int) -> list[float]:
    if len(frames) < 6 or count <= 1 or word.end - word.start < 0.08:
        return []

    candidates: list[tuple[float, float]] = []
    for index in range(2, len(frames) - 2):
        frame = frames[index]
        edge = min(frame.time - word.start, word.end - frame.time)
        if edge <= 0.035:
            continue
        before = [item.frequency for item in frames[index - 2:index] if item.voiced and item.frequency > 0]
        after = [item.frequency for item in frames[index:index + 2] if item.voiced and item.frequency > 0]
        jump = 0.0
        if before and after:
            ratio = max(1e-9, (sum(after) / len(after)) / (sum(before) / len(before)))
            jump = min(4.0, abs(12.0 * math.log2(ratio)))
        confidence_drop = max(0.0, frames[index - 1].confidence - frame.confidence)
        energy_drop = max(0.0, frames[index - 1].energy - frame.energy)
        voicing_change = 0.8 if frames[index - 1].voiced != frame.voiced else 0.0
        candidates.append((jump + confidence_drop * 1.5 + energy_drop * 8.0 + voicing_change, frame.time))

    candidates.sort(reverse=True)
    selected: list[float] = []
    minimum_spacing = max(0.045, (word.end - word.start) / (count * 3.0))
    for score, timestamp in candidates:
        if score < 0.12:
            break
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
        acoustic_bounds = _boundary_scores(word, frames, len(parts))
        used_acoustic = len(acoustic_bounds) == len(parts) - 1
        bounds = acoustic_bounds if used_acoustic else _proportional_bounds(word, parts)
        edges = [word.start, *bounds, word.end]
        confidence = min(1.0, max(0.0, word.confidence) * (0.92 if used_acoustic else 0.58))
        for local_index, part in enumerate(parts):
            start = edges[local_index]
            end = max(start, edges[local_index + 1])
            result.append(
                Syllable(start, end, part, word.index, syllable_index, confidence)
            )
            syllable_index += 1
    return result
