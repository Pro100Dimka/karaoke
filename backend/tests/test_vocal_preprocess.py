from __future__ import annotations

from AI.models import PitchFrame
from AI.vocal_preprocess import prefer_cleaned_pitch, score_pitch_track


def _track(frequencies, confidence=0.9):
    return [
        PitchFrame(
            time=i * 0.01,
            frequency=float(freq) if freq else 0.0,
            confidence=confidence if freq else 0.0,
            voiced=bool(freq),
            energy=0.5 if freq else 0.0,
        )
        for i, freq in enumerate(frequencies)
    ]


def test_pitch_quality_penalizes_ghost_octave_flips():
    clean = _track([220.0] * 30)
    dirty = _track([220.0] * 8 + [440.0, 440.0] + [220.0] * 20)
    assert score_pitch_track(clean).score > score_pitch_track(dirty).score


def test_pitch_quality_penalizes_micro_voiced_islands():
    clean = _track([220.0] * 20 + [0.0] * 10 + [220.0] * 20)
    dirty = _track([220.0] * 20 + [0.0] * 4 + [330.0, 330.0] + [0.0] * 4 + [220.0] * 20)
    assert score_pitch_track(clean).score > score_pitch_track(dirty).score


def test_cleanup_is_not_selected_if_it_erases_too_much_vocal():
    original = score_pitch_track(_track([220.0] * 100))
    cleaned = score_pitch_track(_track([220.0] * 10 + [0.0] * 90, confidence=0.99))
    assert not prefer_cleaned_pitch(original, cleaned)
