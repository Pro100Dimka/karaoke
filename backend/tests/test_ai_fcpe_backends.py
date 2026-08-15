from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.backend_registry import BackendAvailability
from AI.engines import fcpe_backends
from AI.errors import EngineUnavailableError


def test_decode_and_nearest_resize_contract():
    latent = np.zeros((1, 2, 12), dtype=np.float32)
    latent[0, 0, 4] = 1
    latent[0, 1, 8] = 0.001
    cents = np.arange(12, dtype=np.float32) * 100
    f0, confidence = fcpe_backends.decode_fcpe_latent(latent, cents)
    assert f0.shape == confidence.shape == (1, 2)
    assert f0[0, 0] > 0 and f0[0, 1] == 0
    resized = fcpe_backends.nearest_resize(np.array([[1, 2]], dtype=np.float32), 4)
    assert resized.tolist() == [[1, 1, 2, 2]]
    assert fcpe_backends.nearest_resize(resized, 4) is resized


class FakeSession:
    def __init__(self, providers=("CUDAExecutionProvider", "CPUExecutionProvider")):
        self.providers = providers
        self.disable_fallback = Mock()

    def get_providers(self):
        return list(self.providers)

    def get_inputs(self):
        return [SimpleNamespace(name="mel")]

    def run(self, *_):
        latent = np.zeros((1, 2, 12), dtype=np.float32)
        latent[..., 4] = 1
        return [latent]


def _fake_ort(session):
    return SimpleNamespace(
        SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None),
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=Mock(return_value=session),
    )


def test_ort_fcpe_load_infer_cache_release(monkeypatch, tmp_path):
    artifact = tmp_path / "fcpe.onnx"
    artifact.touch()
    adapter = fcpe_backends.OrtCudaFCPEBackend(artifact)
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    session = FakeSession()
    monkeypatch.setitem(sys.modules, "onnxruntime", _fake_ort(session))
    result = adapter.infer(
        np.zeros((1, 2, 128), dtype=np.float64),
        np.arange(12, dtype=np.float32) * 100,
        target_length=4,
    )
    assert result.f0.shape == result.confidence.shape == (4,)
    assert result.providers[0] == "CUDAExecutionProvider"
    assert result.input_bytes == 1 * 2 * 128 * 4
    assert session.disable_fallback.called
    assert adapter._load() is session and adapter.last_initialization_sec == 0
    assert "f0" not in fcpe_backends.describe_fcpe_inference(result)
    adapter.release()
    assert adapter._session is None


def test_ort_fcpe_failures_are_explicit(monkeypatch, tmp_path):
    adapter = fcpe_backends.OrtCudaFCPEBackend(tmp_path / "missing")
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(False, "missing"))
    with pytest.raises(EngineUnavailableError, match="missing"):
        adapter._load()
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    monkeypatch.setitem(sys.modules, "onnxruntime", None)
    with pytest.raises(EngineUnavailableError, match="unavailable"):
        adapter._load()
    monkeypatch.setitem(
        sys.modules, "onnxruntime", _fake_ort(FakeSession(("CPUExecutionProvider",)))
    )
    with pytest.raises(EngineUnavailableError, match="did not activate"):
        adapter._load()
    adapter.artifact = None
    monkeypatch.setitem(sys.modules, "onnxruntime", _fake_ort(FakeSession()))
    with pytest.raises(EngineUnavailableError, match="not configured"):
        adapter._load()


def test_directml_fcpe_uses_required_session_options(monkeypatch, tmp_path):
    artifact = tmp_path / "fcpe.onnx"
    artifact.touch()
    adapter = fcpe_backends.OrtDirectMLFCPEBackend(artifact)
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    session = FakeSession(("DmlExecutionProvider", "CPUExecutionProvider"))
    options = SimpleNamespace(
        graph_optimization_level=None,
        enable_mem_pattern=True,
        execution_mode=None,
    )
    fake = _fake_ort(session)
    fake.SessionOptions = lambda: options
    fake.ExecutionMode = SimpleNamespace(ORT_SEQUENTIAL="sequential")
    monkeypatch.setitem(sys.modules, "onnxruntime", fake)

    result = adapter.infer(
        np.zeros((1, 2, 128), dtype=np.float32),
        np.arange(12, dtype=np.float32) * 100,
        target_length=2,
    )

    assert result.providers[0] == "DmlExecutionProvider"
    assert options.enable_mem_pattern is False
    assert options.execution_mode == "sequential"
    assert session.disable_fallback.called


def test_directml_fcpe_rejects_provider_fallback(monkeypatch, tmp_path):
    artifact = tmp_path / "fcpe.onnx"
    artifact.touch()
    adapter = fcpe_backends.OrtDirectMLFCPEBackend(artifact)
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    fake = _fake_ort(FakeSession(("CPUExecutionProvider",)))
    fake.ExecutionMode = SimpleNamespace(ORT_SEQUENTIAL="sequential")
    monkeypatch.setitem(sys.modules, "onnxruntime", fake)
    with pytest.raises(EngineUnavailableError, match="DmlExecutionProvider"):
        adapter._load()
