import pytest

from AI.lyrics_document import (
    flatten_word_notes,
    replace_word_notes,
    validate_lyrics_document,
    words_with_notes,
)
from AI.models import VocalNote, Word


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


def test_validation_does_not_rewrite_acoustically_detected_notes():
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

    validated = validate_lyrics_document(payload)

    pitches = [note["note"] for note in validated["words"][0]["notes"]]
    assert pitches == [68, 55, 67, 66]


def test_words_without_acoustic_evidence_do_not_borrow_a_nearby_note():
    words = [Word(1.0, 2.0, "first", index=0), Word(3.0, 4.0, "silent", index=1)]
    payload = words_with_notes(words, [VocalNote(1.2, 1.8, 60, word_index=0)])

    assert payload[0]["notes"] == [{"note": 60, "start": 1.2, "end": 1.8}]
    assert payload[1]["notes"] == []


def test_sustained_acoustic_note_is_preserved_in_every_word_it_crosses():
    words = [
        Word(1.0, 1.4, "first", index=0),
        Word(1.4, 1.8, "second", index=1),
    ]

    payload = words_with_notes(
        words,
        [VocalNote(1.1, 1.7, 60, word_index=0)],
    )

    assert payload[0]["notes"] == [{"note": 60, "start": 1.1, "end": 1.4}]
    assert payload[1]["notes"] == [{"note": 60, "start": 1.4, "end": 1.7}]

    flattened = flatten_word_notes({"bpm": 120, "key": "Am", "words": payload})
    assert flattened == [
        {"note": 60, "start": 1.1, "end": 1.4, "word_index": 0},
        {"note": 60, "start": 1.4, "end": 1.7, "word_index": 1},
    ]


def test_export_preserves_every_acoustically_detected_interval_without_filling_gaps():
    words = [Word(1.0, 1.3, "melody", index=0)]
    detected = [
        VocalNote(1.0, 1.15, 60, word_index=0),
        VocalNote(1.151, 1.152, 72, word_index=0),
        VocalNote(1.16, 1.3, 62, word_index=0),
    ]

    exported = words_with_notes(words, detected)[0]["notes"]

    assert exported == [
        {"note": 60, "start": 1.0, "end": 1.15},
        {"note": 72, "start": 1.151, "end": 1.152},
        {"note": 62, "start": 1.16, "end": 1.3},
    ]


def test_export_drops_boundary_sliver_that_rounds_to_a_zero_length_note():
    words = [Word(35.678, 36.08, "first", index=0), Word(36.08, 36.4, "second", index=1)]
    detected = [VocalNote(36.0796, 36.2, 67, word_index=1)]

    payload = words_with_notes(words, detected)

    assert payload[0]["notes"] == []
    assert payload[1]["notes"] == [{"note": 67, "start": 36.08, "end": 36.2}]


def test_short_word_keeps_its_acoustically_detected_note():
    words = [Word(1.0, 1.04, "a", index=0)]

    assert words_with_notes(words, [VocalNote(1.0, 1.04, 60, word_index=0)])[0]["notes"] == [
        {"note": 60, "start": 1.0, "end": 1.04}
    ]


def test_editor_does_not_create_a_note_for_an_empty_word():
    payload = {
        "bpm": 120,
        "key": "Am",
        "words": [
            {"text": "first", "start": 1.0, "end": 2.0, "notes": []},
            {"text": "silent", "start": 3.0, "end": 4.0, "notes": []},
        ],
    }

    result = replace_word_notes(
        payload,
        [{"word_index": 0, "note": 60, "start": 1.0, "end": 2.0}],
    )

    assert result["words"][1]["notes"] == []


@pytest.mark.parametrize(
    "notes",
    [
        [{"note": 60, "start": 0.5, "end": 0.9}],
        [{"note": 60, "start": 2.1, "end": 2.3}],
        [{"note": 60, "start": 1.5, "end": 1.5}],
        [
            {"note": 60, "start": 1.0, "end": 1.6},
            {"note": 62, "start": 1.5, "end": 1.8},
        ],
        [{"note": 128, "start": 1.0, "end": 1.2}],
    ],
)
def test_rejects_notes_outside_word_or_overlapping(notes):
    with pytest.raises(ValueError):
        validate_lyrics_document(document(notes))


def test_accepts_word_without_an_acoustically_detected_note():
    assert validate_lyrics_document(document([]))["words"][0]["notes"] == []


def test_accepts_real_silence_between_notes_inside_a_word():
    notes = [
        {"note": 60, "start": 1.1, "end": 1.4},
        {"note": 62, "start": 1.55, "end": 1.8},
    ]

    assert validate_lyrics_document(document(notes))["words"][0]["notes"] == notes


@pytest.mark.parametrize("field", ["bpm", "key", "words"])
def test_requires_all_authoritative_fields(field):
    payload = document()
    del payload[field]

    with pytest.raises(ValueError):
        validate_lyrics_document(payload)
