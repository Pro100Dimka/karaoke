from types import SimpleNamespace

import pytest

from AI.processing_modes import normalize_processing_mode, resolve_processing_profile


def runtime(*, device="cpu", cores=4, ram_gib=8, gpu_gib=0):
    return SimpleNamespace(
        selected={"separation": SimpleNamespace(device=device)},
        hardware=SimpleNamespace(
            logical_cores=cores,
            ram_bytes=ram_gib * 1024**3,
            gpus=(SimpleNamespace(memory_bytes=gpu_gib * 1024**3),) if gpu_gib else (),
        ),
    )


def test_processing_modes_have_distinct_workloads():
    plan = runtime(device="cuda", gpu_gib=8)
    fast = resolve_processing_profile("fast", plan)
    automatic = resolve_processing_profile("auto", plan)
    quality = resolve_processing_profile("quality", plan)

    assert fast.fingerprint() == {
        "mode": "fast",
        "separation_overlap": 1.0526315789473684,
        "separation_batch_size": 2,
        "wpe_iterations": 1,
    }
    assert automatic.separation_overlap == 2 and automatic.wpe_iterations == 3
    assert quality.separation_overlap == 4 and quality.wpe_iterations == 6
    assert (
        fast.separation_overlap
        < automatic.separation_overlap
        < quality.separation_overlap
    )


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        (runtime(device="cuda", gpu_gib=3), 1),
        (runtime(device="cuda", gpu_gib=6), 2),
        (runtime(cores=8, ram_gib=16), 2),
        (runtime(cores=4, ram_gib=8), 1),
    ],
)
def test_auto_batch_size_respects_hardware_capacity(plan, expected):
    assert resolve_processing_profile(None, plan).separation_batch_size == expected


def test_processing_mode_validation_is_strict():
    assert normalize_processing_mode(" FAST ") == "fast"
    with pytest.raises(ValueError, match="Unsupported processing mode"):
        normalize_processing_mode("turbo")
