from __future__ import annotations

import sys
from types import SimpleNamespace

import numpy as np
import pytest

from AI import music


def test_profile_scores_empty_and_ranked():
    assert music._profile_scores(np.zeros((12, 4))) == []
    chroma = np.tile(np.arange(1, 13, dtype=float)[:, None], (1, 8))
    scores = music._profile_scores(chroma)
    assert scores and scores == sorted(scores, reverse=True)


def test_adaptive_key_windows_cover_song():
    assert music._adaptive_key_windows(np.ones((12, 7)), 10) == []
    short = np.ones((12, 8))
    assert len(music._adaptive_key_windows(short, 0)) == 1
    long = np.tile(np.arange(100, dtype=float), (12, 1))
    windows = music._adaptive_key_windows(long, 10)
    assert 1 <= len(windows) <= 5


def fake_librosa_for_key(chroma):
    return SimpleNamespace(feature=SimpleNamespace(chroma_cqt=lambda **_: chroma))


def test_estimate_key_empty_and_scored(monkeypatch):
    empty = np.empty((12, 0))
    assert music._estimate_key(fake_librosa_for_key(empty), [], 22050) == (
        None,
        0,
        {"key_windows": 0},
    )
    zero = np.zeros((12, 8))
    assert music._estimate_key(fake_librosa_for_key(zero), [], 22050)[0] is None
    chroma = np.tile(np.asarray(music._MAJOR_PROFILE)[:, None], (1, 32))
    key, confidence, details = music._estimate_key(fake_librosa_for_key(chroma), [], 22050)
    assert key == "C major" and 0 <= confidence <= 0.95
    assert details["key_windows"] >= 1


def fake_tempo_librosa(tracked, beats):
    return SimpleNamespace(
        onset=SimpleNamespace(onset_strength=lambda **_: np.ones(4)),
        beat=SimpleNamespace(beat_track=lambda **_: (np.asarray([tracked]), np.asarray(beats))),
    )


def test_tracked_tempo_and_regularity():
    assert music._tracked_tempo(fake_tempo_librosa(0, []), [], 100, 10) == (0, 0, 0)
    value, count, regularity = music._tracked_tempo(
        fake_tempo_librosa(120, [0, 10, 20, 30]), [], 100, 10
    )
    assert value == 120 and count == 4 and regularity == 1
    _, _, irregular = music._tracked_tempo(fake_tempo_librosa(100, [0, 0, 0]), [], 100, 10)
    assert irregular == 0


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(0, 1, False), (60, 120, True), (120, 60, True), (100, 130, False)],
)
def test_octave_related(a, b, expected):
    assert music._octave_related(a, b) is expected


@pytest.mark.parametrize(
    ("coarse", "fine", "expected"),
    [
        ((0, 0, 0), (0, 0, 0), ValueError),
        ((0, 0, 0), (100, 4, 0.5), 100),
        ((90, 4, 0.5), (0, 0, 0), 90),
        ((100, 4, 0.5), (104, 4, 0.5), 102),
        ((60, 8, 0.9), (120, 4, 0.4), 60),
        ((90, 2, 0.1), (130, 8, 0.8), 130),
    ],
)
def test_estimate_tempo_branches(monkeypatch, coarse, fine, expected):
    values = iter((coarse, fine))
    monkeypatch.setattr(music, "_tracked_tempo", lambda *_: next(values))
    if expected is ValueError:
        with pytest.raises(ValueError, match="no candidates"):
            music._estimate_tempo(None, None, 1)
        return
    selected, confidence, details = music._estimate_tempo(None, None, 1)
    assert selected == expected and 0 <= confidence <= 0.92
    assert details["raw_tempo_candidates"]


def test_analyze_music_success_and_failures(monkeypatch):
    fake = SimpleNamespace(effects=SimpleNamespace(hpss=lambda audio: (audio, audio)))
    monkeypatch.setitem(sys.modules, "librosa", fake)
    monkeypatch.setattr(music, "load_mono", lambda *_: (np.ones(22050), 22050))
    monkeypatch.setattr(
        music, "_estimate_tempo", lambda *_: (305.4, 0.8, {"raw_tempo_candidates": [305.4]})
    )
    monkeypatch.setattr(music, "_estimate_key", lambda *_: ("C major", 0.7, {"key_windows": 2}))
    result = music.analyze_music("song")
    assert result["bpm"] == 300 and result["raw_bpm"] == 305.4
    assert music.estimate_tempo("song") == 300

    monkeypatch.setattr(music, "load_mono", lambda *_: (np.ones(2), 22050))
    fallback = music.analyze_music("short")
    assert fallback["bpm"] == 120 and fallback["raw_bpm"] is None


def test_analyze_music_without_librosa(monkeypatch):
    real_import = __import__

    def missing(name, *args, **kwargs):
        if name == "librosa":
            raise ImportError("missing")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", missing)
    assert music.analyze_music("song")["bpm"] == 120
