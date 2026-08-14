"""CTC inference adapters used by production and optional shadow validation."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from ..backend_registry import CTC_BACKEND_REGISTRY, ctc_onnx_path
from ..errors import EngineUnavailableError
from ..profiler import profile_operation


class CTCInferenceBackend(Protocol):
    def infer(self, input_values, attention_mask=None): ...

    def release(self) -> None: ...


class PyTorchCTCBackend:
    """Stateless adapter around the current authoritative PyTorch model."""

    def __init__(self, model, device: str):
        self.model = model
        self.device = device

    def infer(self, input_values, attention_mask=None):
        try:
            import torch
        except ImportError as exc:
            raise EngineUnavailableError("torch is required for CTC alignment") from exc
        kwargs = {"input_values": input_values}
        if attention_mask is not None:
            kwargs["attention_mask"] = attention_mask
        with torch.inference_mode(), profile_operation("inference.ctc"):
            if str(self.device).startswith("cuda"):
                with torch.autocast(device_type="cuda", dtype=torch.float16):
                    return self.model(**kwargs).logits[0].float()
            return self.model(**kwargs).logits[0].float()

    def release(self) -> None:
        return None


@dataclass(frozen=True, slots=True)
class ShadowInference:
    logits: np.ndarray
    session_initialization_sec: float
    inference_sec: float
    input_bytes: int
    output_bytes: int
    providers: tuple[str, ...]


class OrtCudaCTCBackend:
    """Lazy optional ORT CUDA adapter; importing this module never imports ORT."""

    def __init__(self, model: str, artifact: Path | None = None):
        self.model = model
        self.artifact = artifact or ctc_onnx_path(model)
        self._session = None
        self._providers: tuple[str, ...] = ()
        self.last_initialization_sec = 0.0

    def availability(self):
        return CTC_BACKEND_REGISTRY.get(self.model, "onnxruntime:cuda:fp16").availability()

    def _load(self):
        if self._session is not None:
            self.last_initialization_sec = 0.0
            return self._session
        availability = self.availability()
        if not availability.available:
            raise EngineUnavailableError(availability.reason)
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as exc:
            raise EngineUnavailableError("ONNX Runtime CUDA is unavailable") from exc
        if self.artifact is None:
            raise EngineUnavailableError(f"ONNX artifact is not configured for {self.model}")
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        started = time.perf_counter()
        with profile_operation(f"model.load.{self.model}.shadow_ort"):
            session = ort.InferenceSession(
                str(self.artifact),
                sess_options=options,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
        self.last_initialization_sec = time.perf_counter() - started
        self._providers = tuple(session.get_providers())
        if not self._providers or self._providers[0] != "CUDAExecutionProvider":
            raise EngineUnavailableError(
                f"ORT session did not activate CUDAExecutionProvider: {self._providers}"
            )
        # The Python wrapper otherwise retries an execution-provider failure on
        # CPU. That silently turns a CUDA shadow benchmark into a CPU result and
        # can retain a second large runtime unexpectedly. A CUDA adapter must
        # fail explicitly; the caller owns the backend fallback chain.
        disable_fallback = getattr(session, "disable_fallback", None)
        if disable_fallback is not None:
            disable_fallback()
        self._session = session
        return session

    def infer(self, input_values, attention_mask=None) -> ShadowInference:
        del attention_mask  # Exported CTC cores accept normalized waveform only.
        session = self._load()
        values = np.ascontiguousarray(input_values, dtype=np.float32)
        started = time.perf_counter()
        with profile_operation(f"inference.{self.model}.shadow_ort", byte_count=int(values.nbytes)):
            logits = np.asarray(session.run(None, {session.get_inputs()[0].name: values})[0])[0]
        elapsed = time.perf_counter() - started
        return ShadowInference(
            logits,
            self.last_initialization_sec,
            elapsed,
            int(values.nbytes),
            int(logits.nbytes),
            self._providers,
        )

    def release(self) -> None:
        self._session = None
        self._providers = ()
        self.last_initialization_sec = 0.0


def describe_inference(result: ShadowInference) -> dict[str, object]:
    data = asdict(result)
    data.pop("logits")
    return data
