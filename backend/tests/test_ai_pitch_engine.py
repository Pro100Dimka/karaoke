
from tests._shared import patch_attrs, raises, patch_many, missing_import

import builtins
import contextlib
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.backend_shadow import ShadowPolicy
from AI.engines import pitch
from AI.engines.fcpe_backends import FCPEInference
from AI.errors import EngineUnavailableError
from AI.models import PitchFrame


class Tensor:
    def __init__(self, value): self.value = np.asarray(value)

    def unsqueeze(self, axis): return Tensor(np.expand_dims(self.value, axis))

    def to(self, _device): return self

    def squeeze(self): return Tensor(np.squeeze(self.value))

    def detach(self): return self

    def cpu(self): return self

    def __array__(self, dtype=None): return np.asarray(self.value, dtype=dtype)


def torch_stub(): return SimpleNamespace(from_numpy=Tensor, inference_mode=contextlib.nullcontext, cuda=SimpleNamespace(is_available=lambda: False))


def test_fcpe_configuration_and_model_loading(monkeypatch): estimator = pitch.FCPEPitchEstimator(sr="100", hop=0, fmin=10, fmax=500); assert estimator.hop == 1 and estimator.fingerprint()["decoder"] == "local_argmax"; torch, model = torch_stub(), object(); fcpe = SimpleNamespace(spawn_bundled_infer_model=lambda **_: model); monkeypatch.setitem(sys.modules, "torch", torch); monkeypatch.setitem(sys.modules, "torchfcpe", fcpe); monkeypatch.setattr(pitch, "select_torch_device", lambda *_: "cpu"); assert (estimator._load_model() == (torch, model)) and (estimator._load_model() == (torch, model))


def test_fcpe_model_load_retries_registered_cpu_fallback(monkeypatch):
    estimator, torch, model = pitch.FCPEPitchEstimator(), torch_stub(), object(); spawn = Mock(side_effect=[RuntimeError("CUDA driver failed"), model]); monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(
        sys.modules,
        "torchfcpe",
        SimpleNamespace(spawn_bundled_infer_model=spawn),
    )
    patch_attrs(monkeypatch, pitch, select_torch_device=lambda *_: 'cuda:0', fallback_torch_device=lambda *_: 'cpu'); assert (estimator._load_model() == (torch, model)) and ([call.kwargs['device'] for call in spawn.call_args_list] == ['cuda:0', 'cpu'])


def test_fcpe_missing_dependencies(monkeypatch):
    real_import = builtins.__import__

    def missing(name, *args, **kwargs):
        if name in {"torch", "torchfcpe"}: raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing); raises(EngineUnavailableError, lambda: pitch.FCPEPitchEstimator()._load_model(), match='torchfcpe')


def test_fcpe_estimate_empty_and_confident_frames(monkeypatch): estimator, model = pitch.FCPEPitchEstimator(sr=100, hop=10, fmin=50, fmax=500), SimpleNamespace(infer=lambda *_args, **_kwargs: (Tensor([100, 600, np.nan]), Tensor([0.8, 0.9, 0.7]))); patch_many(monkeypatch, (estimator, "_load_model", lambda: (torch_stub(), model)), (pitch, "load_mono", lambda *_: (np.asarray([], dtype=np.float32), 100))); assert estimator.estimate("empty") == []; patch_attrs(monkeypatch, pitch, load_mono=lambda *_: (np.asarray([2, -2, 0.5] * 10, dtype=np.float32), 100)); frames = estimator.estimate("audio"); assert (frames[0].voiced and frames[0].confidence == pytest.approx(0.8)) and (not frames[1].voiced and (not frames[2].voiced)) and (max((frame.energy for frame in frames)) <= 1)


def test_fcpe_old_api_and_confidence_fallback(monkeypatch):
    estimator = pitch.FCPEPitchEstimator(sr=100, hop=20, fmin=50, fmax=500)

    class OldModel:
        calls = 0

        def infer(self, _tensor, **kwargs):
            self.calls += 1
            if "f0_min" in kwargs: raise TypeError("old api")
            return Tensor([100, 0, 200, 700, 100, 100])

    model = OldModel(); patch_many(monkeypatch, (estimator, "_load_model", lambda: (torch_stub(), model)), (pitch, "load_mono", lambda *_: (np.asarray([0.1], dtype=np.float32), 100))); frames = estimator.estimate("audio"); assert (model.calls == 2) and (frames[0].confidence == 1 and frames[1].confidence == 0) and (frames[-1].energy == 0)


def test_fcpe_ignores_mismatched_confidence(monkeypatch): estimator, model = pitch.FCPEPitchEstimator(sr=100, hop=10, fmin=50, fmax=500), SimpleNamespace(infer=lambda *_args, **_kwargs: [Tensor([100, 110]), Tensor([0.1])]); patch_many(monkeypatch, (estimator, "_load_model", lambda: (torch_stub(), model)), (pitch, "load_mono", lambda *_: (np.ones(10, dtype=np.float32), 100))); assert all(frame.confidence == 1 for frame in estimator.estimate("audio"))


def test_fcpe_shadow_is_diagnostic_and_cleanup_safe():
    candidate = FCPEInference(
        np.asarray([100, 0], dtype=np.float32),
        np.asarray([0.9, 0.1], dtype=np.float32),
        0.2,
        0.1,
        16,
        32,
        ("CUDAExecutionProvider",),
    )
    backend = SimpleNamespace(infer=Mock(return_value=candidate), release=Mock()); estimator, model, production = pitch.FCPEPitchEstimator(sr=100, hop=10, fmin=50, fmax=500, shadow_policy=ShadowPolicy(True, 1), shadow_backend_factory=lambda: backend), SimpleNamespace(wav2mel=lambda *_: Tensor(np.ones((1, 2, 3))), model=SimpleNamespace(cent_table=Tensor(np.arange(4)))), [PitchFrame(0, 100, 1, True, 0.2), PitchFrame(0.1, 0, 0, False, 0.1)]; estimator._run_shadow("song.wav", model, Tensor([0]), np.ones(10), 2, production); assert ((estimator.last_shadow_diagnostics['status'], estimator.last_shadow_frames) == ('compared', production)) and (backend.release.called and estimator._shadow_backend is None)


def test_fcpe_shadow_failure_and_resident_policy_are_isolated(): failing = SimpleNamespace(infer=Mock(side_effect=RuntimeError("shadow failed")), release=Mock()); estimator, model = pitch.FCPEPitchEstimator(shadow_policy=ShadowPolicy(True, 1, True), shadow_backend_factory=lambda: failing), SimpleNamespace(wav2mel=lambda *_: Tensor(np.ones((1, 2, 3))), model=SimpleNamespace(cent_table=Tensor(np.arange(4)))); estimator._run_shadow("song.wav", model, Tensor([0]), np.ones(10), 2, []); assert ('shadow failed' in estimator.last_shadow_diagnostics['error']) and (not failing.release.called); failing.release.side_effect = RuntimeError("cleanup"); estimator.release_shadow(); assert estimator._shadow_backend is None


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
    monkeypatch.setitem(sys.modules, "librosa", fake); monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.ones(100, dtype=np.float32), 100)); frames = pitch.PyinFallbackPitchEstimator(sr=100, hop_seconds=0).estimate("audio"); assert (frames[0].voiced and frames[0].energy == 0.3) and (not frames[1].voiced and frames[1].energy == 0)
    monkeypatch.setattr(pitch, "load_mono", lambda *_: (np.asarray([]), 100)); assert pitch.PyinFallbackPitchEstimator().estimate("empty") == []


def test_pyin_requires_librosa(monkeypatch): monkeypatch.setattr(builtins, "__import__", missing_import(builtins.__import__, "librosa")); raises(EngineUnavailableError, lambda: pitch.PyinFallbackPitchEstimator().estimate('audio'), match='librosa')


def test_fcpe_shadow_backend_can_select_directml_from_env(monkeypatch): monkeypatch.setenv("KARAOKE_AI_FCPE_SHADOW_BACKEND", "directml"); estimator = pitch.FCPEPitchEstimator(shadow_policy=ShadowPolicy(False, 0)); assert (estimator._configured_shadow_class() is pitch.OrtDirectMLFCPEBackend) and (estimator._shadow_key() == 'onnxruntime:directml:fp32')
