
from types import SimpleNamespace

import numpy as np
import pytest

from AI.engines import text
from AI.models import Word
from tests._shared import alignment_result, patch_attrs


def anchor_merge(
    groups,
    ctc_lines=(),
    qwen_words=(),
    source=None,
    sample_rate=100,
    duration_sec=10,
    anchor_windows=None,
    *,
    relaxed_gap_fit=False,
    debug_out=None,
):
    return text._anchor_preserving_canonical_alignment(groups, ctc_lines, qwen_words, np.ones(1000, dtype=np.float32) if source is None else source, sample_rate, duration_sec, anchor_windows, relaxed_gap_fit=relaxed_gap_fit, debug_out=debug_out)


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
    assert (text._language_name(None) is None) and (text._language_name(' ') is None) and (text._first({'x': 1}, ('x',)) == 1) and (text._first(SimpleNamespace(y=2), ('x', 'y')) == 2) and (text._first({}, ('x',), 3) == 3) and (text._unwrap_single_result(('hello', [1])) == {'text': 'hello', 'time_stamps': [1]}) and (text._unwrap_single_result([{'text': 'x'}]) == {'text': 'x'}) and (text._unwrap_single_result(None) is None) and (text._unwrap_items({'words': [[1, 2, 'x']]}) == [1, 2, 'x']) and (text._unwrap_items({'segments': [1]}) == [1]) and (text._unwrap_items(iter([1, 2]))) and (text._unwrap_items('plain') == [])


def test_words_from_item_shapes_and_invalid_rows():
    items = [
        {"text": "one", "start": 0, "end": 1, "confidence": 2},
        ("two", 1, 2, -1),
        (2, 3, "three", 0.5),
        {"text": "missing"},
    ]
    words = text._words_from_items(items)
    assert ([word.text for word in words], [word.confidence for word in words]) == (['one', 'two', 'three'], [1, 0, 0.5])


def test_audio_normalization_and_chunks():
    assert (text._normalize_singing_audio(np.array([], dtype=np.float32)).size == 0) and (not np.any(text._normalize_singing_audio(np.zeros(10, dtype=np.float32))))
    normalized = text._normalize_singing_audio(np.array([-0.01, 0.02] * 100, dtype=np.float32))
    assert (normalized.flags.c_contiguous and np.max(np.abs(normalized)) <= 0.94) and (text._singing_chunk_windows(np.array([], dtype=np.float32), 10) == [])
    short = np.ones(100, dtype=np.float32)
    assert len(text._singing_chunk_windows(short, 10)) == 1
    long = np.ones(400, dtype=np.float32)
    long[150:170] = 0
    windows = text._singing_chunk_windows(long, 10, [(0, 40)])
    assert (len(windows) >= 2)


def test_asr_anchor_windows_and_matching():
    assert (text._asr_line_anchor_windows([], []) == {}) and (text._asr_line_anchor_windows(['one'], []) == {})
    anchors = text._asr_line_anchor_windows(
        ["one two", "three"],
        [(2, 1, ""), (0, 2, "one two"), (2, 3, "three")],
    )
    assert (set(anchors) == {0, 1} and anchors[0][2] == 1) and (text._asr_line_anchor_windows(['!!!'], [(0, 1, 'one')]) == {})
    partial = text._asr_line_anchor_windows(["one", "missing"], [(0, 1, "one")])
    assert (set(partial) == {0}) and (not text._canonical_words_match([], ['one'])) and (text._canonical_words_match([Word(0, 1, 'One!', index=0)], ['one']))


def test_complete_anchor_windows_branches(monkeypatch):
    groups, source = ['same line', 'same line', 'unique words'], np.ones(100, dtype=np.float32)
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
    assert (len(completed) == 3) and (provenance[0].startswith('vocal_baseline')) and (provenance[2] == 'asr_unique')


def test_complete_anchor_windows_missing_blended_and_repaired(monkeypatch):
    source = np.ones(100, dtype=np.float32)
    assert text._complete_line_anchor_windows([], {}, source, 10, 10) == ({}, {})

    patch_attrs(monkeypatch, text, _lossless_canonical_alignment=lambda *_: [Word(0, 1, 'one'), Word(2, 3, 'two', index=1)])
    completed, provenance = text._complete_line_anchor_windows(
        ["one", "two", "three"], {1: (2.1, 3.1, 0.8), 2: (4, 5, 0.6)}, source, 10, 10
    )
    assert (provenance, completed[2]) == ({0: 'vocal_baseline', 1: 'asr_unique', 2: 'asr'}, (4, 5, 0.6))

    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: [Word(1, 2, "one")])
    completed, provenance = text._complete_line_anchor_windows(
        ["", "one", "missing"], {}, source, 10, 10
    )
    assert set(completed) == {1} and provenance[1] == "vocal_baseline"

    baseline = [
        Word(0, 1, "same"),
        Word(1, 2, "words", index=1),
        Word(3, 4, "same", index=2),
        Word(4, 5, "words", index=3),
    ]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        ["same words", "same words"],
        {0: (0.2, 1.8, 0.5), 1: (3.2, 4.8, 0.5)},
        source,
        10,
        10,
    )
    assert (provenance == {0: 'asr_vocal_blend', 1: 'asr_vocal_blend'}) and (completed[0][1] <= completed[1][0] + 1)


def test_complete_anchor_windows_degenerate_observation(monkeypatch):
    source, baseline = np.ones(100, dtype=np.float32), [Word(20, 21, 'same'), Word(22, 23, 'same', index=1)]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        ["same", "same"], {0: (20, 20, 1), 1: (22, 22, 1)}, source, 10, 10
    )
    assert (set(completed) == {0, 1}) and (all(value.startswith('vocal_baseline') for value in provenance.values()))

    baseline = [Word(20, 21, "same"), Word(22, 23, "same", index=1)]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        ["same", "same"], {0: (14.5, 15.5, 1), 1: (15.5, 16.5, 1)}, source, 10, 10
    )
    assert all(value.startswith("vocal_baseline") for value in provenance.values())


def test_complete_anchor_windows_subphrases_and_monotonic_repair(monkeypatch):
    source, baseline = np.ones(100, dtype=np.float32), [Word(0, 1, 'one'), Word(2, 3, 'one', index=1), Word(3, 4, 'two', index=2)]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        ["one", "one two"], {0: (0.2, 1.2, 0.5)}, source, 10, 10
    )
    assert provenance[0] == "asr_vocal_blend" and provenance[1] == "vocal_baseline"

    baseline = [Word(0, 1, "first"), Word(2, 3, "second", index=1)]
    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: baseline)
    completed, provenance = text._complete_line_anchor_windows(
        ["first", "second"], {0: (8, 9, 1), 1: (1, 2, 1)}, source, 10, 10
    )
    assert any(value == "vocal_baseline_monotonic_repair" for value in provenance.values())


def test_lossless_canonical_alignment_branches(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    assert (text._lossless_canonical_alignment([], source, 100, 10) == []) and (text._lossless_canonical_alignment(['one'], source, 100, 0.01) == [])
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [5, 5.01])
    result = text._lossless_canonical_alignment(["one two", "three"], source, 100, 10)
    assert [word.text for word in result] == ["one", "two", "three"]
    patch_attrs(monkeypatch, text, _activity_quantile_times=lambda *_: [0, 10], _vocal_activity_regions=lambda *_a, **_k: [(0, 1), (3, 4)])
    result = text._lossless_canonical_alignment(["one", "two"], source, 100, 10)
    assert result[1].start > result[0].end
    short = text._lossless_canonical_alignment(["one two three four"], source, 100, 0.5)
    assert len(short) == 4
    degenerate = text._lossless_canonical_alignment(["one"] * 10, source, 100, 0.05)
    assert len(degenerate) == 10


def test_lossless_canonical_alignment_weights_vowels_not_just_length(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 9])
    result = text._lossless_canonical_alignment(["я тьмы"], source, 100, 9)
    assert [word.text for word in result] == ["я", "тьмы"]
    span = result[1].end - result[0].start
    assert (result[0].end - result[0].start == pytest.approx(span * 3 / 9)) and (result[1].end - result[1].start == pytest.approx(span * 6 / 9))


def test_atomic_line_alignment_interpolation_ctc_and_qwen(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    empty, stats = text._atomic_line_acoustic_alignment([], [], [], source, 100, 10)
    assert empty == [] and stats["lines"] == 0
    patch_attrs(monkeypatch, text, _activity_quantile_times=lambda *_: [0, 10], _vocal_activity_regions=lambda *_a, **_k: [(0, 10)])
    interpolated, stats = text._atomic_line_acoustic_alignment(
        ["one two", "three"], [], [], source, 100, 10
    )
    assert len(interpolated) == 3 and stats["interpolated"] == 3

    ctc_result = alignment_result((Word(1, 1.5, 'one', 0.9), Word(1.5, 2, 'two', 0.9, 1)), 0.9)
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
        alignment_result((), 1),
        alignment_result((Word(0, 1, 'wrong'),), 1),
        alignment_result((Word(0, 0.01, 'one'),), 1),
        alignment_result((SimpleNamespace(start=float('nan'), end=1, text='one', confidence=1),), 1),
    ]
    aligned, stats = text._atomic_line_acoustic_alignment(["one"], invalid, [], source, 100, 10)
    assert aligned and stats["ctc"] == 0

    for result in invalid[1:]:
        aligned, stats = text._atomic_line_acoustic_alignment(
            ["one"], [result], [], source, 100, 10
        )
        assert aligned and stats["ctc"] == 0

    overlap, tiny = alignment_result((Word(1, 2, 'one'), Word(1.5, 2.5, 'two', index=1)), 1), alignment_result((Word(1, 1.03, 'one'), Word(1.03, 1.06, 'two', index=1)), 1)
    for result in (overlap, tiny):
        aligned, stats = text._atomic_line_acoustic_alignment(
            ["one two"], [result], [], source, 100, 10
        )
        assert aligned and stats["ctc"] == 0


def test_atomic_rejects_invalid_qwen_and_prunes_edges(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 10])
    invalid_qwen = [
        Word(1, 2, "one"),
        Word(1.5, 2.5, "two", index=1),
        Word(5, 5.02, "three", index=2),
        Word(5.02, 5.04, "four", index=3),
    ]
    aligned, stats = text._atomic_line_acoustic_alignment(
        ["one two", "three four"], [], invalid_qwen, source, 100, 10
    )
    assert len(aligned) == 4 and stats["qwen"] == 0

    for candidate in (Word(0, 0.4, "one"), Word(9.6, 10, "one")):
        ctc = [None, alignment_result((candidate,), 0.9), None]
        aligned, stats = text._atomic_line_acoustic_alignment(
            ["zero", "one", "two"], ctc, [], source, 100, 10
        )
        assert len(aligned) == 3 and stats["ctc"] == 0


def test_atomic_short_song_uses_physical_baseline(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 0.05])
    aligned, stats = text._atomic_line_acoustic_alignment(["one"] * 10, [], [], source, 100, 0.05)
    assert len(aligned) == 10 and stats["interpolated"] == 10

    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: [])
    aligned, stats = text._atomic_line_acoustic_alignment(["one"] * 10, [], [], source, 100, 0.05)
    assert aligned == [] and stats["line_fallbacks"] == 10


@pytest.mark.parametrize("confidences", [(0.1, 0.9), (0.9, 0.1)])
def test_atomic_prunes_both_impossible_edges(monkeypatch, confidences):
    source = np.ones(100, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, 1])
    ctc = [
        None,
        alignment_result((Word(0.25, 0.45, 'one', confidences[0]),), confidences[0]),
        alignment_result((Word(0.55, 0.75, 'two', confidences[1]),), confidences[1]),
        None,
    ]
    aligned, stats = text._atomic_line_acoustic_alignment(
        ["zero", "one", "two", "three"], ctc, [], source, 100, 1
    )
    assert len(aligned) == 4 and stats["ctc"] <= 1


@pytest.mark.parametrize(
    "function",
    [text._line_aware_canonical_alignment, text._anchor_preserving_canonical_alignment],
)
def test_canonical_mergers_empty_and_interpolated(monkeypatch, function):
    source = np.ones(1000, dtype=np.float32)
    assert function([], [], [], source, 100, 10)[0] == []
    patch_attrs(monkeypatch, text, _activity_quantile_times=lambda *_: [0, 10], _vocal_activity_regions=lambda *_a, **_k: [(0, 10)])
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
    ctc_result, qwen = alignment_result((Word(1, 1.5, 'one', 0.9), Word(1.5, 2, 'two', 0.9, 1)), 0.9), [Word(5, 5.5, 'three', 0.8), Word(5.5, 6, 'four', 0.8, 1)]
    output, stats = function(["one two", "three four"], [ctc_result, None], qwen, source, 100, 10)
    assert len(output) == 4 and stats["ctc"] + stats["qwen"] >= 2


@pytest.mark.parametrize("relaxed", [False, True])
def test_anchor_merger_partial_consensus_and_interpolation(relaxed):
    source, ctc_lines, qwen, debug = np.ones(1000, dtype=np.float32), [alignment_result((Word(1, 1.5, 'one', 0.8),), 0.8), None], [Word(1.05, 1.45, 'one', 0.9, 0), Word(5, 5.5, 'three', 0.8, 2)], {}
    output, stats = anchor_merge(['one two', 'three four'], ctc_lines, qwen, source, relaxed_gap_fit=relaxed, debug_out=debug)
    assert ([word.text for word in output] == ['one', 'two', 'three', 'four']) and (stats['ctc'] + stats.get('consensus', 0) >= 1 and stats['interpolated'] == 2) and (len(debug['word_sources']) == 4)


def test_anchor_merger_rejects_bad_or_remote_evidence():
    source, ctc_lines, debug = np.ones(1000, dtype=np.float32), [alignment_result((Word(8, 8.5, 'one', 0.8), Word(8.5, 9, 'two', 0.8, 1)), 0.8)], {}
    output, stats = anchor_merge(['one two'], ctc_lines, [Word(0, 0.01, 'one', 0.9), Word(20, 21, 'two', 0.9, 1)], source, anchor_windows={0: (0, 1, 1)}, debug_out=debug)
    assert (output == [] or [word.text for word in output] == ['one', 'two']) and (debug.get('rejected_reasons'))


def test_anchor_merger_candidate_validation_and_debug(monkeypatch):
    source, debug, invalid = np.ones(1000, dtype=np.float32), {}, alignment_result((SimpleNamespace(start=float('nan'), end=1, text='one', confidence=1), SimpleNamespace(start=1, end=1.005, text='two', confidence=1)), 1)
    output, _ = anchor_merge(['one two'], [invalid], [], source, debug_out=debug)
    assert (output, debug['failure_reason'], debug['rejected_reasons']) == ([], 'no_valid_acoustic_candidates', {'non_finite_timestamp': 1, 'micro_or_negative_span': 1})

    empty = alignment_result((), 1)
    output, _ = anchor_merge(['one'], [empty], [Word(1, 2, 'one', 0.8)], source)
    assert [word.text for word in output] == ["one"]


def test_anchor_merger_rejects_collapsed_ctc_word_anchor():
    source, debug = np.ones(1000, dtype=np.float32), {}
    ctc = [alignment_result((Word(1.0, 1.02, "a", 0.99),), 0.99)]

    output, _ = anchor_merge(["a"], ctc, [], source, debug_out=debug)

    assert output == []
    assert debug["failure_reason"] == "no_duration_valid_candidates"
    assert debug["rejected_reasons"]["collapsed_acoustic_anchor"] == 1


def test_anchor_merger_temporal_agreement_and_qwen_replacement():
    source, ctc = np.ones(1000, dtype=np.float32), [alignment_result((Word(1, 2, 'one', 0.2),), 0.2)]
    agreed, stats = anchor_merge(['one'], ctc, [Word(2.01, 2.2, 'one', 0.9)], source)
    assert len(agreed) == 1 and stats.get("consensus") == 1

    replaced, stats = anchor_merge(['one'], ctc, [Word(3, 3.4, 'one', 0.9)], source)
    assert len(replaced) == 1 and stats["qwen"] == 1


def test_anchor_merger_relaxed_qwen_filters():
    source, debug = np.ones(1000, dtype=np.float32), {}
    output, _ = anchor_merge(['one'], [], [Word(1, 1.01, 'one', 0.9)], source, relaxed_gap_fit=True, debug_out=debug)
    assert (output, debug['rejected_reasons']['weak_qwen_micro_anchor']) == ([], 1)

    debug = {}
    output, _ = anchor_merge(['zero one two'], [], [Word(0, 0.2, 'one', 0.9, 1)], source, 100, 1, relaxed_gap_fit=True, debug_out=debug)
    assert (output, debug['rejected_reasons']['weak_qwen_edge_capacity']) == ([], 1)


@pytest.mark.parametrize("confidences", [(0.1, 0.9), (0.9, 0.1), (0.5, 0.5)])
def test_anchor_merger_nudges_tight_boundaries(confidences):
    source, words = np.ones(1000, dtype=np.float32), (Word(1, 1.5, 'one', confidences[0]), Word(1.45, 2, 'two', confidences[1], 1))
    output, stats = anchor_merge(['one two'], [alignment_result(words, 0)], [], source)
    assert len(output) == 2 and stats["ctc"] == 2


def test_anchor_merger_balances_unequal_equal_priority_trim():
    source, words = np.ones(1000, dtype=np.float32), (Word(1, 1.08, 'one', 0.5), Word(1.0, 2, 'two', 0.5, 1))
    output, stats = anchor_merge(['one two'], [alignment_result(words, 0)], [], source)
    assert len(output) == 2 and stats["ctc"] == 2

    words = (
        Word(1, 1.5, "one", 0.5),
        Word(1.45, 1.51, "two", 0.5, 1),
    )
    output, stats = anchor_merge(['one two'], [alignment_result(words, 0)], [], source)
    assert len(output) == 2 and stats["ctc"] == 2


def test_anchor_merger_relaxed_chain_rejects_overlapping_candidate():
    output, stats = anchor_merge(['one two'], [alignment_result((Word(1, 2, 'one', 0.9),), 0.9)], [Word(1.5, 2.5, 'two', 0.8, 1)], relaxed_gap_fit=True)
    assert (len(output) == 2) and (stats['ctc'] + stats['qwen'] == 1)


def test_line_aware_rejects_unrepresentable_micro_words(monkeypatch):
    tokens = " ".join(f"word{i}" for i in range(12))
    monkeypatch.setattr(text, "_activity_fallback_words", lambda *_: [])
    output, stats = text._line_aware_canonical_alignment(
        [tokens], [], [], np.ones(5, dtype=np.float32), 100, 0.05
    )
    assert ([word.text for word in output] == tokens.split()) and (stats['line_fallbacks'] == 1)


@pytest.mark.parametrize(
    "regions",
    [
        [(2, 3), (5, 6)],
        [(2, 2.05)],
        [(2, 2.2), (5, 5.2)],
        [(2, 2.25), (4, 4.25), (6, 7.5)],
    ],
)
def test_anchor_merger_places_missing_run_on_activity_islands(monkeypatch, regions):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_vocal_activity_regions", lambda *_a, **_k: regions)
    ctc = [alignment_result((Word(0.5, 1, 'anchor', 0.9),), 0.9)]
    output, stats = anchor_merge(['anchor one two three four'], ctc, [], source)
    assert (len(output) == 5 and stats['interpolated'] == 4) and (output == sorted(output, key=lambda word: word.start))


def test_anchor_merger_falls_back_when_activity_islands_cannot_partition(monkeypatch):
    patch_attrs(monkeypatch, text, _vocal_activity_regions=lambda *_a, **_k: [(2, 2.16), (5, 5.16)])
    ctc = [alignment_result((Word(0.5, 1, 'anchor', 0.9),), 0.9)]
    output, stats = anchor_merge(['anchor a b c'], ctc, [])
    assert len(output) == 4 and stats["interpolated"] == 3


@pytest.mark.parametrize("confidences", [(0.1, 0.9), (0.9, 0.1), (0.5, 0.5)])
def test_anchor_merger_drops_weaker_untrimmable_same_source(confidences):
    source, ctc = np.ones(1000, dtype=np.float32), [alignment_result((Word(1, 1.06, 'one', confidences[0]), Word(1.0, 1.06, 'two', confidences[1], 1)), 0)]
    output, stats = anchor_merge(['one two'], ctc, [], source)
    assert len(output) == 2 and stats["ctc"] == 1 and stats["interpolated"] == 1


def test_anchor_merger_reports_text_that_cannot_fit_song():
    debug = {}
    output, stats = anchor_merge(['one two three four five'], [alignment_result((Word(0, 0.06, 'one', 0.9),), 0.9)], [], np.ones(10, dtype=np.float32), 100, 0.1, debug_out=debug)
    assert (output == [] and (not any(stats.values()))) and (debug['failure_reason'] == 'canonical_text_exceeds_song_duration')


def test_anchor_merger_drops_prefix_anchor_without_capacity():
    output, stats = anchor_merge(['one two'], [alignment_result((Word(0.01, 0.08, 'two', 0.9, 1),), 0.9)], [])
    assert len(output) == 2 and stats["interpolated"] == 2


def test_anchor_merger_relaxed_scales_synthetic_word_inside_tight_gap():
    ctc = [
        alignment_result((Word(0.5, 1.0, 'one', 0.9), Word(1.02, 1.52, 'three', 0.9, 2)), 0.9)
    ]
    output, stats = anchor_merge(['one two three'], ctc, [], relaxed_gap_fit=True)
    assert (len(output) == 3 and stats['ctc'] == 2 and (stats['interpolated'] == 1)) and (output[1].end <= output[2].start)


def test_anchor_merger_relaxed_drops_anchor_below_timeline_quantum():
    ctc = [
        alignment_result((Word(0.5, 1.0, 'one', 0.9), Word(1.005, 1.5, 'three', 0.8, 2)), 0.9)
    ]
    output, stats = anchor_merge(['one two three'], ctc, [], relaxed_gap_fit=True)
    assert len(output) == 3 and stats["ctc"] == 1


def test_anchor_merger_reacquires_complete_missing_line(monkeypatch):
    source, ctc = np.ones(1000, dtype=np.float32), [alignment_result((Word(0.5, 1, 'one', 0.9),), 0.9), None, alignment_result((Word(8, 8.5, 'four', 0.9),), 0.9)]
    patch_attrs(monkeypatch, text, _activity_fallback_words=lambda tokens, audio, sample_rate: text._proportional_words(tokens, len(audio) / sample_rate))
    output, stats = anchor_merge(['one', 'two three', 'four'], ctc, [], source, anchor_windows={1: (3, 5, 0.8)})
    assert (len(output) == 4 and stats['reacquired'] == 2) and ([word.confidence for word in output[1:3]] == [pytest.approx(0.24)] * 2)


def test_anchor_conflict_with_reacquired_word_153_drops_real_anchor():
    selected = {
        152: (Word(10, 10.2, "before", 0.8, 152), "ctc", 0.8),
        154: (Word(10.3, 10.5, "after", 0.7, 154), "ctc", 0.7),
    }
    assert (text._weaker_selected_anchor(selected, 153, 154) == 154) and (text._weaker_selected_anchor(selected, 152, 153) == 152)


@pytest.mark.parametrize("mode", ["missing-window", "empty-audio", "wrong-count", "micro"])
def test_anchor_merger_reacquisition_rejects_invalid_windows(monkeypatch, mode):
    sample_rate = 1 if mode == "empty-audio" else 100
    source, ctc, windows = np.ones(10 * sample_rate, dtype=np.float32), [alignment_result((Word(0, 0.2, 'one', 0.9),), 0.9), None, alignment_result((Word(8, 8.2, 'three', 0.9),), 0.9)], {0: (0, 1, 1), 2: (8, 9, 1)}
    if mode == "empty-audio":
        windows[1] = (0.11, 0.31, 1)
    elif mode != "missing-window": windows[1] = (3, 5, 1)
    if mode == "wrong-count":
        monkeypatch.setattr(text, "_activity_fallback_words", lambda *_: [])
    elif mode == "micro": patch_attrs(monkeypatch, text, _activity_fallback_words=lambda *_: [Word(0, 0.005, 'two', 0.1)])
    output, stats = anchor_merge(['one', 'two', 'three'], ctc, [], source, sample_rate, 10, windows)
    assert ([word.text for word in output], stats['interpolated']) == (['one', 'two', 'three'], 1)


def test_line_aware_merger_partial_consensus_and_fallbacks():
    source, ctc_lines, qwen = np.ones(1000, dtype=np.float32), [alignment_result((Word(1, 1.5, 'one', 0.8),), 0.8), None], [Word(1.05, 1.45, 'one', 0.9, 0), Word(5, 5.5, 'three', 0.8, 2)]
    output, stats = text._line_aware_canonical_alignment(
        ["one two", "three four"], ctc_lines, qwen, source, 100, 10
    )
    assert ([word.text for word in output] == ['one', 'two', 'three', 'four']) and (stats['interpolated'] == 2 and stats['consensus'] >= 1)


def test_line_aware_merger_conflicting_and_remote_candidates(monkeypatch):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [5, 5.01])
    ctc_lines = [
        alignment_result((Word(8, 8.5, 'one', 0.1), Word(8.5, 9, 'two', 0.1, 1)), 0.1),
        alignment_result((Word(1, 1.5, 'three', 0.9), Word(1.5, 2, 'four', 0.9, 1)), 0.9),
    ]
    output, stats = text._line_aware_canonical_alignment(
        ["one two", "three four"],
        ctc_lines,
        [Word(0, 0.01, "one", 0.9), Word(20, 21, "four", 0.9, 3)],
        source,
        100,
        10,
        {0: (0, 1, 0.5), 1: (8, 9, 0.5)},
    )
    assert (output == [] or len(output) == 4) and ('dropped_word_anchors' in stats)


@pytest.mark.parametrize("duration", [0.05, 0.1, 0.5, 1.0])
def test_line_aware_short_song_failure_boundaries(monkeypatch, duration):
    source = np.ones(1000, dtype=np.float32)
    monkeypatch.setattr(text, "_activity_quantile_times", lambda *_: [0, duration])
    output, stats = text._line_aware_canonical_alignment(
        ["one"] * 10, [], [], source, 100, duration
    )
    assert (output == [] or len(output) == 10) and (stats['lines'] == 10 and stats['line_fallbacks'] >= 0)


def test_line_aware_invalid_bounds_conflicts_and_empty_baseline(monkeypatch):
    source, invalid_ctc = np.ones(1000, dtype=np.float32), alignment_result((SimpleNamespace(start=20, end=21, text='one', confidence=1),), 1)
    output, stats = text._line_aware_canonical_alignment(
        ["one"], [invalid_ctc], [Word(20, 21, "one")], source, 100, 10
    )
    assert len(output) == 1 and stats["ctc"] == stats["qwen"] == 0

    output, _ = text._line_aware_canonical_alignment(
        ["", "one"], [alignment_result((), 1)], [], source, 100, 10
    )
    assert len(output) == 1

    ctc = [
        alignment_result((Word(8, 8.4, 'one', 0.1),), 0.1),
        alignment_result((Word(1, 1.4, 'four', 0.9),), 0.9),
    ]
    output, stats = text._line_aware_canonical_alignment(
        ["one two three", "four five six"], ctc, [], source, 100, 10
    )
    assert len(output) == 6 and stats["ctc"] >= 1

    variants = [
        (
            alignment_result((Word(1, 1.7, 'two', 0.2),), 0.2),
            [Word(1.1, 1.8, "one", 0.9)],
        ),
        (
            alignment_result((Word(1, 1.7, 'one', 0.2), Word(1.1, 1.8, 'two', 0.9, 1)), 0.2),
            [],
        ),
        (
            alignment_result((Word(1, 1.7, 'one', 0.5), Word(1.1, 1.8, 'two', 0.5, 1)), 0.5),
            [],
        ),
    ]
    for ctc_line, qwen in variants:
        output, stats = text._line_aware_canonical_alignment(
            ["one two"], [ctc_line], qwen, source, 100, 4
        )
        assert len(output) == 2 and stats["dropped_word_anchors"] >= 1

    monkeypatch.setattr(text, "_lossless_canonical_alignment", lambda *_: [])
    for duration in (0.1, 0.5, 1.0):
        output, stats = text._line_aware_canonical_alignment(
            ["one"] * 10, [], [], source, 100, duration
        )
        assert output == [] or len(output) == 10
        assert stats["line_fallbacks"] >= 1


def test_canonical_mergers_adversarial_matrix(monkeypatch):
    source, candidates = np.r_[np.zeros(100), np.ones(300), np.zeros(200), np.ones(300), np.zeros(100)], [(['one two three'], [alignment_result((Word(0.1, 0.3, 'one', 0.1),), 0.1)], [Word(0.1, 0.3, 'one', 0.9), Word(0.31, 0.5, 'two', 0.8, 1)], {0: (0, 0.6, 0.1)}, 1.0), (['one two', 'three four', 'five six'], [alignment_result((Word(6, 7, 'one', 0.1), Word(7, 8, 'two', 0.1, 1)), 0.1), alignment_result((Word(1, 2, 'three', 0.9), Word(2, 3, 'four', 0.9, 1)), 0.9), None], [Word(4, 4.2, 'five', 0.4, 4), Word(4.21, 4.4, 'six', 0.4, 5)], {0: (7, 8, 0.9), 1: (1, 3, 0.9), 2: (4, 5, 0.3)}, 9.0), (['a very long written lyric line', 'short'], [alignment_result((Word(0, 0.03, 'a', 0.2), Word(0.02, 0.04, 'very', 0.2, 1), Word(0.03, 0.05, 'long', 0.2, 2)), 0.2)], [Word(0, 0.02, 'a', 0.2), Word(8, 8.5, 'short', 0.9, 5)], {0: (0, 0.1, 1), 1: (8, 9, 1)}, 9.0), (['one', '', 'two'], [], [], {0: (0, 1, 0.17), 2: (2, 3, 0.18)}, 3.0)]
    for groups, ctc, qwen, anchors, duration in candidates:
        for merger in (
            text._atomic_line_acoustic_alignment,
            text._line_aware_canonical_alignment,
            text._anchor_preserving_canonical_alignment,
        ):
            kwargs = (
                {"anchor_windows": anchors}
                if merger is not text._atomic_line_acoustic_alignment
                else {}
            )
            output, stats = merger(groups, ctc, qwen, source, 100, duration, **kwargs)
            assert isinstance(output, list) and isinstance(stats, dict)

    monkeypatch.setattr(text, "_activity_fallback_words", lambda *_a, **_k: [])
    output, _ = text._line_aware_canonical_alignment(
        ["one two"], [], [], source, 100, 0.03, {0: (0, 0.01, 1)}
    )
    assert output == []


def test_anchor_alignment_does_not_treat_partial_line_reacquisition_as_complete(monkeypatch):
    source = np.ones(600, dtype=np.float32)
    monkeypatch.setattr(
        text,
        "_activity_fallback_words",
        lambda tokens, *_args, **_kwargs: [
            Word(index * 0.5, (index + 1) * 0.5, token, 0.2, index)
            for index, token in enumerate(tokens)
        ],
    )

    output, _ = text._anchor_preserving_canonical_alignment(
        ["lead x", "a b", "tail y"],
        [],
        [Word(0.1, 0.3, "lead", 0.9, 0), Word(5.7, 5.9, "y", 0.9, 5)],
        source,
        100,
        6.0,
        {1: (2.0, 3.0, 1.0)},
    )

    assert [word.text for word in output] == ["lead", "x", "a", "b", "tail", "y"]
    assert all(left.end <= right.start for left, right in zip(output, output[1:], strict=False))
