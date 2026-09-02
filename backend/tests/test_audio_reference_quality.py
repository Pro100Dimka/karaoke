from AI.reference_quality import compare_lyrics_documents


def document(*words):
    return {
        "bpm": 120,
        "key": "Am",
        "words": [
            {
                "text": text,
                "start": start,
                "end": end,
                "notes": [{"note": note, "start": start, "end": end}],
            }
            for text, start, end, note in words
        ],
    }


def test_reference_quality_is_exact_for_the_same_canonical_document():
    reference = document(("первая", 1.0, 1.5, 60), ("строка", 1.6, 2.2, 62))

    metrics = compare_lyrics_documents(reference, reference)

    assert metrics.token_similarity == 1.0
    assert metrics.matched_word_ratio == 1.0
    assert metrics.onset_mae_seconds == 0.0
    assert metrics.pitch_match_ratio == 1.0
    assert metrics.note_duration_mae_seconds == 0.0
    assert metrics.note_duration_ratio == 1.0


def test_reference_quality_measures_text_timing_and_pitch_separately():
    reference = document(("первая", 1.0, 1.5, 60), ("строка", 2.0, 2.5, 62))
    candidate = document(("первая", 1.2, 1.7, 60), ("другая", 2.4, 2.9, 65))

    metrics = compare_lyrics_documents(reference, candidate)

    assert metrics.token_similarity == 0.5
    assert metrics.matched_word_ratio == 0.5
    assert metrics.onset_mae_seconds == 0.2
    assert metrics.pitch_match_ratio == 1.0


def test_reference_quality_measures_total_note_duration_inside_each_word():
    reference = document(("долго", 1.0, 2.0, 60))
    candidate = document(("долго", 1.0, 1.5, 60))

    metrics = compare_lyrics_documents(reference, candidate)

    assert metrics.note_duration_mae_seconds == 0.5
    assert metrics.note_duration_ratio == 0.5


def test_reference_quality_accepts_punctuation_and_case_differences():
    reference = document(("Моё", 1.0, 1.5, 60), ("сердце!", 1.6, 2.2, 62))
    candidate = document(("моё", 1.0, 1.5, 60), ("СЕРДЦЕ", 1.6, 2.2, 62))

    metrics = compare_lyrics_documents(reference, candidate)

    assert metrics.token_similarity == 1.0
    assert metrics.matched_word_ratio == 1.0


def test_reference_quality_treats_the_same_melody_in_another_octave_as_a_match():
    reference = document(("строка", 1.0, 1.5, 67))
    candidate = document(("строка", 1.0, 1.5, 55))

    metrics = compare_lyrics_documents(reference, candidate)

    assert metrics.pitch_match_ratio == 1.0


def test_reference_quality_matches_a_shared_pitch_inside_a_melisma():
    reference = document(("лампа", 1.0, 2.0, 67))
    candidate = document(("лампа", 1.0, 2.0, 55))
    candidate["words"][0]["notes"].insert(
        0, {"note": 45, "start": 1.0, "end": 1.4}
    )
    candidate["words"][0]["notes"][1]["start"] = 1.4

    metrics = compare_lyrics_documents(reference, candidate)

    assert metrics.pitch_match_ratio == 1.0
