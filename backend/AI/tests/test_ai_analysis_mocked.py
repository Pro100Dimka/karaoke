from __future__ import annotations

import numpy as np

from src.analyze import music, structure


def test_compute_bass_chroma_short_signal():
    assert music.compute_bass_chroma(np.ones(100), sr=1000) is None


def test_compute_bass_chroma_mocked_filter(monkeypatch):
    fake_signal = type("S", (), {"butter": staticmethod(lambda *a, **k: "sos"), "sosfiltfilt": staticmethod(lambda sos, y: y)})
    monkeypatch.setitem(__import__('sys').modules, "scipy.signal", fake_signal)
    monkeypatch.setattr(music.librosa, "note_to_hz", lambda note: 32.7)
    monkeypatch.setattr(music.librosa.feature, "chroma_cqt", lambda **k: np.ones((12, 3)))
    out = music.compute_bass_chroma(np.ones(2000), sr=1000)
    assert np.all(out == 1)


def test_segment_structure_mocked(monkeypatch):
    monkeypatch.setattr(structure.librosa, "load", lambda *a, **k: (np.ones(100), 10))
    monkeypatch.setattr(structure.librosa.feature, "chroma_cqt", lambda **k: np.ones((12, 20)))
    monkeypatch.setattr(structure.librosa.feature, "mfcc", lambda **k: np.ones((20, 20)))
    monkeypatch.setattr(structure.librosa.util, "sync", lambda data, bounds, aggregate=None: np.ones((data.shape[0], len(bounds)-1)))
    monkeypatch.setattr(structure.librosa.segment, "agglomerative", lambda features, k: np.array([0, 5, 10, 15, 20]))
    monkeypatch.setattr(structure.librosa, "frames_to_time", lambda frames, sr: np.asarray(frames, dtype=float))
    monkeypatch.setattr(structure, "_label_similar_segments", lambda feats: ["A", "B", "A", "C"])
    result = structure.segment_structure("x", n_segments=4)
    assert len(result) == 4
    assert result[0]["label"] == "A"
    assert result[-1]["end"] == 20.0
