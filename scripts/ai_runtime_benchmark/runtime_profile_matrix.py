

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT
from unittest.mock import patch

sys.path.insert(0, str(ROOT / "backend"))

from AI import runtime  # noqa: E402
from AI.backend_registry import AI_BACKEND_REGISTRY  # noqa: E402

GIB = 1024**3


@dataclass(frozen=True, slots=True)
class Scenario: name: str; profile: runtime.HardwareProfile; expected_device: str


def gpu(name: str, vendor: str, gib: int) -> runtime.GPUInfo: return runtime.GPUInfo(name=name, vendor=vendor, memory_bytes=gib * GIB)


def profile(*, cpu: str, gpus=(), cuda: bool=False) -> runtime.HardwareProfile: return runtime.HardwareProfile(cpu=cpu, logical_cores=16, ram_bytes=32 * GIB, gpus=tuple(gpus), torch_available=True, cuda_available=cuda, cuda_version='12.6' if cuda else '')


SCENARIOS = (
    Scenario(
        "NVIDIA RTX + CUDA",
        profile(
            cpu="Intel Core test CPU",
            gpus=(gpu("NVIDIA GeForce RTX 3060", "nvidia", 8),),
            cuda=True,
        ),
        "cuda",
    ),
    Scenario(
        "AMD Radeon without validated GPU backend",
        profile(
            cpu="AMD Ryzen test CPU",
            gpus=(gpu("AMD Radeon RX 7800 XT", "amd", 16),),
        ),
        "cpu",
    ),
    Scenario(
        "Intel Arc without validated GPU backend",
        profile(
            cpu="Intel Core test CPU",
            gpus=(gpu("Intel Arc A770", "intel", 16),),
        ),
        "cpu",
    ),
    Scenario(
        "Intel integrated GPU without validated GPU backend",
        profile(
            cpu="Intel Core test CPU",
            gpus=(gpu("Intel(R) Arc(TM) Graphics", "intel", 2),),
        ),
        "cpu",
    ),
    Scenario(
        "CPU only",
        profile(cpu="Generic CPU test profile"),
        "cpu",
    ),
)


def selected_summary(plan: runtime.RuntimePlan) -> str: return ', '.join((f'{runtime.MODEL_ROLES[name]}={spec.key}' for name, spec in plan.selected.items()))


def run_scenario(scenario: Scenario) -> None:
    runtime.reset_runtime_for_tests()
    with patch.object(runtime, "detect_hardware", return_value=scenario.profile): plan = runtime.configure_runtime("auto", force=True)
    if set(plan.selected) != set(runtime.MODEL_ROLES):
        missing = sorted(set(runtime.MODEL_ROLES) - set(plan.selected)); raise AssertionError(f"{scenario.name}: missing stages: {missing}")
    wrong = {
        model: spec.key
        for model, spec in plan.selected.items()
        if spec.device != scenario.expected_device
    }
    if wrong:
        raise AssertionError(
            f"{scenario.name}: expected {scenario.expected_device}, got {wrong}"
        )
    print(f"[PASS] {scenario.name}"); print(f"       {selected_summary(plan)}")


def forced_cpu_on_nvidia() -> None:
    scenario = SCENARIOS[0]; runtime.reset_runtime_for_tests()
    with patch.object(runtime, "detect_hardware", return_value=scenario.profile): plan = runtime.configure_runtime("cpu", force=True)
    assert all(spec.device == "cpu" for spec in plan.selected.values()); print("[PASS] NVIDIA profile + forced CPU -> all stages use CPU")


def single_stage_cuda_failure() -> None:
    scenario = SCENARIOS[0]; runtime.reset_runtime_for_tests()
    with patch.object(runtime, "detect_hardware", return_value=scenario.profile):
        plan = runtime.configure_runtime("auto", force=True); failed = plan.selected["fcpe"]
        replacement = runtime.mark_backend_failed(
            "fcpe", failed.key, RuntimeError("synthetic CUDA failure")
        )
    assert replacement is not None and replacement.device == "cpu"; assert runtime.selected_backend("asr") is not None; assert runtime.selected_backend("asr").device == "cuda"; print("[PASS] Single-stage CUDA failure -> FCPE falls back to CPU; ASR stays CUDA")


def directml_registration() -> None:
    spec = AI_BACKEND_REGISTRY.get("fcpe", "onnxruntime:directml:fp32"); assert spec.quality_status == "shadow"; assert "shadow-only" in spec.capabilities; assert spec.vendor == "amd,intel"
    assert spec.key not in {
        selected.key
        for scenario in SCENARIOS
        for selected in _plan_for(scenario).selected.values()
    }
    print("[PASS] DirectML FCPE is registered as shadow-only and cannot auto-enter production")


def _plan_for(scenario: Scenario) -> runtime.RuntimePlan:
    runtime.reset_runtime_for_tests()
    with patch.object(runtime, "detect_hardware", return_value=scenario.profile): return runtime.configure_runtime("auto", force=True)


def main() -> int:
    try:
        print("A&D Voice AI runtime selector matrix\n")
        for scenario in SCENARIOS: run_scenario(scenario)
        forced_cpu_on_nvidia(); single_stage_cuda_failure(); directml_registration()
    except Exception as exc:  # noqa: BLE001 - command-line diagnostic
        print(f"\n[FAIL] {type(exc).__name__}: {exc}", file=sys.stderr); return 1
    finally: runtime.reset_runtime_for_tests()
    print("\nAll selector/fallback simulations passed."); print("Note: AMD/Intel performance is NOT simulated; real hardware is required for that."); return 0


if __name__ == "__main__": raise SystemExit(main())
