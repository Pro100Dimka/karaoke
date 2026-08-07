import math
import pytest

from AI.engines.text import _merge_transcript_parts, _transcript_quality
from AI.models import PitchFrame, Syllable
from AI.notes import build_vocal_notes


def _frame(time, midi, energy=0.12, confidence=0.96):
    hz = 440.0 * 2 ** ((midi - 69.0) / 12.0)
    return PitchFrame(time, hz, confidence, True, energy)


@pytest.mark.parametrize("amplitude,hz", [
    (0.25,4.0),(0.35,5.0),(0.45,5.5),(0.55,6.0),(0.65,4.5),
    (0.72,5.0),(0.80,4.0),(0.90,3.5),(1.00,3.0),(1.10,2.8),
])
def test_wide_vibrato_stays_one_note(amplitude, hz):
    syllable = Syllable(0, 1, "ла", 0, 0, 1)
    pitch = [_frame(i*.01, 69 + amplitude*math.sin(2*math.pi*hz*i*.01)) for i in range(100)]
    notes = build_vocal_notes(pitch, [syllable])
    assert len(notes) == 1


@pytest.mark.parametrize("delta,split", [
    (1,.28),(1,.32),(2,.36),(2,.40),(3,.44),(4,.28),(5,.32),(7,.36),(-1,.40),(-3,.44),
])
def test_sustained_real_transition_is_preserved(delta, split):
    syllable = Syllable(0, 1, "ой", 0, 0, 1)
    pitch = [_frame(i*.01, 69 if i*.01 < split else 69+delta) for i in range(100)]
    notes = build_vocal_notes(pitch, [syllable])
    assert len(notes) == 2


@pytest.mark.parametrize("width,center", [(1,35),(1,37),(2,39),(2,41),(3,43),(3,45),(4,47),(4,49),(5,51),(5,53)])
def test_short_octave_error_does_not_create_note(width, center):
    syllable = Syllable(0, 1, "ла", 0, 0, 1)
    pitch = [_frame(i*.01, 81 if center <= i < center+width else 69) for i in range(100)]
    notes = build_vocal_notes(pitch, [syllable])
    assert len(notes) == 1


@pytest.mark.parametrize("valley_width,depth", [(4,.006),(5,.007),(6,.008),(4,.009),(5,.010),(6,.011),(4,.012),(5,.013),(6,.014),(4,.015)])
def test_clear_same_pitch_reattack_is_preserved(valley_width, depth):
    syllable = Syllable(0, 1, "ла", 0, 0, 1)
    center = 37
    pitch=[]
    for i in range(100):
        energy=.12
        if center <= i < center+valley_width:
            energy=depth
        elif center+valley_width <= i < center+valley_width+5:
            energy=.18
        pitch.append(_frame(i*.01,69,energy))
    notes=build_vocal_notes(pitch,[syllable])
    assert len(notes)==2


def test_fuzzy_chunk_overlap_removes_duplicate_boundary_words():
    assert _merge_transcript_parts(["мое сердце поет", "сердце поёт для тебя"]) == "мое сердце поет для тебя"


def test_candidate_language_script_quality_prefers_expected_language():
    assert _transcript_quality("я люблю тебя и возвращаюсь домой", 8, "Russian") > _transcript_quality("hello wrong language text", 8, "Russian")


def test_single_batch_parser_preserves_text_timestamp_tuple():
    from AI.engines.text import Qwen3Transcriber
    parsed = Qwen3Transcriber._parse_batch(("привет", [("привет", 0.0, 0.5)]), 1)
    assert parsed[0]["text"] == "привет"
    assert parsed[0]["time_stamps"]


def test_explicit_language_wins_over_chunk_auto_detection():
    from AI.engines.text import _majority_language
    assert _majority_language(["English", "English"], "ru") == "Russian"


def test_ukrainian_g_is_not_treated_as_vowel():
    from AI.syllables import split_written
    # ґ is a consonant; it must not create an extra syllabic nucleus.
    assert len(split_written("ґрунт")) == 1


def test_wrong_extra_syllables_do_not_manufacture_midi_notes():
    syllables = [
        Syllable(0.0, 0.3, "ла", 0, 0, 0.2),
        Syllable(0.3, 0.6, "ла", 1, 1, 0.2),
        Syllable(0.6, 1.0, "ла", 2, 2, 0.2),
    ]
    pitch = [_frame(i*.01, 69.0) for i in range(100)]
    notes = build_vocal_notes(pitch, syllables)
    assert len(notes) == 1


def test_midi_can_be_built_even_when_asr_returns_no_syllables():
    pitch = [_frame(i*.01, 69.0 if i < 50 else 71.0) for i in range(100)]
    notes = build_vocal_notes(pitch, [])
    assert [note.midi_note for note in notes] == [69, 71]
    assert all(note.word_index is None for note in notes)


@pytest.mark.parametrize("seed", range(10))
def test_wide_vibrato_keeps_correct_pitch_center(seed):
    import random
    rng = random.Random(seed)
    amplitude = rng.uniform(0.7, 1.1)
    rate = rng.uniform(2.8, 6.2)
    phase = rng.uniform(0.0, math.tau)
    syllable = Syllable(0, 1, "ла", 0, 0, 1)
    pitch = [
        _frame(i*.01, 69 + amplitude*math.sin(math.tau*rate*i*.01 + phase))
        for i in range(100)
    ]
    notes = build_vocal_notes(pitch, [syllable])
    assert len(notes) == 1
    assert notes[0].midi_note == 69


def test_exact_candidate_majority_is_rewarded():
    from AI.engines.text import _select_candidate
    selected = _select_candidate([
        "я люблю тебя",
        "я люблю тебя",
        "я люблю себя",
    ], 3.0, "Russian")
    assert selected == "я люблю тебя"
