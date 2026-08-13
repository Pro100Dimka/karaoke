from __future__ import annotations

import builtins
import contextlib
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from AI.engines import pitch
from AI.errors import EngineUnavailableError


class Tensor:
    def __init__(self, value):
        self.value = np.asarray(value)

    def unsqueeze(self, axis):
        return Tensor(np.expand_dims(self.value, axis))

    def to(self, _device):
        return self

    def squeeze(self):
        return Tensor(np.squeeze(self.value))

    def detach(self):
        return self

    def cpu(self):
        return self

    def __array__(self, dtype=None):
        return np.asarray(self.value, dtype=dtype)


def torch_stub():
    return SimpleNamespace(
        from_numpy=Tensor,
        inference_mode=contextlib.nullcontext,
        cuda=SimpleNamespace(is_available=lambda: False),
    )


def test_fcpe_configuration_and_model_loading(monkeypatch):
    estimator = pitch.FCPEPitchEstimator(sr="100", hop=0, fmin=10, fmax=500)
    assert estimator.hop == 1 and estimator.fingerprint()["decoder"] == "local_argmax"
    torch = torch_stub()
    model = object()
    fcpe = SimpleNamespace(spawn_bundled_infer_model=lambda **_: model)
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "torchfcpe", fcpe)
    monkeypatch.setattr(pitch, "select_torch_device", lambda _: "cpu")
    assert estimator._load_model() == (torch, model)
    assert estimator._load_model() == (torch, model)


def test_fcpe_missing_dependencies(monkeypatch):
    real_import = builtins.__import__

    def missing(name, *args, **kwargs):
        if name in {"torch", "torchfcpe"}:
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing)
    with pytest.raises(EngineUnavailableError, match="torchfcpe"):
        pitch.FCPEPitchEstimator()._load_model()


def test_fcpe_estimate_empty_and_confident_frames(monkeypatch):
    estimator = pitch.FCPEPitchEstimator(sr=100, hop=10, fmin=50, fmax=500)
    model = SimpleNamespace(
        infer=lambda *_args, **_kwargs: (Tensor([100, 600, np.nan]), Tensor([0.8, 0.9, 0.7]))
    )
    monkeypatch.setattr(estimator, "_load_model", lambda: (torch_stub(), model))
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.asarray([], dtype=np.float32), 100))
    assert estimator.estimate("empty") == []
    monkeypatch.setattr(
        pitch, "load_mono", lambda *_: (np.asarray([2, -2, 0.5] * 10, dtype=np.float32), 100)
    )
    frames = estimator.estimate("audio")
    assert frames[0].voiced and frames[0].confidence == pytest.approx(0.8)
    assert not frames[1].voiced and not frames[2].voiced
    assert max(frame.energy for frame in frames) <= 1


def test_fcpe_old_api_and_confidence_fallback(monkeypatch):
    estimator = pitch.FCPEPitchEstimator(sr=100, hop=20, fmin=50, fmax=500)

    class OldModel:
        calls = 0

        def infer(self, _tensor, **kwargs):
            self.calls += 1
            if "f0_min" in kwargs:
                raise TypeError("old api")
            return Tensor([100, 0, 200, 700, 100, 100])

    model = OldModel()
    monkeypatch.setattr(estimator, "_load_model", lambda: (torch_stub(), model))
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.asarray([0.1], dtype=np.float32), 100))
    frames = estimator.estimate("audio")
    assert model.calls == 2
    assert frames[0].confidence == 1 and frames[1].confidence == 0
    assert frames[-1].energy == 0


def test_fcpe_ignores_mismatched_confidence(monkeypatch):
    estimator = pitch.FCPEPitchEstimator(sr=100, hop=10, fmin=50, fmax=500)
    model = SimpleNamespace(infer=lambda *_args, **_kwargs: [Tensor([100, 110]), Tensor([0.1])])
    monkeypatch.setattr(estimator, "_load_model", lambda: (torch_stub(), model))
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.ones(10, dtype=np.float32), 100))
    assert all(frame.confidence == 1 for frame in estimator.estimate("audio"))


def test_pyin_fallback(monkeypatch):
    fake = SimpleNamespace(
        pyin=lambda *_args, **_kwargs: (
            np.asarray([220, np.nan]),
            np.asarray([True, False]),
            np.asarray([0.8, np.nan]),
        ),
        feature=SimpleNamespace(rms=lambda **_: np.asarray([[0.3]])),
        frames_to_time=lambda values, **_: np.asarray(values, dtype=float) * 0.1,
    )
    monkeypatch.setitem(sys.modules, "librosa", fake)
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.ones(100, dtype=np.float32), 100))
    frames = pitch.PyinFallbackPitchEstimator(sr=100, hop_seconds=0).estimate("audio")
    assert frames[0].voiced and frames[0].energy == 0.3
    assert not frames[1].voiced and frames[1].energy == 0
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.asarray([]), 100))
    assert pitch.PyinFallbackPitchEstimator().estimate("empty") == []


def test_pyin_requires_librosa(monkeypatch):
    real_import = builtins.__import__

    def missing(name, *args, **kwargs):
        if name == "librosa":
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing)
    with pytest.raises(EngineUnavailableError, match="librosa"):
        pitch.PyinFallbackPitchEstimator().estimate("audio")
