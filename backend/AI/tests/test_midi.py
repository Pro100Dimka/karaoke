"""
Тесты для build/midi.py — квантизация нот под ритм-сетку.
Требует pretty_midi (для импорта модуля, хотя тестируем чистую функцию).
"""

from src.build.midi import quantize_notes


def test_quantize_notes_snaps_toward_grid():
    # BPM=120 -> одна доля = 0.5 сек, 16-я доля = 0.125 сек
    notes = [{"note": "G3", "start": 0.51, "end": 1.02, "duration": 0.51, "confidence": 0.8}]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, division=16, strength=1.0)
    # 0.51 должно притянуться к ближайшей 1/16 (0.5), 1.02 -> 1.0
    assert abs(quantized[0]["start"] - 0.5) < 1e-6
    assert abs(quantized[0]["end"] - 1.0) < 1e-6


def test_quantize_notes_zero_strength_is_noop():
    notes = [{"note": "G3", "start": 0.51, "end": 1.02, "duration": 0.51, "confidence": 0.8}]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, strength=0.0)
    assert quantized[0]["start"] == 0.51
    assert quantized[0]["end"] == 1.02


def test_quantize_notes_no_overlap_after_snapping():
    notes = [
        {"note": "G3", "start": 0.0, "end": 0.49, "duration": 0.49, "confidence": 0.8},
        {"note": "A3", "start": 0.50, "end": 0.99, "duration": 0.49, "confidence": 0.8},
    ]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, strength=1.0)
    assert quantized[0]["end"] <= quantized[1]["start"]


def test_quantize_notes_empty_or_invalid_bpm():
    assert quantize_notes([], bpm=120.0) == []
    notes = [{"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0}]
    assert quantize_notes(notes, bpm=0) == notes
