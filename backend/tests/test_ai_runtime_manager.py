from types import SimpleNamespace

import pytest

from AI import runtime
from AI.engines import device


@pytest.fixture(autouse=True)
def clean_runtime_state():
    runtime.reset_runtime_for_tests()
    yield
    runtime.reset_runtime_for_tests()


def profile(*, cuda: bool, gpus=()):
    return runtime.HardwareProfile(
        cpu="Test CPU",
        logical_cores=8,
        ram_bytes=16 * 1024**3,
        gpus=tuple(gpus),
        torch_available=True,
        cuda_available=cuda,
        cuda_version="12.8" if cuda else "",
    )


def test_hardware_detection_merges_vendor_neutral_and_cuda_metadata(monkeypatch):
    monkeypatch.setattr(runtime, "_windows_gpu_names", lambda: ("Intel Arc A770",))
    torch = SimpleNamespace(
        __version__="2.8",
        version=SimpleNamespace(cuda="12.8"),
        cuda=SimpleNamespace(
            is_available=lambda: True,
            get_device_name=lambda _index: "NVIDIA RTX 3060",
            get_device_properties=lambda _index: SimpleNamespace(total_memory=12 * 1024**3),
        ),
    )
    detected = runtime.detect_hardware(torch)
    assert detected.cuda_available is True
    assert [(gpu.vendor, gpu.name) for gpu in detected.gpus] == [
        ("nvidia", "NVIDIA RTX 3060"),
        ("intel", "Intel Arc A770"),
    ]


def test_auto_selects_only_quality_approved_cuda_and_registered_cpu_fallback(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    plan = runtime.configure_runtime("auto", force=True)
    assert set(plan.selected) == set(runtime.MODEL_ROLES)
    assert all(
        spec.backend == "pytorch" and spec.device == "cuda" for spec in plan.selected.values()
    )
    assert all(specs and specs[-1].device == "cpu" for specs in plan.fallbacks.values())
    assert all("onnxruntime" not in spec.key for spec in plan.selected.values())


def test_cpu_and_unavailable_cuda_always_select_safe_cpu(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=False))
    cpu = runtime.configure_runtime("cpu", force=True)
    assert all(spec.device == "cpu" for spec in cpu.selected.values())
    requested_cuda = runtime.configure_runtime("cuda", force=True)
    assert all(spec.device == "cpu" for spec in requested_cuda.selected.values())
    assert any("CUDA was requested" in warning for warning in requested_cuda.warnings)


def test_failed_cuda_backend_is_disabled_for_process_and_switches_one_model(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    plan = runtime.configure_runtime("auto", force=True)
    failed = plan.selected["fcpe"]
    replacement = runtime.mark_backend_failed("fcpe", failed.key, RuntimeError("CUDA OOM"))
    assert replacement is not None and replacement.device == "cpu"
    assert runtime.selected_backend("fcpe") == replacement
    assert runtime.selected_backend("asr").device == "cuda"


def test_device_runtime_failure_uses_registry_fallback_and_formats_log(monkeypatch, capsys):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    runtime.configure_runtime("auto", force=True)
    assert device.fallback_torch_device("aligner", "cuda:0", RuntimeError("CUDA driver")) == "cpu"
    assert "retrying with pytorch:cpu:fp32" in capsys.readouterr().out
    lines = runtime.format_runtime_plan()
    assert any(line == "GPU: none" for line in lines)
    assert any("aligner -> pytorch:cpu:fp32" in line for line in lines)


def test_non_accelerator_error_is_not_masked(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    runtime.configure_runtime("auto", force=True)
    assert device.fallback_torch_device("asr", "cuda:0", ValueError("bad input")) is None
    assert runtime.selected_backend("asr").device == "cuda"
