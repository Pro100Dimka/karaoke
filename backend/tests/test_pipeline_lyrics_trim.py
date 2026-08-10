from AI.models import Word
from AI.pipeline import _trim_supplied_text_to_aligned_words


def test_plain_lyrics_tail_without_timed_words_is_not_published():
    text = "one two\nthree four five\nsix seven"
    words = [
        Word(0.0, 0.3, "one", 0.9, 0),
        Word(0.3, 0.6, "two", 0.9, 1),
        Word(1.0, 1.3, "three", 0.9, 2),
        Word(1.3, 1.6, "four", 0.9, 3),
        Word(1.6, 1.9, "five", 0.9, 4),
    ]
    assert _trim_supplied_text_to_aligned_words(text, words) == "one two\nthree four five"
