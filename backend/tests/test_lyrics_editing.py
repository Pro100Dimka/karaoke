from app.services.ai_bridge import reconcile_lyric_words


def test_spelling_edit_keeps_existing_word_timings():
    [line] = reconcile_lyric_words(
        [
            {
                "text": "hello world",
                "start": 1.0,
                "end": 3.0,
                "words": [
                    {"word": "helo", "start": 1.1, "end": 1.7},
                    {"word": "world", "start": 2.0, "end": 2.8},
                ],
            }
        ]
    )

    assert [word["word"] for word in line["words"]] == ["hello", "world"]
    assert [(word["start"], word["end"]) for word in line["words"]] == [
        (1.1, 1.7),
        (2.0, 2.8),
    ]


def test_changed_word_count_rebuilds_timing_for_new_text():
    [line] = reconcile_lyric_words(
        [
            {
                "text": "sing a new song",
                "start": 10.0,
                "end": 14.0,
                "words": [
                    {"word": "old", "start": 10.2, "end": 11.0},
                    {"word": "words", "start": 12.0, "end": 13.8},
                ],
            }
        ]
    )

    assert [word["word"] for word in line["words"]] == ["sing", "a", "new", "song"]
    assert line["words"][0]["start"] == 10.0
    assert line["words"][-1]["end"] == 14.0
    assert all(
        left["end"] <= right["start"]
        for left, right in zip(line["words"], line["words"][1:], strict=False)
    )
