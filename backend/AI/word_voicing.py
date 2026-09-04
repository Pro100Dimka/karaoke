from __future__ import annotations

from pathlib import Path

from .models import Word

WORD_VOICING_VERSION = "clean-v3"

_FRAME_SECONDS = 0.02
_MAX_SILENCE_GAP = 0.05
_VOWELS = set("аеёиіїоуюяєaeiouy")


def voice_activity_intervals(source: str | Path, frame_seconds: float = _FRAME_SECONDS) -> list[tuple[float, float]]:
    """Find where the vocal track actually has sound, straight from its loudness.

    No model, no pitch detection -- just RMS per short frame against a
    threshold set from the track's own quiet/loud levels (so it adapts to
    each song instead of a fixed number). This deliberately catches
    everything audible, including unpitched onsets/consonants that a pitch
    detector would miss, because a word's real start/end includes those too.
    """
    import numpy as np

    from .audio import read_mono

    mono, rate = read_mono(source)
    frame = max(1, round(rate * frame_seconds))
    usable = len(mono) // frame * frame
    if usable < frame:
        return []
    rms = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1))
    floor = float(np.percentile(rms, 20))
    if floor <= 1e-9:
        nonzero = rms[rms > 1e-9]
        floor = float(np.percentile(nonzero, 10)) if len(nonzero) else 0.0
    threshold = max(floor * 4.0, 1e-4)
    active = rms >= threshold

    # A song's vocal track is tens of thousands of 20ms frames -- stepping
    # through each one in a Python loop just to find where "voiced" flips is
    # pure overhead numpy already does in one vectorized pass. Only the merge
    # step below (folding a rising/falling edge pair into the previous
    # interval when the silence between them is short) still runs in Python,
    # and it iterates the handful of raw voiced *intervals*, not every frame.
    padded = np.concatenate(([False], active, [False]))
    edges = np.diff(padded.astype(np.int8))
    raw_starts = np.flatnonzero(edges == 1)
    raw_ends = np.flatnonzero(edges == -1)

    intervals: list[tuple[float, float]] = []
    for raw_start, raw_end in zip(raw_starts, raw_ends, strict=True):
        start = raw_start * frame / rate
        end = raw_end * frame / rate
        if intervals and start - intervals[-1][1] <= _MAX_SILENCE_GAP:
            intervals[-1] = (intervals[-1][0], end)
        else:
            intervals.append((start, end))
    return intervals


def _owning_interval(word: Word, intervals: list[tuple[float, float]]):
    best, best_overlap = None, 0.0
    for istart, iend in intervals:
        overlap = max(0.0, min(word.end, iend) - max(word.start, istart))
        if overlap > best_overlap:
            best_overlap, best = overlap, (istart, iend)
    return best


def _syllable_weight(text: str) -> float:
    """Estimate how much of a sung phrase a word takes up, from its own text.

    Counts vowel letters as a stand-in for syllable count. This is used
    instead of the aligner's own word-to-word timing ratio when splitting a
    continuous phrase between words, because the aligner can badly
    under-allocate time to a word (its cross-attention timing is not
    trustworthy at that granularity) while syllable count is a direct,
    text-only fact that does not depend on the model at all.
    """
    count = sum(1 for char in text.lower() if char in _VOWELS)
    return float(max(1, count))


def anchor_words_to_voice(words: list[Word], intervals: list[tuple[float, float]], span: float) -> list[Word]:
    """Place each run of words sharing one continuous voice-activity stretch exactly within it.

    vocals.flac is clean enough (after separation, denoise and the
    delay/echo gate) that real voice-activity boundaries are a far more
    reliable pace reference than the aligner's own internal word timing.
    Words are grouped by which single continuous voice-activity interval
    they mostly overlap. A lone word in its own interval is simply clamped
    to that interval's bounds. A group of several words sharing one
    interval (a fast, continuous phrase with no real silence between the
    words) is split between them by estimated syllable count rather than by
    the aligner's original per-word durations, because the aligner can
    squeeze an individual word down to a fraction of its real length while
    still getting the group's overall span roughly right -- preserving
    those bad internal ratios (as a pure proportional rescale would) leaves
    that word just as wrong as before.
    """
    if not intervals or not words:
        return list(words)
    owners = [_owning_interval(word, intervals) for word in words]
    result = list(words)
    index = 0
    total = len(words)
    while index < total:
        end_index = index
        while end_index + 1 < total and owners[end_index + 1] == owners[index] and owners[index] is not None:
            end_index += 1
        owner = owners[index]
        if owner is not None:
            group = words[index:end_index + 1]
            interval_start, interval_end = owner
            interval_span = interval_end - interval_start
            if interval_span > 1e-6:
                if len(group) == 1:
                    word = group[0]
                    result[index] = Word(
                        min(interval_start, span), min(interval_end, span), word.text, word.confidence, word.index
                    )
                else:
                    weights = [_syllable_weight(word.text) for word in group]
                    total_weight = sum(weights)
                    rescaled = []
                    cursor = interval_start
                    for word, weight in zip(group, weights, strict=True):
                        new_start = cursor
                        new_end = cursor + interval_span * weight / total_weight
                        rescaled.append(Word(
                            min(new_start, span), min(new_end, span), word.text, word.confidence, word.index
                        ))
                        cursor = new_end
                    result[index:end_index + 1] = rescaled
        index = end_index + 1
    for position in range(1, len(result)):
        if result[position].start + 1e-6 < result[position - 1].start:
            new_start = min(result[position - 1].start, span)
            new_end = result[position].end if result[position].end > new_start else min(span, new_start + 1e-3)
            word = result[position]
            result[position] = Word(new_start, new_end, word.text, word.confidence, word.index)
    return result
