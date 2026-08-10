from AI.models import Word
from AI.pipeline import (
    _canonical_alignment_matches,
    _pipeline_lossless_canonical_words,
)


def test_pipeline_guard_restores_all_canonical_words_instead_of_trimming_text():
    text = "one two\nthree four five\nsix seven"
    partial = [
        Word(1.0, 1.3, "one", 0.9, 0),
        Word(1.3, 1.6, "two", 0.9, 1),
    ]
    repaired = _pipeline_lossless_canonical_words(text, partial, 10.0)
    assert [word.text for word in repaired] == ["one", "two", "three", "four", "five", "six", "seven"]
    assert _canonical_alignment_matches(text, repaired)
    assert repaired[-1].end <= 10.0
    assert all(right.start >= left.end - 1e-6 for left, right in zip(repaired, repaired[1:]))


def test_pipeline_guard_repairs_unsorted_canonical_qwen_words():
    text = "one two three four five six seven eight"
    # Item 6 jumps backwards exactly like the production v9 failure.
    words = [
        Word(1.0, 1.3, "one", 0.9, 0),
        Word(1.3, 1.6, "two", 0.9, 1),
        Word(1.6, 1.9, "three", 0.9, 2),
        Word(1.9, 2.2, "four", 0.9, 3),
        Word(2.2, 2.5, "five", 0.9, 4),
        Word(2.5, 2.8, "six", 0.9, 5),
        Word(2.7, 3.0, "seven", 0.9, 6),
        Word(3.0, 3.3, "eight", 0.9, 7),
    ]
    repaired = _pipeline_lossless_canonical_words(text, words, 10.0)
    assert [word.text for word in repaired] == text.split()
    assert all(right.start >= left.end - 1e-6 for left, right in zip(repaired, repaired[1:]))
    assert repaired[-1].end <= 10.0


def test_pipeline_guard_retimes_severe_backward_jump_instead_of_publishing_it():
    text = "one two three four five six seven eight"
    words = [
        Word(5.0, 5.3, "one", 0.9, 0),
        Word(5.3, 5.6, "two", 0.9, 1),
        Word(5.6, 5.9, "three", 0.9, 2),
        Word(5.9, 6.2, "four", 0.9, 3),
        Word(6.2, 6.5, "five", 0.9, 4),
        Word(6.5, 6.8, "six", 0.9, 5),
        Word(1.0, 1.3, "seven", 0.9, 6),
        Word(1.3, 1.6, "eight", 0.9, 7),
    ]
    repaired = _pipeline_lossless_canonical_words(text, words, 12.0)
    assert [word.text for word in repaired] == text.split()
    assert all(right.start >= left.end - 1e-6 for left, right in zip(repaired, repaired[1:]))
    assert repaired[0].start >= 5.0 - 1e-6
    assert repaired[-1].end <= 12.0
