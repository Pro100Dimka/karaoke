"""Model-specific inference backend metadata and explicit fallback policies.

The registry describes capabilities; it does not choose an end-to-end execution
plan.  Keeping policy separate prevents an optional runtime from becoming a
startup dependency and leaves room for a future hardware-aware planner.
"""

from __future__ import annotations

import importlib.util
import os
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from .model_registry import get_model

QualityStatus = Literal["baseline", "shadow", "validated", "disabled"]
BenchmarkStatus = Literal["baseline", "isolated", "corpus", "unmeasured"]


@dataclass(frozen=True, slots=True)
class BackendAvailability:
    available: bool
    reason: str


@dataclass(frozen=True, slots=True)
class MemoryRequirements:
    ram_bytes: int = 0
    vram_bytes: int = 0


@dataclass(frozen=True, slots=True)
class ArtifactRequirement:
    kind: str
    location: str
    required: bool = True


@dataclass(frozen=True, slots=True)
class RuntimeRequirement:
    name: str
    version: str = ""
    optional: bool = True


@dataclass(frozen=True, slots=True)
class SupportedShapes:
    dynamic_axes: tuple[str, ...]
    min_samples: int
    max_samples: int | None = None
    batch_sizes: tuple[int, ...] = (1,)


AvailabilityProbe = Callable[[], BackendAvailability]


@dataclass(frozen=True, slots=True)
class BackendSpec:
    model: str
    backend: str
    device: str
    precision: str
    availability: AvailabilityProbe
    priority: int
    memory_requirements: MemoryRequirements
    artifact_requirements: tuple[ArtifactRequirement, ...]
    capabilities: frozenset[str]
    supported_shapes: SupportedShapes
    quality_status: QualityStatus
    benchmark_status: BenchmarkStatus
    fallback: tuple[str, ...] = ()
    vendor: str = "any"
    runtime_requirements: tuple[RuntimeRequirement, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.backend}:{self.device}:{self.precision}"

    def describe(self) -> dict[str, object]:
        availability = self.availability()
        result = asdict(self)
        result["availability"] = asdict(availability)
        result["key"] = self.key
        return result


class BackendRegistry:
    """Registry with deterministic ordering and validated fallback references."""

    def __init__(self, specs: Iterable[BackendSpec] = ()):
        self._specs: dict[tuple[str, str], BackendSpec] = {}
        for spec in specs:
            self.register(spec)

    def register(self, spec: BackendSpec) -> None:
        identity = (spec.model, spec.key)
        if identity in self._specs:
            raise ValueError(f"Backend already registered: {spec.model}/{spec.key}")
        self._specs[identity] = spec

    def get(self, model: str, key: str) -> BackendSpec:
        try:
            return self._specs[(model, key)]
        except KeyError as exc:
            raise KeyError(f"Unknown backend: {model}/{key}") from exc

    def candidates(
        self,
        model: str,
        *,
        available_only: bool = False,
        quality: frozenset[QualityStatus] | None = None,
    ) -> tuple[BackendSpec, ...]:
        result = [spec for (name, _), spec in self._specs.items() if name == model]
        if quality is not None:
            result = [spec for spec in result if spec.quality_status in quality]
        if available_only:
            result = [spec for spec in result if spec.availability().available]
        return tuple(sorted(result, key=lambda spec: (-spec.priority, spec.key)))

    def fallback_chain(self, model: str, start: str) -> tuple[BackendSpec, ...]:
        output: list[BackendSpec] = []
        pending = [start]
        seen: set[str] = set()
        while pending:
            key = pending.pop(0)
            seen.add(key)
            spec = self.get(model, key)
            output.append(spec)
            if any(fallback in seen for fallback in spec.fallback):
                repeated = next(fallback for fallback in spec.fallback if fallback in seen)
                raise ValueError(f"Fallback cycle detected for {model}/{repeated}")
            pending[0:0] = [fallback for fallback in spec.fallback if fallback not in pending]
        return tuple(output)

    def describe(self, model: str | None = None) -> tuple[dict[str, object], ...]:
        specs = self.candidates(model) if model else tuple(self._specs.values())
        return tuple(spec.describe() for spec in specs)


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _pytorch_availability(require_cuda: bool) -> BackendAvailability:
    if not _module_available("torch"):
        return BackendAvailability(False, "PyTorch is not installed")
    if not require_cuda:
        return BackendAvailability(True, "PyTorch CPU runtime is installed")
    try:
        import torch

        available = bool(torch.cuda.is_available())
    except (ImportError, OSError, RuntimeError) as exc:
        return BackendAvailability(False, f"PyTorch CUDA probe failed: {exc}")
    return BackendAvailability(
        available,
        "PyTorch CUDA is available" if available else "PyTorch cannot access CUDA",
    )


def ctc_onnx_path(model: str) -> Path | None:
    code = model.removeprefix("ctc_").upper()
    value = os.getenv(f"KARAOKE_AI_CTC_{code}_ONNX", "").strip()
    return Path(value).expanduser() if value else None


def fcpe_onnx_path() -> Path | None:
    value = os.getenv("KARAOKE_AI_FCPE_ONNX", "").strip()
    return Path(value).expanduser() if value else None


def _ort_cuda_availability(model: str) -> BackendAvailability:
    artifact = fcpe_onnx_path() if model == "fcpe" else ctc_onnx_path(model)
    if artifact is None:
        env_var = "KARAOKE_AI_FCPE_ONNX" if model == "fcpe" else f"KARAOKE_AI_{model.upper()}_ONNX"
        return BackendAvailability(False, f"{env_var} is not configured")
    if not artifact.is_file():
        return BackendAvailability(False, f"ONNX artifact does not exist: {artifact}")
    if not _module_available("onnxruntime"):
        return BackendAvailability(False, "ONNX Runtime is not installed")
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
    except (ImportError, OSError, RuntimeError) as exc:
        return BackendAvailability(False, f"ONNX Runtime probe failed: {exc}")
    available = "CUDAExecutionProvider" in providers
    return BackendAvailability(
        available,
        "ORT CUDA is available" if available else "CUDAExecutionProvider is unavailable",
    )


def _ctc_specs(model: str) -> tuple[BackendSpec, ...]:
    model_artifact = ArtifactRequirement("pytorch-snapshot", get_model(model).relative_path)
    onnx_env = f"KARAOKE_AI_{model.upper()}_ONNX"
    common = frozenset({"ctc-logits", "dynamic-time", "batch-1", "forced-alignment"})
    shapes = SupportedShapes(("batch", "time", "frames"), min_samples=400)
    cpu_key = "pytorch:cpu:fp32"
    cuda_key = "pytorch:cuda:fp16"
    return (
        BackendSpec(
            model,
            "onnxruntime",
            "cuda",
            "fp16",
            lambda model=model: _ort_cuda_availability(model),
            300,
            MemoryRequirements(1_800_000_000, 2_300_000_000),
            (ArtifactRequirement("onnx", onnx_env),),
            common | {"optional-runtime", "shadow-only", "corpus-quality-rejected"},
            shapes,
            "disabled",
            "corpus",
            (cuda_key,),
            "nvidia",
            (RuntimeRequirement("onnxruntime-gpu", "1.22"),),
        ),
        BackendSpec(
            model,
            "pytorch",
            "cuda",
            "fp16",
            lambda: _pytorch_availability(True),
            200,
            MemoryRequirements(2_200_000_000, 3_900_000_000),
            (model_artifact,),
            common | {"production"},
            shapes,
            "baseline",
            "baseline",
            (cpu_key,),
            "nvidia",
            (RuntimeRequirement("pytorch", "2.8"),),
        ),
        BackendSpec(
            model,
            "pytorch",
            "cpu",
            "fp32",
            lambda: _pytorch_availability(False),
            100,
            MemoryRequirements(3_800_000_000, 0),
            (model_artifact,),
            common | {"universal-fallback"},
            shapes,
            "baseline",
            "baseline",
            (),
            "any",
            (RuntimeRequirement("pytorch", "2.8"),),
        ),
    )


def _fcpe_specs() -> tuple[BackendSpec, ...]:
    common = frozenset({"pitch", "dynamic-time", "batch-1", "neural-core-only"})
    shapes = SupportedShapes(("batch", "mel_time", "frames"), min_samples=1_600)
    cpu_key = "pytorch:cpu:fp32"
    cuda_key = "pytorch:cuda:fp32"
    return (
        BackendSpec(
            "fcpe",
            "onnxruntime",
            "cuda",
            "fp16",
            lambda: _ort_cuda_availability("fcpe"),
            300,
            MemoryRequirements(1_800_000_000, 1_900_000_000),
            (ArtifactRequirement("onnx", "KARAOKE_AI_FCPE_ONNX"),),
            common | {"optional-runtime", "shadow-only"},
            shapes,
            "shadow",
            "isolated",
            (cuda_key,),
            "nvidia",
            (RuntimeRequirement("onnxruntime-gpu", "1.22"),),
        ),
        BackendSpec(
            "fcpe",
            "pytorch",
            "cuda",
            "fp32",
            lambda: _pytorch_availability(True),
            200,
            MemoryRequirements(1_300_000_000, 1_500_000_000),
            (ArtifactRequirement("python-package-asset", "torchfcpe/assets/fcpe_c_v001.pt"),),
            common | {"production"},
            shapes,
            "baseline",
            "baseline",
            (cpu_key,),
            "nvidia",
            (RuntimeRequirement("pytorch", "2.8"), RuntimeRequirement("torchfcpe", "0.0.4")),
        ),
        BackendSpec(
            "fcpe",
            "pytorch",
            "cpu",
            "fp32",
            lambda: _pytorch_availability(False),
            100,
            MemoryRequirements(1_500_000_000, 0),
            (ArtifactRequirement("python-package-asset", "torchfcpe/assets/fcpe_c_v001.pt"),),
            common | {"universal-fallback"},
            shapes,
            "baseline",
            "baseline",
            (),
            "any",
            (RuntimeRequirement("pytorch", "2.8"), RuntimeRequirement("torchfcpe", "0.0.4")),
        ),
    )


AI_BACKEND_REGISTRY = BackendRegistry(
    (*_fcpe_specs(), *_ctc_specs("ctc_ru"), *_ctc_specs("ctc_uk"))
)
CTC_BACKEND_REGISTRY = AI_BACKEND_REGISTRY
