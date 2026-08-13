from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from AI.engines import text
from AI.models import Word


@pytest.mark.parametrize(
    ("language", "sample", "expected"),
    [
        ("ru", "", "Russian"),
        ("Custom", "", "Custom"),
        (None, "українська ї", "Ukrainian"),
        (None, "русский", "Russian"),
        (None, "hello", "English"),
        (None, "中文", "Chinese"),
        (None, "かな", "Japanese"),
        (None, "한국", "Korean"),
        (None, "123", "Russian"),
    ],
)
def test_language_resolution(language, sample, expected):
    assert text.resolve_alignment_language(sample, language) == expected


def test_language_name_and_result_unwrapping():
    assert text._language_name(None) is None
    assert text._language_name(" ") is None
    assert text._first({"x": 1}, ("x",)) == 1
    assert text._first(SimpleNamespace(y=2), ("x", "y")) == 2
    assert text._first({}, ("x",), 3) == 3
    assert text._unwrap_single_result(("hello", [1])) == {"text": "hello", "time_stamps": [1]}
    assert text._unwrap_single_result([{"text": "x"}]) == {"text": "x"}
    assert text._unwrap_single_result(None) is None
    assert text._unwrap_items({"words": [[1, 2, "x"]]}) == [1, 2, "x"]
    assert text._unwrap_items({"segments": [1]}) == [1]
    assert text._unwrap_items(iter([1, 2]))
    assert text._unwrap_items("plain") == []


def test_words_from_item_shapes_and_invalid_rows():
    items = [
        {"text": "one", "start": 0, "end": 1, "confidence": 2},
        ("two", 1, 2, -1),
        (2, 3, "three", 0.5),
        {"text": "missing"},
    ]
    words = text._words_from_items(items)
    assert [word.text for word in words] == ["one", "two", "three"]
    assert [word.confidence for word in words] == [1, 0, 0.5]


def test_audio_normalization_and_chunks():
    assert text._normalize_singing_audio(np.array([], dtype=np.float32)).size == 0
    assert not np.any(text._normalize_singing_audio(np.zeros(10, dtype=np.float32)))
    normalized = text._normalize_singing_audio(np.array([-0.01, 0.02] * 100, dtype=np.float32))
    assert normalized.flags.c_contiguous and np.max(np.abs(normalized)) <= 0.94
    assert text._singing_chunk_windows(np.array([], dtype=np.float32), 10) == []
    short = np.ones(100, dtype=np.float32)
    assert len(text._singing_chunk_windows(short, 10)) == 1
    long = np.ones(400, dtype=np.float32)
    long[150:170] = 0
    windows = text._singing_chunk_windows(long, 10, [(0, 40)])
    assert len(windows) >= 2
    assert len(text._singing_chunks(long, 10)) == len(text._singing_chunk_windows(long, 10))


def test_asr_anchor_windows_and_matching():
    assert text._asr_line_anchor_windows([], []) == {}
    assert text._asr_line_anchor_windows(["one"], []) == {}
    anchors = text._asr_line_anchor_windows(
        ["one two", "three"],
        [(2, 1, ""), (0, 2, "one two"), (2, 3, "three")],
    )
    assert set(anchors) == {0, 1} and anchors[0][2] == 1
    assert not text._canonical_words_match([], ["one"])
    assert text._canonical_words_match([Word(0, 1, "One!", index=0)], ["one"])


def test_complete_anchor_windows_branches(monkeypatch):
    groups = ["same line", "same line", "unique words"]
    source = np.ones(100, dtype=np.float32)
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: [])
    raw = {0: (0, 1, 0.5)}
    assert text._complete_line_anchor_windows(groups, raw, source, 10, 10)[0] == raw
    baseline = [
        Word(0, 1, "same", index=0),
        Word(1, 2, "line", index=1),
        Word(3, 4, "same", index=2),
        Word(4, 5, "line", index=3),
        Word(6, 7, "unique", index=4),
        Word(7, 8, "words", index=5),
    ]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        groups,
        {0: (8, 9, 0.9), 1: (3, 5, 0.5), 2: (6.2, 8, 0.9)},
        source,
        10,
        10,
    )
    assert len(completed) == 3
    assert provenance[0].startswith("vocal_baseline")
    assert provenance[2] == "asr_unique"


def test_lossless_canonical_alignment_branches(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    assert text._lossless_canonical_alignment([], source, 100, 10) == []
    assert text._lossless_canonical_alignment(["one"], source, 100, 0.01) == []
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [5, 5.01])
    result = text._lossless_canonical_alignment(["one two", "three"], source, 100, 10)
    assert [word.text for word in result] == ["one", "two", "three"]
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0, 1), (3, 4)])
    result = text._lossless_canonical_alignment(["one", "two"], source, 100, 10)
    assert result[1].start > result[0].end
    short = text._lossless_canonical_alignment(["one two three four"], source, 100, 0.5)
    assert len(short) == 4


def test_atomic_line_alignment_interpolation_ctc_and_qwen(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    empty, stats = text._atomic_line_acoustic_alignment([], [], [], source, 100, 10)
    assert empty == [] and stats["lines"] == 0
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0, 10)])
    interpolated, stats = text._atomic_line_acoustic_alignment(
        ["one two", "three"], [], [], source, 100, 10
    )
    assert len(interpolated) == 3 and stats["interpolated"] == 3

    ctc_result = SimpleNamespace(
        words=(Word(1, 1.5, "one", 0.9), Word(1.5, 2, "two", 0.9, 1)),
        confidence=0.9,
    )
    aligned, stats = text._atomic_line_acoustic_alignment(
        ["one two", "three"], [ctc_result, None], [], source, 100, 10
    )
    assert len(aligned) == 3 and stats["ctc"] == 2

    qwen = [Word(1, 1.5, "one", 0.8), Word(1.5, 2, "two", 0.8, 1)]
    aligned, stats = text._atomic_line_acoustic_alignment(
        ["one two", "three"], [], qwen, source, 100, 10
    )
    assert len(aligned) == 3 and stats["qwen"] == 2


def test_atomic_rejects_invalid_ctc_candidates(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    invalid = [
        None,
        SimpleNamespace(words=(), confidence=1),
        SimpleNamespace(words=(Word(0, 1, "wrong"),), confidence=1),
        SimpleNamespace(words=(Word(0, 0.01, "one"),), confidence=1),
    ]
    aligned, stats = text._atomic_line_acoustic_alignment(["one"], invalid, [], source, 100, 10)
    assert aligned and stats["ctc"] == 0


@pytest.mark.parametrize(
    "function",
    [text._line_aware_canonical_alignment, text._anchor_preserving_canonical_alignment],
)
def test_canonical_mergers_empty_and_interpolated(monkeypatch, function):
    source = np.ones(1000, dtype=np.float32)
    assert function([], [], [], source, 100, 10)[0] == []
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: [(0, 10)])
    output, stats = function(["one two", "three four"], [], [], source, 100, 10)
    if function is text._anchor_preserving_canonical_alignment:
        assert output == []
    else:
        assert [word.text for word in output] == ["one", "two", "three", "four"]
        assert stats["interpolated"] == 4


@pytest.mark.parametrize(
    "function",
    [text._line_aware_canonical_alignment, text._anchor_preserving_canonical_alignment],
)
def test_canonical_mergers_keep_acoustic_candidates(monkeypatch, function):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    ctc_result = SimpleNamespace(
        words=(Word(1, 1.5, "one", 0.9), Word(1.5, 2, "two", 0.9, 1)),
        confidence=0.9,
    )
    qwen = [Word(5, 5.5, "three", 0.8), Word(5.5, 6, "four", 0.8, 1)]
    output, stats = function(["one two", "three four"], [ctc_result, None], qwen, source, 100, 10)
    assert len(output) == 4 and stats["ctc"] + stats["qwen"] >= 2
