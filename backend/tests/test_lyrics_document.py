import pytest

from AI.lyrics_document import (
    LYRICS_SCHEMA_VERSION,
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


def test_accepts_ordered_syllables_that_reconstruct_the_word():
    payload = document([{"note": 60, "start": 1.0, "end": 2.0}])
    payload["words"][0]["syllables"] = [
        {"text": "l", "start": 1.0, "end": 1.2},
        {"text": "a", "start": 1.2, "end": 2.0},
    ]

    assert validate_lyrics_document(payload) is payload


def test_audio_words_receive_language_independent_syllable_structure():
    words = [Word(1.0, 3.0, "полковнику", index=0)]
    notes = [
        VocalNote(1.0, 1.5, 60, word_index=0),
        VocalNote(1.5, 3.0, 62, word_index=0),
    ]

    [result] = words_with_notes(words, notes)

    assert [item["text"] for item in result["syllables"]] == ["пол", "ков", "ни", "ку"]
    assert "".join(item["text"] for item in result["syllables"]) == "полковнику"
    assert result["syllables"][0]["start"] == 1.0
    assert result["syllables"][-1]["end"] == 3.0


@pytest.mark.parametrize(
    "syllables",
    [
        [{"text": "la", "start": 0.9, "end": 1.2}],
        [{"text": "la", "start": 1.8, "end": 2.1}],
        [
            {"text": "l", "start": 1.0, "end": 1.5},
            {"text": "a", "start": 1.4, "end": 2.0},
        ],
        [{"text": "wrong", "start": 1.0, "end": 2.0}],
        [],
    ],
)
def test_rejects_invalid_syllable_contract(syllables):
    payload = document()
    payload["words"][0]["syllables"] = syllables

    with pytest.raises(ValueError, match="syllable|Syllable"):
        validate_lyrics_document(payload)


@pytest.mark.parametrize("bpm", [0, -60, float("nan"), float("inf"), 5, 1000, "120", None])
def test_rejects_an_absurd_or_wrong_type_bpm(bpm):
    payload = document()
    payload["bpm"] = bpm

    with pytest.raises(ValueError, match="invalid bpm"):
        validate_lyrics_document(payload)


def test_accepts_bpm_at_the_boundaries_of_the_realistic_range():
    payload = document()
    payload["bpm"] = 20
    assert validate_lyrics_document(payload)["bpm"] == 20

    payload = document()
    payload["bpm"] = 400
    assert validate_lyrics_document(payload)["bpm"] == 400


def test_schema_version_defaults_and_rejects_unsupported_values():
    # A document with no schemaVersion (every file saved before this field
    # existed) is treated as the current version and stamped with it.
    legacy = document()
    assert validate_lyrics_document(legacy)["schemaVersion"] == LYRICS_SCHEMA_VERSION

    current = {**document(), "schemaVersion": LYRICS_SCHEMA_VERSION}
    assert validate_lyrics_document(current)["schemaVersion"] == LYRICS_SCHEMA_VERSION

    for bad_version in (0, -1, "1", 1.5, True):
        with pytest.raises(ValueError, match="schemaVersion"):
            validate_lyrics_document({**document(), "schemaVersion": bad_version})

    with pytest.raises(ValueError, match="newer than this application"):
        validate_lyrics_document({**document(), "schemaVersion": LYRICS_SCHEMA_VERSION + 1})


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


def test_owner_only_export_does_not_duplicate_a_note_into_an_overlapping_word():
    words = [
        Word(1.0, 2.0, "first", index=0),
        Word(1.5, 2.5, "second", index=1),
    ]
    notes = [VocalNote(1.6, 1.9, 60, word_index=1)]

    payload = words_with_notes(words, notes, owner_only=True)

    assert payload[0]["notes"] == []
    assert payload[1]["notes"] == [{"note": 60, "start": 1.6, "end": 1.9}]


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


def test_rejects_overlapping_notes_from_kar_sources_too():
    payload = document([
        {"note": 60, "start": 1.0, "end": 1.6},
        {"note": 62, "start": 1.5, "end": 1.8},
    ])
    payload["source"] = "kar"

    with pytest.raises(ValueError, match="Overlapping notes"):
        validate_lyrics_document(payload)


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


def test_accepts_a_word_with_deliberately_blank_text():
    payload = document()
    payload["words"][0]["text"] = ""

    assert validate_lyrics_document(payload)["words"][0]["text"] == ""


@pytest.mark.parametrize("text", [None, 123, ["la"]])
def test_rejects_a_word_whose_text_is_not_a_string(text):
    payload = document()
    payload["words"][0]["text"] = text

    with pytest.raises(ValueError, match="Invalid word"):
        validate_lyrics_document(payload)


@pytest.mark.parametrize(
    ("start", "end"),
    [(float("nan"), float("nan")), (0.0, float("inf")), (float("-inf"), 1.0)],
)
def test_rejects_non_finite_word_timings(start, end):
    payload = document()
    payload["words"][0]["start"] = start
    payload["words"][0]["end"] = end

    with pytest.raises(ValueError, match="Invalid word interval"):
        validate_lyrics_document(payload)


def test_a_nan_word_does_not_silently_disable_ordering_checks_for_later_words():
    # NaN comparisons are always False, so an unguarded NaN word would slip
    # through *and* leave `previous` as NaN, making the next word's own
    # ordering check (start + 1e-6 < previous) silently pass too.
    payload = {
        "bpm": 120,
        "key": "Am",
        "words": [
            {"text": "la", "start": float("nan"), "end": float("nan"), "notes": []},
            {"text": "la", "start": 0.0, "end": 1.0, "notes": []},
        ],
    }
    with pytest.raises(ValueError, match="Invalid word interval 0"):
        validate_lyrics_document(payload)


@pytest.mark.parametrize(
    ("start", "end", "note"),
    [
        (float("nan"), 1.4, 60),
        (1.0, float("inf"), 60),
        (1.0, 1.4, float("nan")),
    ],
)
def test_rejects_non_finite_note_fields(start, end, note):
    payload = document([{"note": note, "start": start, "end": end}])

    with pytest.raises(ValueError, match="Invalid note interval"):
        validate_lyrics_document(payload)
