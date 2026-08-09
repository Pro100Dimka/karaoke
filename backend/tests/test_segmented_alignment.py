import numpy as np
import pytest

from AI.engines import text as text_engine
from AI.engines.text import (
    Qwen3ForcedAligner,
    _activity_fallback_words,
    _group_lyric_text,
    _pathological_alignment,
    _trim_transcript_overlaps,
)
from AI.models import Word


def test_overlapping_transcript_parts_keep_owned_phrase_text():
    parts = _trim_transcript_overlaps(
        ["we sing this song", "this song together now", "together now again"]
    )

    assert parts == ["we sing this song", "together now", "again"]


def test_segmented_aligner_offsets_short_phrase_timings(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 5, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")

    def fake_align(_path, phrase, _language):
        tokens = phrase.split()
        return [
            Word(index * 0.2, index * 0.2 + 0.16, token, 0.9, index)
            for index, token in enumerate(tokens)
        ]

    monkeypatch.setattr(aligner, "align", fake_align)
    words = aligner.align_segments(
        "song.wav",
        [(1.0, 2.0, "first line"), (3.0, 4.0, "second")],
        "English",
    )

    assert [word.text for word in words] == ["first", "line", "second"]
    assert [word.index for word in words] == [0, 1, 2]
    assert words[0].start == 1.0
    assert words[1].end == pytest.approx(1.36)
    assert words[2].start == 3.0
    assert all(left.end <= right.start for left, right in zip(words, words[1:], strict=False))


def test_trusted_lyrics_are_split_into_small_aligner_groups():
    groups = _group_lyric_text(
        "one two three four five\nsix seven eight nine ten\neleven twelve thirteen fourteen fifteen"
    )

    assert len(groups) >= 2
    assert groups == [
        "one two three four five",
        "six seven eight nine ten",
        "eleven twelve thirteen fourteen fifteen",
    ]


def test_alignment_context_collapse_is_rejected():
    words = [
        Word(0.0, 0.02, "one", 1.0, 0),
        Word(0.02, 0.04, "two", 1.0, 1),
        Word(0.04, 9.5, "three", 1.0, 2),
        Word(9.5, 9.52, "four", 1.0, 3),
    ]

    assert _pathological_alignment(words, 10.0)


def test_alignment_with_many_implausibly_short_words_is_rejected():
    words = [
        Word(0.00, 0.56, "сказав", 1.0, 0),
        Word(0.56, 0.72, "що", 1.0, 1),
        Word(0.72, 1.12, "більш", 1.0, 2),
        Word(1.12, 1.20, "такої", 1.0, 3),
    ]

    assert _pathological_alignment(words, 2.0)


def test_rejected_alignment_falls_back_inside_nearest_vocal_region():
    sample_rate = 1000
    audio = np.zeros(sample_rate * 4, dtype=np.float32)
    audio[500:1100] = 0.8
    audio[2400:3300] = 0.8
    hint = [Word(2.5, 2.7, "next", 1.0, 0)]

    words = _activity_fallback_words(
        ["sing", "now"], audio, sample_rate, hint
    )

    assert words[0].start >= 2.3
    assert words[-1].end <= 3.4


def test_activity_fallback_never_reuses_a_previous_phrase_region():
    sample_rate = 1000
    audio = np.zeros(sample_rate * 4, dtype=np.float32)
    audio[500:1300] = 0.8
    audio[2400:3300] = 0.8
    misleading_hint = [Word(0.7, 1.0, "old", 1.0, 0)]

    words = _activity_fallback_words(
        ["new", "line"],
        audio,
        sample_rate,
        misleading_hint,
        minimum_start=1.5,
    )

    assert words[0].start >= 2.3
