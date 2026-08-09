from pathlib import Path

import numpy as np

from app.services import ai_bridge
from app.services.ai_bridge import _group_words_into_lines, _repair_impossible_alignment_chunks


def _timed_words(text: str):
    return [
        {"text": token, "start": index, "end": index + 0.8}
        for index, token in enumerate(text.replace(".", "").replace(",", "").split())
    ]


def test_grouping_preserves_original_multiline_lyrics():
    text = "First real lyric line\nSecond real lyric line"

    lines = _group_words_into_lines(_timed_words(text), text)

    assert [line["text"] for line in lines] == [
        "First real lyric line",
        "Second real lyric line",
    ]


def test_grouping_splits_single_line_source_at_song_phrases():
    text = (
        "Это всё ты, это всё ты, это всё ты, это всё ты. "
        "Я пропал в тебе и здесь нет твоей вины."
    )

    lines = _group_words_into_lines(_timed_words(text), text)

    assert [line["text"] for line in lines] == [
        "Это всё ты это всё ты",
        "это всё ты это всё ты",
        "Я пропал в тебе и здесь нет твоей вины",
    ]


def test_only_chunk_with_impossible_line_is_retimed(monkeypatch):
    lines = [
        {"text": "good line", "start": 1.0, "end": 2.0, "words": [
            {"word": "good", "start": 1.0, "end": 1.4},
            {"word": "line", "start": 1.5, "end": 2.0},
        ]},
        {"text": "bad timing here", "start": 3.0, "end": 3.1, "words": [
            {"word": "bad", "start": 3.0, "end": 3.03},
            {"word": "timing", "start": 3.03, "end": 3.06},
            {"word": "here", "start": 3.06, "end": 3.1},
        ]},
        {"text": "following line", "start": 4.3, "end": 4.9, "words": [
            {"word": "following", "start": 4.3, "end": 4.6},
            {"word": "line", "start": 4.6, "end": 4.9},
        ]},
    ]
    audio = np.zeros(5000, dtype=np.float32)
    audio[1000:2000] = 0.8
    audio[2800:4200] = 0.8
    monkeypatch.setattr(ai_bridge, "load_mono", lambda *_args: (audio, 1000))
    monkeypatch.setattr(Path, "is_file", lambda self: self.name == "vocals.flac")

    repaired = _repair_impossible_alignment_chunks(lines, Path("unused"), maximum_words=2)

    assert repaired[0] == lines[0]
    assert repaired[1]["end"] - repaired[1]["start"] > 0.3
