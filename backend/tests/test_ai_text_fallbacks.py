from __future__ import annotations

import numpy as np
import pytest

from AI.engines import text
from AI.models import Word


def words(*rows):
    return [
        Word(start, end, token, confidence, index)
        for index, (start, end, token, confidence) in enumerate(rows)
    ]


def test_grouping_activity_quantiles_and_long_segments(monkeypatch):
    assert text._group_lyric_text("") == []
    assert text._group_lyric_text("one\ntwo") == ["one", "two"]
    assert text._group_lyric_text("!!!") == []
    assert text._group_lyric_text("one two", 3) == ["one two"]
    assert text._group_lyric_text("one two three four", 2) == ["one two", "three four"]
    assert text._activity_quantile_times(np.ones(2), 10) == [0, 0.2]
    signal = np.r_[np.zeros(20), np.ones(60), np.zeros(20)]
    assert len(text._activity_quantile_times(signal, 100)) >= 2
    assert text._activity_quantile_times(np.ones(8), 100) == [0, 0.08]
    assert text._activity_quantile_times(np.array([]), 0) == [0, 0]
    monkeypatch.setattr(text, "load_mono", lambda *_: (signal, 100))
    assert text._long_text_segments("audio", "") == []
    segments = text._long_text_segments("audio", "one\ntwo")
    assert len(segments) == 2 and segments[0][0] <= segments[0][1]


@pytest.mark.parametrize(
    "candidate",
    [
        [],
        words((0, 10, "word", 1)),
        words((0, 0.01, "a", 1), (0.01, 0.02, "b", 1), (0.02, 0.03, "c", 1)),
        words((0, 0.05, "longword", 1)),
        words((0, 1, "a", 1), (0.5, 1.5, "b", 1), (0.4, 2, "c", 1)),
        words((0, 0.1, "a", 1), (0.1, 0.2, "b", 1)),
    ],
)
def test_pathological_alignment_cases(candidate):
    assert text._pathological_alignment(candidate, 10)
    healthy = words((0, 0.5, "one", 1), (0.5, 1, "two", 1))
    assert not text._pathological_alignment(healthy, 2)


def test_proportional_and_vocal_regions():
    result = text._proportional_words(["a", "long"], 1)
    assert result[0].start == 0 and result[-1].end == 1
    assert text._vocal_activity_regions(np.ones(2), 100) == []
    signal = np.r_[np.zeros(20), np.ones(30), np.zeros(50), np.ones(30), np.zeros(20)]
    regions = text._vocal_activity_regions(signal, 100, join_gap=0.1)
    assert len(regions) >= 1

    # Flush a still-open region at EOF.
    tail = np.r_[np.zeros(80), np.ones(120)]
    assert text._vocal_activity_regions(tail, 100)


def test_activity_fallback_modes(monkeypatch):
    tokens = ["one", "two"]
    audio = np.ones(100)
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [])
    assert len(text._activity_fallback_words(tokens, audio, 100)) == 2
    regions = [(0, 0.2), (0.3, 0.5), (3, 3.3)]
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: regions)
    assert text._activity_fallback_words(tokens, audio, 100, minimum_start=5)
    assert len(text._activity_fallback_words(["x"] * 10, audio, 100)) == 10
    hint = words((0.3, 0.4, "one", 1))
    assert len(text._activity_fallback_words(["one"], audio, 100, hint)) == 1
    assert len(text._activity_fallback_words(tokens, audio, 100, hint)) == 2
    far_hint = words((3.1, 3.2, "one", 1), (3.2, 3.3, "two", 1))
    assert (
        text._activity_fallback_words(["one", "two", "three", "four"], audio, 100, far_hint)[
            0
        ].start
        >= 3
    )
    assert len(text._activity_fallback_words(tokens, audio, 100)) == 2
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(1, 1.01)])
    assert text._activity_fallback_words(tokens, audio, 100)[0].start == 1

    # Floating-point exhaustion reaches the defensive tail of the active-time map.
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0, 0.1)])
    assert text._activity_fallback_words(["a", "b"], audio, 100)[-1].end >= 0.1

    connected = [(0, 0.2), (1.5, 1.7), (3.0, 3.2)]
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: connected)
    clipped = text._activity_fallback_words(["one"], audio, 100, words((0.1, 0.2, "one", 1)))
    assert clipped[-1].end <= 1.2

    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0, 1), (2, 3)])
    after = text._activity_fallback_words(tokens, audio, 100, minimum_start=2.5)
    assert after[0].start >= 2.5


def test_segment_alignment_validation():
    valid = words((0, 0.5, "one", 1), (0.5, 1, "two", 1))
    assert text._segment_alignment_is_usable(valid, ["one", "two"], 1)
    assert not text._segment_alignment_is_usable([], ["one"], 1)
    assert not text._segment_alignment_is_usable(valid, ["one"], 1)
    assert not text._segment_alignment_is_usable(valid, ["one", "two"], 0)
    assert not text._segment_alignment_is_usable(words((0, 1, "one two", 1)), ["one"], 1)
    assert not text._segment_alignment_is_usable(valid, ["other", "two"], 1)
    assert not text._segment_alignment_is_usable(words((0, 1.1, "one", 1)), ["one"], 1)
    assert not text._segment_alignment_is_usable(
        words((0.5, 0.8, "one", 1), (0.1, 0.4, "two", 1)), ["one", "two"], 1
    )
    assert not text._segment_alignment_is_usable(
        words((0, 0.3, "one", 1), (0.5, 0.8, "two", 1), (0.3, 1.2, "three", 1)),
        ["one", "two", "three"],
        1.2,
    )


def test_duration_and_timing_profiles():
    assert text._minimum_sung_phrase_duration([]) == 0
    assert text._expected_sung_phrase_duration([]) == 0.5
    assert text._minimum_sung_phrase_duration(["one"]) > 0
    assert text._expected_sung_phrase_duration(["one"]) >= 0.65
    assert text._clamp_timing(5, 0, 1) == 1
    profile = text._line_timing_profile(["one", "two"])
    assert profile["search_window"] >= profile["minimum_window"]
    assert text._lrc_window_is_plausible(["one"], 10)


def test_segmented_timing_safety_valid_rebuild_and_tail():
    original = words((0, 0.5, "one", 1), (0.5, 1, "two", 1))
    segments = [(0, 1, "one two")]
    safe = text.enforce_segmented_timing_safety(original, segments, 2)
    assert [word.text for word in safe] == ["one", "two"]
    broken = words((0, 0.01, "one", 1), (0.01, 0.02, "two", 1))
    rebuilt = text.enforce_segmented_timing_safety(broken, segments, 2)
    assert rebuilt[-1].end > 0.02
    assert text.enforce_segmented_timing_safety([], segments, 2) == []
    assert text.enforce_segmented_timing_safety(original, [], 2) == original
    partial = text.enforce_segmented_timing_safety(original, [(0, 1, "one")], 2)
    assert len(partial) == 2
    mismatch = text.enforce_segmented_timing_safety(original[:1], [(0, 1, "one two")], 2)
    assert mismatch
    clipped = text.enforce_segmented_timing_safety(words((0.49, 1, "one", 1)), [(0, 1, "one")], 0.5)
    assert clipped[0].confidence == 0.03


def test_line_fallbacks_and_speech_focus(monkeypatch):
    assert text._timed_segment_fallback_words([], 1) == []
    assert len(text._timed_segment_fallback_words(["one", "two"], 10)) == 2
    assert text._long_text_line_fallback([], 1) == []
    candidate = words((0.5, 0.6, "one", 1))
    assert text._long_text_line_fallback(["one"], 2, candidate_words=candidate)[0].start == 0.5
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0.4, 0.8)])
    fallback = text._long_text_line_fallback(["one"], 2, audio=np.ones(100), sample_rate=100)
    assert fallback[0].start == 0.4
    short = np.array([1, 2], dtype=np.float32)
    assert text._speech_focus_variant(short) is short
    focused = text._speech_focus_variant(np.arange(10, dtype=np.float32))
    assert focused.shape == (10,)


def test_transcript_scoring_selection_and_cleanup():
    assert text._script_ratio("123", "en") == 0
    assert text._script_ratio("hello", "en") == 1
    assert text._script_ratio("hello", None) == 1
    assert text._script_ratio("привет", "ru") == 1
    assert text._transcript_quality("", 1, "en") == 0
    assert text._transcript_quality("one", 100, "en") < 1
    assert text._transcript_quality(" ".join(["x"] * 30), 1, "en") < 1
    assert text._transcript_quality("x" * 40, 1, "en") < 1
    assert text._transcript_quality("a a a a", 2, "en") < 1
    assert text._candidate_agreement("", ["a"]) == 0
    assert text._candidate_agreement("one", ["one"]) == 0
    assert text._candidate_agreement("one two", ["one two", ""]) == 0
    assert text._candidate_agreement("one two", ["one two", "one too"]) > 0
    assert text._select_candidate([], 1, "en") == ""
    assert text._select_candidate(["one", "one two"], 1, "en")
    repeated = "one two three " * 3
    assert text._clean_transcript_part(repeated).split() == ["one", "two", "three"]
    assert text._clean_transcript_part("") == ""


def test_overlap_merge_and_language_consensus():
    assert text._trim_transcript_overlaps(["one two", "two three", ""])[1] == "three"
    assert text._trim_transcript_overlaps(["one two", "one two"])[1] == ""
    assert text._trim_transcript_overlaps(["hello world", "hallo world"])[1] == ""
    assert text._merge_transcript_parts(["one two", "two three"]) == "one two three"
    assert text._majority_language([], "ru") == "Russian"
    assert text._majority_language(["en", "en", "ru"], None) == "English"
    assert text._majority_language([], None) is None
    assert text._consensus_language([], [], "uk") == "Ukrainian"
    assert text._consensus_language(["українська ї " * 10], [], None) == "Ukrainian"
    assert text._consensus_language(["русский текст " * 10], [], None) == "Russian"
    assert text._consensus_language(["english words " * 10], [], None) == "English"
    assert text._consensus_language(["x"], ["fr"], None) == "French"


def test_low_confidence_regions_and_uniform_fallback(monkeypatch):
    assert text._low_confidence_regions([]) == []
    zero = words((0, 1, "one", 0))
    assert text._low_confidence_regions(zero) == []
    mixed = words(
        (0, 1, "one", 0.01),
        (1, 2, "two", 0.01),
        (2, 3, "three", 0.8),
        (3, 4, "four", 0.01),
    )
    regions = text._low_confidence_regions(mixed)
    assert len(regions) == 2 and regions[0]["words"] == 2
    fallback = text.UniformTextFallback()
    assert fallback.transcribe("audio", None) == ("", [])
    monkeypatch.setattr(text, "duration", lambda _: 2)
    assert fallback.align("audio", "", None) == []
    aligned = fallback.align("audio", "one longer", None)
    assert aligned[0].start == 0 and aligned[-1].end == 2
