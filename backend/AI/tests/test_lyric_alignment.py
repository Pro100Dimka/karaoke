from src.lyrics.alignment import reconcile_lyric_words


def test_reconcile_uses_corrected_text_with_original_vocal_timing():
    lines = reconcile_lyric_words(
        [
            {
                "text": "Мы поём вместе",
                "start": 0,
                "end": 3,
                "words": [
                    {"word": "old", "start": 0.1, "end": 0.8},
                    {"word": "words", "start": 1.0, "end": 1.8},
                    {"word": "here", "start": 2.0, "end": 2.9},
                ],
            }
        ]
    )

    assert [word["word"] for word in lines[0]["words"]] == ["Мы", "поём", "вместе"]
    assert lines[0]["words"][0]["start"] == 0.1
    assert lines[0]["words"][-1]["end"] == 2.9


def test_reconcile_projects_more_visible_words_monotonically():
    line = reconcile_lyric_words(
        [
            {
                "text": "one two three four",
                "start": 1,
                "end": 3,
                "words": [{"word": "combined", "start": 1.1, "end": 2.9}],
            }
        ]
    )[0]

    assert all(word["start"] <= word["end"] for word in line["words"])
    assert all(
        left["start"] <= right["start"]
        for left, right in zip(line["words"], line["words"][1:], strict=False)
    )


def test_project_lyrics_survives_different_line_segmentation():
    from src.lyrics.alignment import project_lyrics_onto_timing

    result = project_lyrics_onto_timing(
        ["Мы поём", "вместе сейчас"],
        [
            {
                "text": "Мы поём вместе сейчас",
                "start": 0.1,
                "end": 2.5,
                "words": [
                    {"word": "мы", "start": 0.1, "end": 0.4},
                    {"word": "поем", "start": 0.5, "end": 1.0},
                    {"word": "вместе", "start": 1.2, "end": 1.8},
                    {"word": "сейчас", "start": 2.0, "end": 2.5},
                ],
            }
        ],
    )

    assert [line["text"] for line in result] == ["Мы поём", "вместе сейчас"]
    assert result[0]["start"] == 0.1
    assert result[1]["end"] == 2.5
    assert result[0]["end"] <= result[1]["start"]
