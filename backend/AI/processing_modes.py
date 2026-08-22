from dataclasses import dataclass
from typing import Literal

ProcessingMode = Literal["fast", "balanced", "quality"]


@dataclass(frozen=True, slots=True)
class ProcessingProfile:
    mode: ProcessingMode
    separation_overlap: float
    separation_batch_size: int
    wpe_iterations: int

    def fingerprint(self) -> dict[str, object]:
        return {"mode": self.mode, "separation_overlap": self.separation_overlap, "separation_batch_size": self.separation_batch_size, "wpe_iterations": self.wpe_iterations}


def normalize_processing_mode(value: str | None) -> ProcessingMode:
    mode = str(value or "auto").strip().lower()
    if mode == "auto":
        return "balanced"
    if mode not in {"fast", "balanced", "quality"}:
        raise ValueError(f"Unsupported processing mode: {value}")
    return mode  # type: ignore[return-value]


def resolve_processing_profile(value: str | None, runtime=None, **_context) -> ProcessingProfile:
    mode = normalize_processing_mode(value)
    hardware = getattr(runtime, "hardware", None)
    separation = getattr(runtime, "selected", {}).get("separation") if runtime else None
    if getattr(separation, "device", "cpu") == "cuda":
        memory = max((getattr(gpu, "memory_bytes", 0) for gpu in getattr(hardware, "gpus", ())), default=0)
        batch = 4 if memory >= 12 * 1024**3 else 2 if memory >= 6 * 1024**3 else 1
    else:
        batch = 2 if getattr(hardware, "logical_cores", 0) >= 8 and getattr(hardware, "ram_bytes", 0) >= 16 * 1024**3 else 1
    if mode == "fast":
        return ProcessingProfile(mode, 20 / 19, batch, 1)
    if mode == "quality":
        return ProcessingProfile(mode, 4, batch, 6)
    return ProcessingProfile(mode, 2, batch, 3)
