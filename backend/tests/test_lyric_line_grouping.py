from app.services.ai_bridge import _group_words_into_lines, _snap_lines_to_regions


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


def test_consecutive_lines_do_not_reuse_the_previous_vocal_phrase():
    lines = [
        {
            "text": "previous",
            "start": 27.1,
            "end": 28.2,
            "words": [{"word": "previous", "start": 27.1, "end": 28.2}],
        },
        {
            "text": "next line",
            "start": 28.28,
            "end": 28.92,
            "words": [
                {"word": "next", "start": 28.28, "end": 28.55},
                {"word": "line", "start": 28.55, "end": 28.92},
            ],
        },
    ]
    regions = [(27.24, 28.84), (29.64, 31.32)]

    snapped = _snap_lines_to_regions(lines, regions)

    assert snapped[0]["start"] == 27.24
    assert snapped[1]["start"] == 29.64
    assert snapped[1]["words"][0]["start"] == 29.64
