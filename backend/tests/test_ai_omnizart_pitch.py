from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from AI.engines import omnizart_pitch
from AI.errors import EngineUnavailableError


def model_files(root):
    for relative in omnizart_pitch._MODEL_FILES:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"model")


def test_decode_contour_preserves_native_timing_salience_and_unvoiced():
    patches = np.ones((3, 25, 25), dtype=np.float32)
    mapping = np.asarray(((40, 0), (41, 1), (42, 2)))

    class Model:
        def predict(self, batch, verbose=0):
            assert verbose == 0 and batch.shape == (3, 25, 25, 1)
            return np.asarray(((0.1, 0.9), (0.8, 0.2), (0.4, 0.6)))

    frequency, confidence = omnizart_pitch.decode_contour(
        patches, mapping, np.ones((4, 3)), np.arange(100, dtype=float), Model()
    )
    assert len(frequency) == 3 and np.count_nonzero(frequency) == 2
    assert np.all((confidence >= 0) & (confidence <= 1))


def test_chunked_cfp_preserves_native_frame_grid(monkeypatch):
    hop = 320

    def fake_chunk(waveform, **_kwargs):
        frame_count = max(0, len(waveform) // hop - 1)
        return np.ones((2, frame_count)), [80.0, 81.0, 82.0]

    monkeypatch.setattr(omnizart_pitch, "_cfp_chunk", fake_chunk)
    matrix, _ = omnizart_pitch._extract_cfp_matrix(
        np.ones(hop * 10), sample_rate=16_000, max_frames=3
    )
    assert matrix.shape == (2, 9)


def test_estimator_success_uses_20ms_original_timeline(monkeypatch, tmp_path):
    model_files(tmp_path)
    estimator = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=lambda _: object()
    )
    monkeypatch.setattr(
        omnizart_pitch,
        "load_mono",
        lambda *_: (np.ones(1600, dtype=np.float32) * 0.1, 16_000),
    )
    monkeypatch.setattr(
        omnizart_pitch,
        "extract_patch_cfp_feature",
        lambda *_args, **_kwargs: (
            np.ones((3, 25, 25), dtype=np.float32),
            np.ones((3, 2), dtype=np.int32),
            np.ones((2, 3), dtype=np.float32),
            np.arange(100, dtype=float),
        ),
    )
    monkeypatch.setattr(
        omnizart_pitch,
        "decode_contour",
        lambda *_args, **_kwargs: (
            np.asarray([220, 0, 440]),
            np.asarray([0.8, 0, 1.0]),
        ),
    )
    frames = estimator.estimate("original.wav")
    assert [frame.time for frame in frames] == [0, 0.02, 0.04]
    assert [frame.voiced for frame in frames] == [True, False, True]
    assert frames[0].confidence == 0.8 and frames[1].frequency == 0
    assert estimator.fingerprint()["input"] == "original-full-mix"


def test_estimator_unavailable_and_runtime_failure_are_fallback_safe(monkeypatch, tmp_path):
    missing = omnizart_pitch.OmnizartPatchCNNPitchEstimator(tmp_path)
    with pytest.raises(EngineUnavailableError, match="not installed"):
        missing.estimate("audio")

    model_files(tmp_path)
    broken = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=lambda _: SimpleNamespace()
    )
    monkeypatch.setattr(
        omnizart_pitch,
        "load_mono",
        lambda *_: (np.ones(1600, dtype=np.float32), 16_000),
    )
    monkeypatch.setattr(
        omnizart_pitch,
        "extract_patch_cfp_feature",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("inference")),
    )
    with pytest.raises(EngineUnavailableError, match="inference failed"):
        broken.estimate("audio")
