from __future__ import annotations

import os
import platform
import time
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ResourceSnapshot:
    wall_time: float
    rss_mb: float | None
    cuda_allocated_mb: float | None
    cuda_reserved_mb: float | None
    warnings: tuple[str, ...] = ()


def snapshot() -> ResourceSnapshot:
    warnings: list[str] = []
    rss = None
    try:
        import psutil

        rss = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
    except ImportError:
        warnings.append("psutil is not installed")
    except OSError as exc:
        warnings.append(f"Unable to read process memory: {exc}")

    allocated = None
    reserved = None
    try:
        import torch

        if torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated() / 1024 / 1024
            reserved = torch.cuda.memory_reserved() / 1024 / 1024
    except ImportError:
        warnings.append("torch is not installed")
    except RuntimeError as exc:
        warnings.append(f"Unable to read CUDA memory: {exc}")

    return ResourceSnapshot(
        wall_time=time.perf_counter(),
        rss_mb=rss,
        cuda_allocated_mb=allocated,
        cuda_reserved_mb=reserved,
        warnings=tuple(warnings),
    )


def delta(start: ResourceSnapshot, end: ResourceSnapshot) -> dict:
    return {
        "elapsed_sec": max(0.0, end.wall_time - start.wall_time),
        "rss_mb": end.rss_mb,
        "cuda_allocated_mb": end.cuda_allocated_mb,
        "cuda_reserved_mb": end.cuda_reserved_mb,
        "warnings": list(dict.fromkeys((*start.warnings, *end.warnings))),
    }


def environment_info() -> dict:
    info: dict[str, object] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
    }
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda_available"] = bool(torch.cuda.is_available())
        info["torch_cuda"] = getattr(torch.version, "cuda", None)
        if torch.cuda.is_available():
            info["gpu"] = torch.cuda.get_device_name(0)
            properties = torch.cuda.get_device_properties(0)
            info["vram_mb"] = round(properties.total_memory / 1024 / 1024)
    except ImportError as exc:
        info["cuda_available"] = False
        info["torch_error"] = str(exc)
    except RuntimeError as exc:
        info["cuda_available"] = False
        info["torch_error"] = str(exc)
    return info
