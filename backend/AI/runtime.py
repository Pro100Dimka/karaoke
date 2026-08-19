
from __future__ import annotations

import contextlib
import os
import platform
import threading
from dataclasses import asdict, dataclass, replace
from typing import Literal

from .backend_registry import AI_BACKEND_REGISTRY, BackendSpec
from .utils.env import env_flag

ComputePreference = Literal["auto", "cuda", "cpu"]
PRODUCTION_QUALITY = frozenset({"baseline", "validated"})
MODEL_ROLES = {
    "separation": "separation",
    "fcpe": "pitch",
    "asr": "ASR",
    "ctc_ru": "CTC RU",
    "ctc_uk": "CTC UK",
    "aligner": "aligner",
}


@dataclass(frozen=True, slots=True)
class GPUInfo:
    name: str
    vendor: str
    memory_bytes: int = 0


@dataclass(frozen=True, slots=True)
class HardwareProfile:
    cpu: str
    logical_cores: int
    ram_bytes: int
    gpus: tuple[GPUInfo, ...]
    torch_available: bool
    cuda_available: bool
    cuda_version: str = ""


@dataclass(frozen=True, slots=True)
class RuntimePlan:
    preference: ComputePreference
    hardware: HardwareProfile
    selected: dict[str, BackendSpec]
    fallbacks: dict[str, tuple[BackendSpec, ...]]
    warnings: tuple[str, ...] = ()

    def describe(self) -> dict[str, object]: return {'preference': self.preference, 'hardware': asdict(self.hardware), 'selected': {name: spec.describe() for name, spec in self.selected.items()}, 'fallbacks': {name: [spec.key for spec in specs] for name, specs in self.fallbacks.items()}, 'warnings': list(self.warnings)}


def _vendor(name: str) -> str:
    lowered = name.casefold()
    if "nvidia" in lowered: return "nvidia"
    if "amd" in lowered or "radeon" in lowered: return "amd"
    return 'intel' if 'intel' in lowered else 'unknown'


def _windows_gpu_names() -> tuple[str, ...]:
    if os.name != "nt": return ()
    try:
        import winreg

        root = r"SYSTEM\CurrentControlSet\Control\Video"
        names: list[str] = []
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root) as video:
            for index in range(winreg.QueryInfoKey(video)[0]):
                guid = winreg.EnumKey(video, index)
                try:
                    with winreg.OpenKey(video, rf"{guid}\0000") as adapter:
                        value = str(winreg.QueryValueEx(adapter, "Device Description")[0]).strip()
                        if value: names.append(value)
                except OSError:
                    continue
        return tuple(dict.fromkeys(names))
    except (ImportError, OSError):
        return ()


def detect_hardware(torch_module=None) -> HardwareProfile:
    cpu, logical_cores, ram_bytes = platform.processor().strip() or os.getenv('PROCESSOR_IDENTIFIER', '').strip(), os.cpu_count() or 1, 0
    try:
        import psutil

        ram_bytes = int(psutil.virtual_memory().total)
        cpu = cpu or platform.uname().processor
    except (ImportError, OSError, AttributeError):
        pass

    torch_available, cuda_available, cuda_version = False, False, ''
    cuda_gpu: GPUInfo | None = None
    try:
        torch = torch_module
        if torch is None:
            import torch

        torch_available = True
        cuda_available = bool(torch.cuda.is_available())
        cuda_version = str(getattr(getattr(torch, "version", None), "cuda", "") or "")
        if cuda_available:
            try:
                name = str(torch.cuda.get_device_name(0))
                properties = torch.cuda.get_device_properties(0)
                cuda_gpu = GPUInfo(
                    name,
                    _vendor(name),
                    int(getattr(properties, "total_memory", 0)),
                )
            except (OSError, RuntimeError, AttributeError):
                pass
    except (ImportError, OSError, RuntimeError, AttributeError):
        cuda_available = False

    gpus = [GPUInfo(name, _vendor(name)) for name in _windows_gpu_names()]
    if cuda_gpu is not None:
        matches = [
            index
            for index, gpu in enumerate(gpus)
            if gpu.name.casefold() == cuda_gpu.name.casefold()
        ]
        if matches:
            gpus[matches[0]] = cuda_gpu
        else:
            gpus.insert(0, cuda_gpu)
    return HardwareProfile(
        cpu=cpu or "Unknown CPU",
        logical_cores=logical_cores,
        ram_bytes=ram_bytes,
        gpus=tuple(gpus),
        torch_available=torch_available,
        cuda_available=cuda_available,
        cuda_version=cuda_version,
    )



def _cpu_thread_settings(logical_cores: int) -> tuple[int, int]:
    physical = logical_cores
    try:
        import psutil

        physical = max(1, int(psutil.cpu_count(logical=False) or logical_cores))
    except (ImportError, OSError, TypeError, ValueError):
        pass
    raw_intra = os.getenv("KARAOKE_CPU_INTRAOP_THREADS", "auto").strip().lower()
    try:
        intra = physical if raw_intra in {"", "auto"} else int(raw_intra)
    except ValueError:
        intra = physical
    try:
        inter = int(os.getenv("KARAOKE_CPU_INTEROP_THREADS", "1").strip())
    except ValueError:
        inter = 1
    logical = max(1, logical_cores)
    return max(1, min(intra, logical)), max(1, min(inter, logical))


def _apply_cpu_tuning(hardware: HardwareProfile, torch_module=None) -> tuple[int, int] | None:
    if not env_flag("KARAOKE_CPU_TUNING"): return None
    intra, inter = _cpu_thread_settings(hardware.logical_cores)
    os.environ["OMP_NUM_THREADS"] = str(intra)
    os.environ["MKL_NUM_THREADS"] = str(intra)
    try:
        torch = torch_module
        if torch is None:
            import torch

        if (setter := getattr(torch, "set_num_threads", None)) is not None: setter(intra)
        if (setter := getattr(torch, "set_num_interop_threads", None)) is not None:
            with contextlib.suppress(RuntimeError): setter(inter)
    except (ImportError, RuntimeError):
        return None
    return intra, inter

_lock = threading.RLock()
_plan: RuntimePlan | None = None
_failed: dict[str, set[str]] = {}


def _preference(value: str | None) -> ComputePreference:
    normalized = (value or os.getenv("SONGAPP_DEVICE", "auto")).strip().lower()
    return normalized if normalized in {"auto", "cuda", "cpu"} else "auto"


def _available(spec: BackendSpec, hardware: HardwareProfile) -> bool: return hardware.torch_available and (spec.device != 'cuda' or hardware.cuda_available) if spec.backend == 'pytorch' else spec.availability().available


def _choose(
    model: str,
    preference: ComputePreference,
    hardware: HardwareProfile,
) -> BackendSpec | None:
    candidates, failed = AI_BACKEND_REGISTRY.candidates(model, quality=PRODUCTION_QUALITY), _failed.get(model, set())
    for spec in candidates:
        if spec.key in failed or (preference == "cpu" and spec.device != "cpu"): continue
        if _available(spec, hardware): return spec
    return None


def configure_runtime(
    preference: str | None = None,
    *,
    force: bool = False,
    torch_module=None,
) -> RuntimePlan:
    global _plan
    selected_preference = _preference(preference)
    with _lock:
        if _plan is not None and not force and _plan.preference == selected_preference: return _plan
        hardware = detect_hardware(torch_module)
        selected: dict[str, BackendSpec] = {}
        fallbacks: dict[str, tuple[BackendSpec, ...]] = {}
        warnings: list[str] = []
        if selected_preference == "cuda" and not hardware.cuda_available: warnings.append("CUDA was requested but is unavailable; using safe CPU fallbacks")
        for model in MODEL_ROLES:
            spec = _choose(model, selected_preference, hardware)
            if spec is None:
                warnings.append(f"No production backend is available for {model}")
                continue
            selected[model] = spec
            chain = AI_BACKEND_REGISTRY.fallback_chain(model, spec.key)
            fallbacks[model] = tuple(
                item for item in chain[1:] if item.quality_status in PRODUCTION_QUALITY
            )
        if selected_preference == "cpu": _apply_cpu_tuning(hardware, torch_module)
        _plan = RuntimePlan(
            selected_preference,
            hardware,
            selected,
            fallbacks,
            tuple(warnings),
        )
        return _plan


def get_runtime_plan() -> RuntimePlan:
    with _lock: return _plan or configure_runtime()


def selected_backend(model: str) -> BackendSpec | None: return get_runtime_plan().selected.get(model)


def mark_backend_failed(model: str, key: str, error: BaseException) -> BackendSpec | None:
    global _plan
    with _lock:
        _failed.setdefault(model, set()).add(key)
        plan = get_runtime_plan()
        replacement = _choose(model, plan.preference, plan.hardware)
        selected = dict(plan.selected)
        fallbacks = dict(plan.fallbacks)
        if replacement is None:
            selected.pop(model, None)
            fallbacks.pop(model, None)
        else:
            selected[model] = replacement
            chain = AI_BACKEND_REGISTRY.fallback_chain(model, replacement.key)
            fallbacks[model] = tuple(
                item for item in chain[1:] if item.quality_status in PRODUCTION_QUALITY
            )
        warning = f"{model}: {key} failed ({type(error).__name__}: {error}); fallback selected"
        _plan = replace(
            plan,
            selected=selected,
            fallbacks=fallbacks,
            warnings=(*plan.warnings, warning),
        )
        return replacement


def reset_runtime_for_tests() -> None:
    global _plan
    with _lock:
        _plan = None
        _failed.clear()


def format_runtime_plan(plan: RuntimePlan | None = None) -> tuple[str, ...]:
    plan = plan or get_runtime_plan()
    gpu, tuning = ', '.join((item.name for item in plan.hardware.gpus)) or 'none', _cpu_thread_settings(plan.hardware.logical_cores) if plan.preference == 'cpu' and env_flag('KARAOKE_CPU_TUNING') else None
    lines = (
        f"CPU: {plan.hardware.cpu} ({plan.hardware.logical_cores} logical cores)",
        *(
            (
                f"CPU tuning: intraop={tuning[0]}, interop={tuning[1]}, "
                f"separation_inference_mode={'on' if env_flag('KARAOKE_CPU_INFERENCE_MODE') else 'off'}",
            )
            if tuning is not None
            else ()
        ),
        f"GPU: {gpu}",
        f"CUDA: {'available' if plan.hardware.cuda_available else 'unavailable'}"
        + (f" ({plan.hardware.cuda_version})" if plan.hardware.cuda_version else ""),
        "Selected backends:",
        *(f"  {MODEL_ROLES[model]} -> {spec.key}" for model, spec in plan.selected.items()),
        "Fallbacks:",
        *(
            f"  {MODEL_ROLES[model]} -> " + (" -> ".join(spec.key for spec in specs) or "none")
            for model, specs in plan.fallbacks.items()
        ),
    )
    return (*lines, *(f"Warning: {warning}" for warning in plan.warnings))
