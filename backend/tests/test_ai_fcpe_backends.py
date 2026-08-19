from tests._shared import raises, FakeOrtSession

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.backend_registry import BackendAvailability
from AI.engines import fcpe_backends
from AI.errors import EngineUnavailableError


def test_decode_and_nearest_resize_contract(): latent = np.zeros((1, 2, 12), dtype=np.float32); latent[0, 0, 4] = 1; latent[0, 1, 8] = 0.001; cents = np.arange(12, dtype=np.float32) * 100; f0, confidence = fcpe_backends.decode_fcpe_latent(latent, cents); assert (f0.shape == confidence.shape == (1, 2)) and (f0[0, 0] > 0 and f0[0, 1] == 0); resized = fcpe_backends.nearest_resize(np.array([[1, 2]], dtype=np.float32), 4); assert (resized.tolist() == [[1, 1, 2, 2]]) and (fcpe_backends.nearest_resize(resized, 4) is resized)


FakeSession = lambda providers=("CUDAExecutionProvider", "CPUExecutionProvider"): FakeOrtSession("mel", np.pad(np.ones((1, 2, 1), dtype=np.float32), ((0, 0), (0, 0), (4, 7))), providers)

def _fake_ort(session): return SimpleNamespace(SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None), GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL='all'), InferenceSession=Mock(return_value=session))


def test_ort_fcpe_load_infer_cache_release(monkeypatch, tmp_path):
    artifact = tmp_path / "fcpe.onnx"; artifact.touch(); adapter = fcpe_backends.OrtCudaFCPEBackend(artifact); monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    session = FakeOrtSession('mel', np.pad(np.ones((1, 2, 1), dtype=np.float32), ((0, 0), (0, 0), (4, 7)))); monkeypatch.setitem(sys.modules, "onnxruntime", _fake_ort(session))
    result = adapter.infer(
        np.zeros((1, 2, 128), dtype=np.float64),
        np.arange(12, dtype=np.float32) * 100,
        target_length=4,
    )
    assert (result.f0.shape == result.confidence.shape == (4,)) and ((result.providers[0], result.input_bytes) == ('CUDAExecutionProvider', 1 * 2 * 128 * 4)) and (session.disable_fallback.called) and (adapter._load() is session and adapter.last_initialization_sec == 0) and ('f0' not in fcpe_backends.describe_fcpe_inference(result)); adapter.release(); assert adapter._session is None


def test_ort_fcpe_failures_are_explicit(monkeypatch, tmp_path):
    adapter = fcpe_backends.OrtCudaFCPEBackend(tmp_path / "missing"); monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(False, "missing")); raises(EngineUnavailableError, lambda: adapter._load(), match='missing'); monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    monkeypatch.setitem(sys.modules, "onnxruntime", None); raises(EngineUnavailableError, lambda: adapter._load(), match='unavailable')
    monkeypatch.setitem(
        sys.modules, "onnxruntime", _fake_ort(FakeSession(("CPUExecutionProvider",)))
    )
    raises(EngineUnavailableError, lambda: adapter._load(), match='did not activate'); adapter.artifact = None; monkeypatch.setitem(sys.modules, "onnxruntime", _fake_ort(FakeSession())); raises(EngineUnavailableError, lambda: adapter._load(), match='not configured')


def test_directml_fcpe_uses_required_session_options(monkeypatch, tmp_path):
    artifact = tmp_path / "fcpe.onnx"; artifact.touch(); adapter = fcpe_backends.OrtDirectMLFCPEBackend(artifact); monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok"))
    session, options = FakeSession(('DmlExecutionProvider', 'CPUExecutionProvider')), SimpleNamespace(graph_optimization_level=None, enable_mem_pattern=True, execution_mode=None); fake = _fake_ort(session); fake.SessionOptions = lambda: options; fake.ExecutionMode = SimpleNamespace(ORT_SEQUENTIAL="sequential")
    monkeypatch.setitem(sys.modules, "onnxruntime", fake)

    result = adapter.infer(
        np.zeros((1, 2, 128), dtype=np.float32),
        np.arange(12, dtype=np.float32) * 100,
        target_length=2,
    )

    assert (result.providers[0] == 'DmlExecutionProvider') and (options.enable_mem_pattern is False) and (options.execution_mode == 'sequential') and (session.disable_fallback.called)


def test_directml_fcpe_rejects_provider_fallback(monkeypatch, tmp_path): artifact = tmp_path / "fcpe.onnx"; artifact.touch(); adapter = fcpe_backends.OrtDirectMLFCPEBackend(artifact); monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "ok")); fake = _fake_ort(FakeSession(("CPUExecutionProvider",))); fake.ExecutionMode = SimpleNamespace(ORT_SEQUENTIAL="sequential"); monkeypatch.setitem(sys.modules, "onnxruntime", fake); raises(EngineUnavailableError, lambda: adapter._load(), match='DmlExecutionProvider')
