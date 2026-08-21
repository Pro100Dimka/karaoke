from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast

from .runtime import RuntimePlan, get_runtime_plan

ProcessingMode = Literal["auto", "fast", "quality"]
PROCESSING_MODES = frozenset({"auto", "fast", "quality"})


@dataclass(frozen=True, slots=True)
class ProcessingProfile:
    mode: ProcessingMode
    separation_overlap: float
    separation_batch_size: int
    wpe_iterations: int

    def fingerprint(self) -> dict[str, float | int | str]:
        return {
            "mode": self.mode,
            "separation_overlap": self.separation_overlap,
            "separation_batch_size": self.separation_batch_size,
            "wpe_iterations": self.wpe_iterations,
        }


def normalize_processing_mode(value: str | None) -> ProcessingMode:
    normalized = (value or "auto").strip().lower()
    if normalized not in PROCESSING_MODES:
        raise ValueError(f"Unsupported processing mode: {value!r}")
    return cast(ProcessingMode, normalized)


def _adaptive_batch_size(plan: RuntimePlan) -> int:
    backend = plan.selected.get("separation")
    if backend is not None and backend.device.startswith("cuda"):
        memory = max((gpu.memory_bytes for gpu in plan.hardware.gpus), default=0)
        if memory >= 8 * 1024**3: return 4
        if memory >= 4 * 1024**3: return 2
        return 1
    if plan.hardware.logical_cores >= 8 and plan.hardware.ram_bytes >= 16 * 1024**3:
        return 2
    return 1


def resolve_processing_profile(
    mode: str | None,
    plan: RuntimePlan | None = None,
) -> ProcessingProfile:
    selected = normalize_processing_mode(mode)
    runtime = plan or get_runtime_plan()
    batch_size = _adaptive_batch_size(runtime)
    if selected == "fast":
        return ProcessingProfile(selected, 1.0526315789473684, batch_size, 2)
    if selected == "quality":
        return ProcessingProfile(selected, 2, min(batch_size, 4), 5)
    return ProcessingProfile(selected, 1.0526315789473684, batch_size, 3)
