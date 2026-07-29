"""
Тесты для analyze/music.py — коррекция октавной ошибки BPM.
Требует librosa (для импорта модуля).
"""
from src.analyze.music import fold_tempo


def test_fold_tempo_doubles_too_slow():
    assert abs(fold_tempo(35.0) - 140.0) < 1e-6  # 35 -> 70 -> 140


def test_fold_tempo_halves_too_fast():
    assert abs(fold_tempo(280.0) - 140.0) < 1e-6  # 280 -> 140


def test_fold_tempo_leaves_normal_range_unchanged():
    assert abs(fold_tempo(120.0) - 120.0) < 1e-6


def test_fold_tempo_boundary_values():
    assert 70.0 <= fold_tempo(69.9) <= 180.0
    assert 70.0 <= fold_tempo(180.1) <= 180.0
