"""
Тесты для build/reference.py — сегментации нот из pitch.json.
Не требует librosa/torch — только json+collections, быстрые тесты.
"""
import random

from backend.AI.src.build.reference import (
    _fix_octave_errors,
    _merge_adjacent_same_notes,
    build_reference,
    midi_to_note,
    note_to_midi,
)


def test_note_midi_roundtrip():
    for note in ["C0", "C4", "A4", "G#3", "B7", "C-1", "C#-1"]:
        assert midi_to_note(note_to_midi(note)) == note


def test_build_reference_ignores_single_frame_noise():
    """
    Регрессионный тест на баг, который мы чинили: раньше 1 шумной
    кадр мог оборвать ноту. Синтетика: певец держит G3 (1с), A3 (0.8с),
    G3 (0.6с), но 15% кадров зашумлены соседними полутонами.
    Должно получиться ровно 3 ноты, а не десятки обрывков.
    """
    random.seed(42)
    frames = []
    t = 0.0
    step = 0.01
    notes_true = ["G3"] * 100 + ["A3"] * 80 + ["G3"] * 60
    for true_note in notes_true:
        note = true_note
        if random.random() < 0.15:
            note = (random.choice(["F#3", "G#3", "A3", "F3"]) if true_note == "G3"
                    else random.choice(["G#3", "A#3", "B3", "G3"]))
        frames.append({
            "time": round(t, 3), "note": note, "voiced": True,
            "confidence": round(random.uniform(0.45, 0.9), 2),
        })
        t += step

    notes = build_reference(frames)

    assert len(notes) == 3, f"Ожидалось 3 ноты, получили {len(notes)}: {notes}"
    assert notes[0]["note"] == "G3"
    assert notes[1]["note"] == "A3"
    assert notes[2]["note"] == "G3"


def test_build_reference_empty_input():
    assert build_reference([]) == []


def test_build_reference_all_silence():
    frames = [{"time": round(i * 0.01, 3), "note": None, "voiced": False, "confidence": 0.0}
              for i in range(50)]
    assert build_reference(frames) == []


def test_fix_octave_errors_removes_short_octave_blip():
    """Короткая нота ровно на октаву выше соседей (одинаковых) — убираем,
    после чего два образовавшихся одинаковых соседа склеиваются в одну ноту
    (полный пайплайн, как в build_reference: fix -> merge)."""
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.8},
        {"note": "G4", "start": 1.0, "end": 1.05, "duration": 0.05, "confidence": 0.5},  # октавный сбой
        {"note": "G3", "start": 1.05, "end": 2.0, "duration": 0.95, "confidence": 0.8},
    ]
    fixed = _merge_adjacent_same_notes(_fix_octave_errors(notes))
    assert len(fixed) == 1
    assert fixed[0]["note"] == "G3"
    assert fixed[0]["start"] == 0.0
    assert fixed[0]["end"] == 2.0


def test_fix_octave_errors_keeps_real_octave_jump():
    """Длинная нота на октаву выше (не блип) — не должна удаляться."""
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.8},
        {"note": "G4", "start": 1.0, "end": 2.0, "duration": 1.0, "confidence": 0.8},  # реальный скачок
        {"note": "G3", "start": 2.0, "end": 3.0, "duration": 1.0, "confidence": 0.8},
    ]
    fixed = _fix_octave_errors(notes)
    assert len(fixed) == 3
