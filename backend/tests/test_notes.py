from AI.models import PitchFrame, VocalNote, Word
from AI.notes import build_vocal_notes, fit_notes_to_sung_words


def test_long_melisma_just_outside_word_uses_bounded_adaptive_tolerance():
    pitch = [
        PitchFrame(time, 440.0, 1.0, True, 1.0)
        for time in (0.45, 0.50, 0.55, 0.60, 0.65)
    ]
    words = [Word(0.9, 1.2, "la", index=0)]

    notes = build_vocal_notes(
        pitch, words=words, word_boundary_tolerance=0.12, max_gap=0.06
    )

    assert len(notes) == 1
    assert notes[0].word_index == 0


def test_distant_pitch_is_not_claimed_by_a_word():
    pitch = [
        PitchFrame(time, 440.0, 1.0, True, 1.0)
        for time in (0.0, 0.05, 0.10, 0.15)
    ]
    words = [Word(1.0, 1.2, "la", index=0)]

    assert build_vocal_notes(pitch, words=words) == []


def test_narrow_ctc_words_are_expanded_to_the_next_sung_word():
    words = [
        Word(1.0, 1.05, "первая", index=0),
        Word(1.2, 1.25, "вторая", index=1),
    ]
    notes = [
        VocalNote(1.0, 1.05, 60, word_index=0),
        VocalNote(1.2, 1.25, 62, word_index=1),
    ]

    fitted_words, fitted_notes = fit_notes_to_sung_words(words, notes)

    assert fitted_words[0].end == 1.2
    assert fitted_notes[0].start == 1.0
    assert fitted_notes[0].end == 1.2


def test_phrase_final_note_gets_a_bounded_tail_instead_of_crossing_the_pause():
    words = [
        Word(1.0, 2.8, "конец", index=0),
        Word(3.0, 3.1, "дальше", index=1),
    ]
    notes = [
        VocalNote(1.0, 1.2, 60, word_index=0),
        VocalNote(3.0, 3.1, 62, word_index=1),
    ]

    fitted_words, fitted_notes = fit_notes_to_sung_words(words, notes)

    assert fitted_words[0].end == 1.45
    assert fitted_notes[0].end == 1.45


def test_note_near_a_new_word_is_not_claimed_by_an_overlapping_previous_word():
    pitch = [
        PitchFrame(time, 440.0, 1.0, True, 1.0)
        for time in (2.0, 2.05, 2.1, 2.15)
    ]
    words = [
        Word(1.0, 3.0, "предыдущее", index=0),
        Word(2.02, 2.3, "новое", index=1),
    ]

    [note] = build_vocal_notes(pitch, words=words, max_gap=0.06)

    assert note.word_index == 1


def test_short_word_between_sung_words_recovers_a_note_from_nearby_pitch():
    words = [
        Word(1.0, 1.1, "до", index=0),
        Word(1.2, 1.25, "я", index=1),
        Word(1.4, 1.5, "после", index=2),
    ]
    notes = [
        VocalNote(1.0, 1.1, 60, word_index=0),
        VocalNote(1.4, 1.5, 62, word_index=2),
    ]

    fitted_words, fitted_notes = fit_notes_to_sung_words(words, notes)

    recovered = [note for note in fitted_notes if note.word_index == 1]
    assert fitted_words[1].end == 1.4
    assert len(recovered) == 1
    assert recovered[0].start == 1.2
    assert recovered[0].end == 1.4


def test_silent_word_far_from_pitch_stays_without_an_invented_note():
    words = [Word(1.0, 1.2, "тихо", index=0)]
    notes = [VocalNote(3.0, 3.2, 60, word_index=7)]

    _fitted_words, fitted_notes = fit_notes_to_sung_words(words, notes)

    assert all(note.word_index != 0 for note in fitted_notes)


def test_note_inside_the_same_lyric_line_extends_to_the_next_word_across_a_pause():
    words = [
        Word(1.0, 1.2, "никто", index=0),
        Word(3.0, 3.2, "не", index=1),
    ]
    notes = [
        VocalNote(1.0, 1.2, 60, word_index=0),
        VocalNote(3.0, 3.2, 62, word_index=1),
    ]

    fitted_words, fitted_notes = fit_notes_to_sung_words(
        words,
        notes,
        line_end_indices={1},
    )

    assert fitted_words[0].end == 3.0
    assert fitted_notes[0].end == 3.0
