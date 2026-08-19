from tests._shared import patch_attrs
from types import SimpleNamespace

import pytest

from AI import backend_registry, runtime
from AI.engines import device


@pytest.fixture(autouse=True)
def clean_runtime_state():
    runtime.reset_runtime_for_tests()
    yield
    runtime.reset_runtime_for_tests()


def profile(*, cuda: bool, gpus=()): return runtime.HardwareProfile(cpu='Test CPU', logical_cores=8, ram_bytes=16 * 1024 ** 3, gpus=tuple(gpus), torch_available=True, cuda_available=cuda, cuda_version='12.8' if cuda else '')


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
    assert (detected.cuda_available is True) and ([(gpu.vendor, gpu.name) for gpu in detected.gpus] == [('nvidia', 'NVIDIA RTX 3060'), ('intel', 'Intel Arc A770')])


def test_auto_selects_only_quality_approved_cuda_and_registered_cpu_fallback(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    plan = runtime.configure_runtime("auto", force=True)
    assert (set(plan.selected) == set(runtime.MODEL_ROLES)) and (all((spec.backend == 'pytorch' and spec.device == 'cuda' for spec in plan.selected.values()))) and (all((specs and specs[-1].device == 'cpu' for specs in plan.fallbacks.values()))) and (all(('onnxruntime' not in spec.key for spec in plan.selected.values())))


def test_cpu_and_unavailable_cuda_always_select_safe_cpu(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=False))
    cpu = runtime.configure_runtime("cpu", force=True)
    assert all(spec.device == "cpu" for spec in cpu.selected.values())
    requested_cuda = runtime.configure_runtime("cuda", force=True)
    assert (all((spec.device == 'cpu' for spec in requested_cuda.selected.values()))) and (any(('CUDA was requested' in warning for warning in requested_cuda.warnings)))


def test_failed_cuda_backend_is_disabled_for_process_and_switches_one_model(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    plan = runtime.configure_runtime("auto", force=True)
    failed = plan.selected["fcpe"]
    replacement = runtime.mark_backend_failed("fcpe", failed.key, RuntimeError("CUDA OOM"))
    assert (replacement is not None and replacement.device == 'cpu') and (runtime.selected_backend('fcpe') == replacement) and (runtime.selected_backend('asr').device == 'cuda')


def test_device_runtime_failure_uses_registry_fallback_and_formats_log(monkeypatch, capsys):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    runtime.configure_runtime("auto", force=True)
    assert (device.fallback_torch_device('aligner', 'cuda:0', RuntimeError('CUDA driver')) == 'cpu') and ('retrying with pytorch:cpu:fp32' in capsys.readouterr().out)
    lines = runtime.format_runtime_plan()
    assert (any((line == 'GPU: none' for line in lines))) and (any(('aligner -> pytorch:cpu:fp32' in line for line in lines)))


def test_non_accelerator_error_is_not_masked(monkeypatch):
    runtime.reset_runtime_for_tests()
    monkeypatch.setattr(runtime, "detect_hardware", lambda _torch=None: profile(cuda=True))
    runtime.configure_runtime("auto", force=True)
    assert (device.fallback_torch_device('asr', 'cuda:0', ValueError('bad input')) is None) and (runtime.selected_backend('asr').device == 'cuda')

@pytest.mark.parametrize(
    ("gpu_info", "expected_device"),
    [
        (runtime.GPUInfo("AMD Radeon RX 7800 XT", "amd", 16 * 1024**3), "cpu"),
        (runtime.GPUInfo("Intel Arc A770", "intel", 16 * 1024**3), "cpu"),
        (runtime.GPUInfo("Intel(R) Arc(TM) Graphics", "intel", 2 * 1024**3), "cpu"),
    ],
)
def test_non_nvidia_profiles_use_safe_cpu_until_gpu_backend_is_validated(
    monkeypatch, gpu_info, expected_device
):
    patch_attrs(monkeypatch, runtime, detect_hardware=lambda _torch=None: profile(cuda=False, gpus=(gpu_info,)))
    plan = runtime.configure_runtime("auto", force=True)
    assert all(spec.device == expected_device for spec in plan.selected.values())


def test_directml_fcpe_is_shadow_only_and_never_auto_selected(monkeypatch):
    directml = runtime.AI_BACKEND_REGISTRY.get("fcpe", "onnxruntime:directml:fp32")
    assert (directml.quality_status == 'shadow') and ('shadow-only' in directml.capabilities) and (directml.vendor == 'amd,intel')

    patch_attrs(monkeypatch, runtime, detect_hardware=lambda _torch=None: profile(cuda=False, gpus=(runtime.GPUInfo('AMD Radeon RX 7800 XT', 'amd', 16 * 1024 ** 3),)))
    plan = runtime.configure_runtime("auto", force=True)
    assert plan.selected["fcpe"].key == "pytorch:cpu:fp32"


def test_forced_cpu_profile_keeps_all_stages_on_cpu_even_with_nvidia(monkeypatch):
    patch_attrs(monkeypatch, runtime, detect_hardware=lambda _torch=None: profile(cuda=True, gpus=(runtime.GPUInfo('NVIDIA GeForce RTX 3060', 'nvidia', 8 * 1024 ** 3),)))
    plan = runtime.configure_runtime("cpu", force=True)
    assert all(spec.key == "pytorch:cpu:fp32" for spec in plan.selected.values())


def test_cpu_tuning_applies_bounded_thread_pools(monkeypatch):
    calls = []
    fake_torch = SimpleNamespace(
        set_num_threads=lambda value: calls.append(("intra", value)),
        set_num_interop_threads=lambda value: calls.append(("inter", value)),
    )
    monkeypatch.setenv("KARAOKE_CPU_TUNING", "1")
    monkeypatch.setenv("KARAOKE_CPU_INTRAOP_THREADS", "6")
    monkeypatch.setenv("KARAOKE_CPU_INTEROP_THREADS", "2")
    settings = runtime._apply_cpu_tuning(profile(cuda=False), fake_torch)
    assert (settings, calls, runtime.os.environ['OMP_NUM_THREADS'], runtime.os.environ['MKL_NUM_THREADS']) == ((6, 2), [('intra', 6), ('inter', 2)], '6', '6')


def test_cpu_tuning_is_opt_in(monkeypatch):
    monkeypatch.delenv("KARAOKE_CPU_TUNING", raising=False)
    fake_torch = SimpleNamespace(
        set_num_threads=lambda _value: pytest.fail("must stay untouched"),
        set_num_interop_threads=lambda _value: pytest.fail("must stay untouched"),
    )
    assert runtime._apply_cpu_tuning(profile(cuda=False), fake_torch) is None


def test_optional_runtime_rejects_dependency_shadowing(monkeypatch, tmp_path):
    runtime_dir = tmp_path / "onnxruntime-directml"
    runtime_dir.mkdir()
    (runtime_dir / "onnxruntime").mkdir()
    (runtime_dir / "numpy").mkdir()
    monkeypatch.setenv("KARAOKE_AI_ORT_DIRECTML_PATH", str(runtime_dir))

    path, reason = backend_registry._optional_runtime_path("KARAOKE_AI_ORT_DIRECTML_PATH")

    assert (path is None) and ('not isolated' in reason) and ('numpy' in reason)


def test_optional_runtime_accepts_clean_runtime(monkeypatch, tmp_path):
    runtime_dir = tmp_path / "onnxruntime-directml"
    runtime_dir.mkdir()
    (runtime_dir / "onnxruntime").mkdir()
    monkeypatch.setenv("KARAOKE_AI_ORT_DIRECTML_PATH", str(runtime_dir))

    path, reason = backend_registry._optional_runtime_path("KARAOKE_AI_ORT_DIRECTML_PATH")

    assert (path, reason) == (runtime_dir, '')
