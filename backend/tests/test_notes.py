from AI.models import PitchFrame, Word
from AI.notes import build_vocal_notes


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
