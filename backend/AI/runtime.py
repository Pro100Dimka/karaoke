from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class GPUInfo:
    name: str
    vendor: str = "unknown"
    memory_bytes: int = 0


@dataclass(frozen=True, slots=True)
class HardwareProfile:
    cpu: str
    logical_cores: int
    ram_bytes: int = 0
    gpus: tuple[GPUInfo, ...] = ()
    torch_available: bool = False
    cuda_available: bool = False
    cuda_version: str | None = None


@dataclass(frozen=True, slots=True)
class BackendSpec:
    key: str
    device: str
    precision: str = "fp32"


@dataclass(slots=True)
class RuntimePlan:
    hardware: HardwareProfile
    selected: dict[str, BackendSpec] = field(default_factory=dict)
    fallbacks: dict[str, tuple[BackendSpec, ...]] = field(default_factory=dict)
    preference: str = "auto"

    def describe(self) -> dict:
        return {"hardware": self.hardware, "selected": self.selected, "fallbacks": self.fallbacks}


_plan: RuntimePlan | None = None


def detect_hardware(torch_module=None) -> HardwareProfile:
    torch = torch_module
    if torch is None:
        try:
            import torch
        except ImportError:
            torch = None
    cuda_api = getattr(torch, "cuda", None)
    cuda = bool(cuda_api and cuda_api.is_available())
    gpus = tuple(
        GPUInfo(
            torch.cuda.get_device_name(index),
            "NVIDIA",
            int(torch.cuda.get_device_properties(index).total_memory),
        )
        for index in range(cuda_api.device_count())
    ) if cuda else ()
    try:
        import psutil
        ram = int(psutil.virtual_memory().total)
    except ImportError:
        ram = 0
    return HardwareProfile(
        platform.processor() or "unknown",
        os.cpu_count() or 1,
        ram,
        gpus,
        torch is not None,
        cuda,
        str(torch.version.cuda) if cuda else None,
    )


def configure_runtime(mode="auto", *, force=False, **_options) -> RuntimePlan:
    global _plan
    if _plan is not None and not force:
        return _plan
    hardware = detect_hardware()
    device = "cuda" if mode != "cpu" and hardware.cuda_available else "cpu"
    selected = {role: BackendSpec(f"pytorch:{device}", device, "fp16" if device == "cuda" and role in {"asr", "aligner"} else "fp32") for role in ("separation", "pitch", "asr", "ctc_ru", "ctc_uk", "aligner")}
    _plan = RuntimePlan(hardware, selected, {role: (BackendSpec("pytorch:cpu", "cpu"),) for role in selected}, str(mode))
    return _plan


def get_runtime_plan() -> RuntimePlan:
    return _plan or configure_runtime()


def selected_backend(model: str):
    return get_runtime_plan().selected.get(model)


def mark_backend_failed(model: str, key: str, error: BaseException):
    return next(iter(get_runtime_plan().fallbacks.get(model, ())), None)


def reset_runtime_for_tests() -> None:
    global _plan
    _plan = None


def format_runtime_plan(plan: RuntimePlan | None = None) -> tuple[str, ...]:
    plan = plan or get_runtime_plan()
    gpu = ", ".join(item.name for item in plan.hardware.gpus) or "none"
    return (
        f"CPU: {plan.hardware.cpu} ({plan.hardware.logical_cores} logical cores)",
        f"GPU: {gpu}",
        *(f"{role} -> {backend.key}:{backend.precision}" for role, backend in plan.selected.items()),
    )
