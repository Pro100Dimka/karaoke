
from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from ..backend_registry import CTC_BACKEND_REGISTRY, ctc_onnx_path
from ..errors import EngineUnavailableError
from ..profiler import profile_operation
from .ort_session import OrtSessionMixin


class CTCInferenceBackend(Protocol):
    def infer(self, input_values, attention_mask=None): ...

    def release(self) -> None: ...


class PyTorchCTCBackend:

    def __init__(self, model, device: str):
        self.model = model
        self.device = device

    def infer(self, input_values, attention_mask=None):
        try:
            import torch
        except ImportError as exc:
            raise EngineUnavailableError("torch is required for CTC alignment") from exc
        kwargs = {"input_values": input_values}
        if attention_mask is not None: kwargs["attention_mask"] = attention_mask
        with torch.inference_mode(), profile_operation("inference.ctc"):
            if str(self.device).startswith("cuda"):
                with torch.autocast(device_type="cuda", dtype=torch.float16): return self.model(**kwargs).logits[0].float()
            return self.model(**kwargs).logits[0].float()

    def release(self) -> None: return None


@dataclass(frozen=True, slots=True)
class ShadowInference:
    logits: np.ndarray
    session_initialization_sec: float
    inference_sec: float
    input_bytes: int
    output_bytes: int
    providers: tuple[str, ...]


class OrtCudaCTCBackend(OrtSessionMixin):

    def __init__(self, model: str, artifact: Path | None = None):
        self.model = model
        self.artifact = artifact or ctc_onnx_path(model)
        self._session = None
        self._providers: tuple[str, ...] = ()
        self.last_initialization_sec = 0.0

    def availability(self): return CTC_BACKEND_REGISTRY.get(self.model, 'onnxruntime:cuda:fp16').availability()

    provider = "CUDAExecutionProvider"
    load_metric = "model.load.ctc.shadow_ort"
    unavailable_message = "ONNX Runtime CUDA is unavailable"

    @property
    def artifact_message(self) -> str:
        return f"ONNX artifact is not configured for {self.model}"

    def _load(self):
        self.load_metric = f"model.load.{self.model}.shadow_ort"
        return super()._load()

    def infer(self, input_values, attention_mask=None) -> ShadowInference:
        del attention_mask  # Exported CTC cores accept normalized waveform only.
        session, values, started = self._load(), np.ascontiguousarray(input_values, dtype=np.float32), time.perf_counter()
        with profile_operation(f"inference.{self.model}.shadow_ort", byte_count=int(values.nbytes)): logits = np.asarray(session.run(None, {session.get_inputs()[0].name: values})[0])[0]
        elapsed = time.perf_counter() - started
        return ShadowInference(
            logits,
            self.last_initialization_sec,
            elapsed,
            int(values.nbytes),
            int(logits.nbytes),
            self._providers,
        )

def describe_inference(result: ShadowInference) -> dict[str, object]:
    data = asdict(result)
    data.pop("logits")
    return data
