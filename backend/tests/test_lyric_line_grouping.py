from app.services.ai_bridge import _group_words_into_lines


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
