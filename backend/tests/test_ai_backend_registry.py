from __future__ import annotations

import sys
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI import backend_registry as registry
from AI import backend_shadow
from AI.backend_registry import (
    ArtifactRequirement,
    BackendAvailability,
    BackendRegistry,
    BackendSpec,
    MemoryRequirements,
    SupportedShapes,
)
from AI.engines import ctc_backends
from AI.errors import EngineUnavailableError


def spec(name="a", *, available=True, fallback=(), priority=1, quality="baseline"):
    return BackendSpec(
        "ctc_ru",
        name,
        "cpu",
        "fp32",
        lambda: BackendAvailability(available, "test"),
        priority,
        MemoryRequirements(1, 2),
        (ArtifactRequirement("weights", "path"),),
        frozenset({"dynamic-time"}),
        SupportedShapes(("time",), 400),
        quality,
        "baseline",
        fallback,
    )


def test_registry_contract_order_filter_describe_and_errors():
    low, high = spec("low", priority=1), spec("high", priority=2, available=False)
    backends = BackendRegistry((low, high))
    assert [item.backend for item in backends.candidates("ctc_ru")] == ["high", "low"]
    assert backends.candidates("ctc_ru", available_only=True) == (low,)
    assert backends.candidates("ctc_ru", quality=frozenset({"shadow"})) == ()
    assert backends.get("ctc_ru", low.key) is low
    assert backends.describe("ctc_ru")[0]["availability"] == {
        "available": False,
        "reason": "test",
    }
    assert len(backends.describe()) == 2
    with pytest.raises(ValueError, match="already registered"):
        backends.register(low)
    with pytest.raises(KeyError, match="Unknown backend"):
        backends.get("ctc_uk", low.key)


def test_registry_fallback_chain_and_cycle():
    cpu = spec("cpu")
    cuda = spec("cuda", fallback=(cpu.key,))
    backends = BackendRegistry((cuda, cpu))
    assert backends.fallback_chain("ctc_ru", cuda.key) == (cuda, cpu)
    cyclic_a = spec("cycle-a", fallback=("cycle-b:cpu:fp32",))
    cyclic_b = spec("cycle-b", fallback=(cyclic_a.key,))
    with pytest.raises(ValueError, match="cycle"):
        BackendRegistry((cyclic_a, cyclic_b)).fallback_chain("ctc_ru", cyclic_a.key)


def test_optional_module_and_pytorch_availability(monkeypatch):
    monkeypatch.setattr(registry.importlib.util, "find_spec", Mock(side_effect=ValueError))
    assert not registry._module_available("broken")
    assert not registry._pytorch_availability(False).available

    monkeypatch.setattr(registry, "_module_available", lambda _: True)
    fake_torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    assert registry._pytorch_availability(False).available
    assert not registry._pytorch_availability(True).available
    fake_torch.cuda.is_available = Mock(side_effect=RuntimeError("driver"))
    assert "failed" in registry._pytorch_availability(True).reason


def test_onnx_path_and_availability(monkeypatch, tmp_path):
    monkeypatch.delenv("KARAOKE_AI_CTC_RU_ONNX", raising=False)
    assert registry.ctc_onnx_path("ctc_ru") is None
    assert "not configured" in registry._ort_cuda_availability("ctc_ru").reason
    missing = tmp_path / "missing.onnx"
    monkeypatch.setenv("KARAOKE_AI_CTC_RU_ONNX", str(missing))
    assert registry.ctc_onnx_path("ctc_ru") == missing
    assert "does not exist" in registry._ort_cuda_availability("ctc_ru").reason
    missing.touch()
    monkeypatch.setattr(registry, "_module_available", lambda _: False)
    assert "not installed" in registry._ort_cuda_availability("ctc_ru").reason
    monkeypatch.setattr(registry, "_module_available", lambda _: True)
    fake = SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"])
    monkeypatch.setitem(sys.modules, "onnxruntime", fake)
    assert not registry._ort_cuda_availability("ctc_ru").available
    fake.get_available_providers = lambda: ["CUDAExecutionProvider"]
    assert registry._ort_cuda_availability("ctc_ru").available
    fake.get_available_providers = Mock(side_effect=OSError("dll"))
    assert "probe failed" in registry._ort_cuda_availability("ctc_ru").reason


def test_default_ctc_registry_contract():
    for model in ("ctc_ru", "ctc_uk"):
        candidates = registry.CTC_BACKEND_REGISTRY.candidates(model)
        assert [item.key for item in candidates] == [
            "onnxruntime:cuda:fp16",
            "pytorch:cuda:fp16",
            "pytorch:cpu:fp32",
        ]
        assert candidates[0].quality_status == "disabled"
        assert candidates[0].benchmark_status == "corpus"
        assert "corpus-quality-rejected" in candidates[0].capabilities
        assert "production" in candidates[1].capabilities
        assert "universal-fallback" in candidates[2].capabilities
        assert registry.CTC_BACKEND_REGISTRY.fallback_chain(model, candidates[0].key) == (
            candidates[0],
            candidates[1],
            candidates[2],
        )


def test_vendor_neutral_fcpe_registry_contract():
    candidates = registry.AI_BACKEND_REGISTRY.candidates("fcpe")
    assert [item.key for item in candidates] == [
        "onnxruntime:cuda:fp16",
        "onnxruntime:directml:fp32",
        "pytorch:cuda:fp32",
        "pytorch:cpu:fp32",
    ]
    cuda, directml, _torch_cuda, cpu = candidates
    assert cuda.vendor == "nvidia"
    assert cuda.quality_status == "disabled"
    assert cuda.benchmark_status == "corpus"
    assert directml.vendor == "amd,intel"
    assert directml.quality_status == "shadow"
    assert directml.benchmark_status == "isolated"
    assert directml.runtime_requirements[0].name == "onnxruntime-directml"
    assert cpu.vendor == "any"
    assert cuda.runtime_requirements[0].name == "onnxruntime-gpu"
    assert registry.AI_BACKEND_REGISTRY.fallback_chain("fcpe", cuda.key) == (
        cuda,
        _torch_cuda,
        cpu,
    )
    assert registry.AI_BACKEND_REGISTRY.fallback_chain("fcpe", directml.key) == (
        directml,
        cpu,
    )


def test_shadow_policy_environment_and_stable_selection(monkeypatch):
    monkeypatch.setenv("KARAOKE_AI_CTC_SHADOW", "true")
    monkeypatch.setenv("KARAOKE_AI_CTC_SHADOW_RATE", "2")
    monkeypatch.setenv("KARAOKE_AI_CTC_SHADOW_RESIDENT", "yes")
    policy = backend_shadow.ShadowPolicy.from_env()
    assert policy == backend_shadow.ShadowPolicy(True, 1, True)
    assert policy.selects("song")
    monkeypatch.setenv("KARAOKE_AI_CTC_SHADOW_RATE", "invalid")
    assert not backend_shadow.ShadowPolicy.from_env().selects("song")
    assert not backend_shadow.ShadowPolicy(False, 1).selects("song")
    assert backend_shadow.ShadowPolicy(True, 0.5).selects("same") == backend_shadow.ShadowPolicy(
        True, 0.5
    ).selects("same")


def test_pytorch_adapter_cpu_cuda_and_missing_import(monkeypatch):
    torch = pytest.importorskip("torch")
    model = Mock(return_value=SimpleNamespace(logits=torch.ones((1, 2, 3))))
    values = torch.zeros((1, 4))
    assert ctc_backends.PyTorchCTCBackend(model, "cpu").infer(values).shape == (2, 3)
    monkeypatch.setattr(torch, "autocast", lambda **_: nullcontext())
    assert ctc_backends.PyTorchCTCBackend(model, "cuda:0").infer(values, values).shape == (
        2,
        3,
    )
    assert ctc_backends.PyTorchCTCBackend(model, "cpu").release() is None
    monkeypatch.setitem(sys.modules, "torch", None)
    with pytest.raises(EngineUnavailableError, match="torch is required"):
        ctc_backends.PyTorchCTCBackend(model, "cpu").infer(values)


class FakeSession:
    def __init__(self, providers=("CUDAExecutionProvider", "CPUExecutionProvider")):
        self.providers = providers
        self.disable_fallback = Mock()

    def get_providers(self):
        return list(self.providers)

    def get_inputs(self):
        return [SimpleNamespace(name="input_values")]

    def run(self, *_):
        return [np.ones((1, 3, 4), dtype=np.float32)]


def test_ort_adapter_load_infer_cache_release_and_failures(monkeypatch, tmp_path):
    artifact = tmp_path / "model.onnx"
    artifact.touch()
    adapter = ctc_backends.OrtCudaCTCBackend("ctc_ru", artifact)
    availability = BackendAvailability(True, "registry")
    monkeypatch.setattr(
        ctc_backends.CTC_BACKEND_REGISTRY,
        "get",
        lambda *_: SimpleNamespace(availability=lambda: availability),
    )
    assert adapter.availability() is availability
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "available"))
    session = FakeSession()
    fake_ort = SimpleNamespace(
        SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None),
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=Mock(return_value=session),
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    result = adapter.infer(np.zeros((1, 16), dtype=np.float64))
    assert result.logits.shape == (3, 4)
    assert result.input_bytes == 64 and result.output_bytes == 48
    assert result.providers[0] == "CUDAExecutionProvider"
    assert session.disable_fallback.called
    assert adapter._load() is session and adapter.last_initialization_sec == 0
    described = ctc_backends.describe_inference(result)
    assert "logits" not in described and described["input_bytes"] == 64
    adapter.release()
    assert adapter._session is None

    session_without_wrapper_fallback = FakeSession()
    del session_without_wrapper_fallback.disable_fallback
    fake_ort.InferenceSession = Mock(return_value=session_without_wrapper_fallback)
    assert (
        ctc_backends.OrtCudaCTCBackend("ctc_ru", artifact)._load()
        is session_without_wrapper_fallback
    )

    unavailable = ctc_backends.OrtCudaCTCBackend("ctc_ru", artifact)
    monkeypatch.setattr(unavailable, "availability", lambda: BackendAvailability(False, "missing"))
    with pytest.raises(EngineUnavailableError, match="missing"):
        unavailable._load()

    monkeypatch.setattr(unavailable, "availability", lambda: BackendAvailability(True, "available"))
    monkeypatch.setitem(sys.modules, "onnxruntime", None)
    with pytest.raises(EngineUnavailableError, match="unavailable"):
        unavailable._load()


def test_ort_adapter_rejects_missing_artifact_and_cpu_provider(monkeypatch, tmp_path):
    adapter = ctc_backends.OrtCudaCTCBackend("ctc_ru", tmp_path / "missing")
    monkeypatch.setattr(adapter, "availability", lambda: BackendAvailability(True, "available"))
    fake_ort = SimpleNamespace(
        SessionOptions=lambda: SimpleNamespace(graph_optimization_level=None),
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=lambda *_args, **_kwargs: FakeSession(("CPUExecutionProvider",)),
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    with pytest.raises(EngineUnavailableError, match="did not activate"):
        adapter._load()
    adapter.artifact = None
    with pytest.raises(EngineUnavailableError, match="not configured"):
        adapter._load()
