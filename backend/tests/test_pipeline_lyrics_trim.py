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
