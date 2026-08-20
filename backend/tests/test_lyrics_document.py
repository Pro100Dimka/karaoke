import pytest

from AI.lyrics_document import stabilize_lyrics_melody, validate_lyrics_document


def document(notes=None):
    return {
        "bpm": 120,
        "key": "Am",
        "words": [
            {"text": "la", "start": 1.0, "end": 2.0, "notes": notes or []},
        ],
    }


def test_accepts_exact_word_note_contract():
    payload = document(
        [
            {"note": 60, "start": 1.0, "end": 1.4},
            {"note": 62, "start": 1.4, "end": 2.0},
        ]
    )

    assert validate_lyrics_document(payload) is payload


def test_stabilizes_isolated_octave_errors_and_out_of_key_notes():
    payload = {
        "bpm": 120,
        "key": "D# major",
        "words": [
            {
                "text": "melody",
                "start": 1.0,
                "end": 2.0,
                "notes": [
                    {"note": 68, "start": 1.0, "end": 1.3},
                    {"note": 55, "start": 1.3, "end": 1.6},
                    {"note": 67, "start": 1.6, "end": 1.8},
                    {"note": 66, "start": 1.8, "end": 2.0},
                ],
            }
        ],
    }

    stabilized = stabilize_lyrics_melody(payload)

    pitches = [note["note"] for note in stabilized["words"][0]["notes"]]
    assert pitches == [68, 67]


@pytest.mark.parametrize(
    "notes",
    [
        [],
        [{"note": 60, "start": 0.9, "end": 1.2}],
        [{"note": 60, "start": 1.8, "end": 2.1}],
        [{"note": 60, "start": 1.5, "end": 1.5}],
        [
            {"note": 60, "start": 1.0, "end": 1.6},
            {"note": 62, "start": 1.5, "end": 1.8},
        ],
        [
            {"note": 60, "start": 1.0, "end": 1.4},
            {"note": 62, "start": 1.5, "end": 2.0},
        ],
        [{"note": 128, "start": 1.0, "end": 1.2}],
    ],
)
def test_rejects_notes_outside_word_or_overlapping(notes):
    with pytest.raises(ValueError):
        validate_lyrics_document(document(notes))


@pytest.mark.parametrize("field", ["bpm", "key", "words"])
def test_requires_all_authoritative_fields(field):
    payload = document()
    del payload[field]

    with pytest.raises(ValueError):
        validate_lyrics_document(payload)
