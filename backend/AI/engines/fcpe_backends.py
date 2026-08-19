
from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass

import numpy as np

from ..backend_registry import AI_BACKEND_REGISTRY, fcpe_onnx_path
from ..errors import EngineUnavailableError
from ..profiler import profile_operation
from .ort_session import OrtSessionMixin


def decode_fcpe_latent(
    latent: np.ndarray,
    cent_table: np.ndarray,
    *,
    threshold: float = 0.006,
) -> tuple[np.ndarray, np.ndarray]:
    confidence, center, offsets = latent.max(axis=-1), latent.argmax(axis=-1), np.arange(-4, 5); indices = np.clip(center[..., None] + offsets, 0, latent.shape[-1] - 1); local, cents = np.take_along_axis(latent, indices, axis=-1), np.take(cent_table, indices); decoded = (local * cents).sum(axis=-1) / np.maximum(local.sum(axis=-1), 1e-30)
    f0 = 10.0 * np.power(2.0, decoded / 1200.0); f0[confidence <= threshold] = 0.0; return f0.astype(np.float32), confidence.astype(np.float32)


def nearest_resize(values: np.ndarray, length: int) -> np.ndarray:
    if values.shape[-1] == length: return values
    indices = np.floor(np.arange(length) * values.shape[-1] / length).astype(np.int64); return values[..., np.minimum(indices, values.shape[-1] - 1)]


@dataclass(frozen=True, slots=True)
class FCPEInference: f0: np.ndarray; confidence: np.ndarray; session_initialization_sec: float; inference_sec: float; input_bytes: int; output_bytes: int; providers: tuple[str, ...]


class _OrtFCPEBackend(OrtSessionMixin):

    key = ""
    provider = ""
    load_metric = "model.load.fcpe.shadow_ort"
    inference_metric = "inference.fcpe.shadow_ort"
    artifact_message = "FCPE ONNX artifact is not configured"

    def __init__(self, artifact=None): self.artifact = artifact or fcpe_onnx_path(); self._session = None; self._providers: tuple[str, ...] = (); self._run_lock = threading.Lock(); self.last_initialization_sec = 0.0

    def availability(self): return AI_BACKEND_REGISTRY.get('fcpe', self.key).availability()

    def _configure_options(self, ort, options) -> None: return None

    def infer(
        self,
        mel: np.ndarray,
        cent_table: np.ndarray,
        *,
        target_length: int,
    ) -> FCPEInference:
        session, values, started = self._load(), np.ascontiguousarray(mel, dtype=np.float32), time.perf_counter()
        with self._run_lock, profile_operation(self.inference_metric, byte_count=int(values.nbytes)): latent = np.asarray(session.run(None, {session.get_inputs()[0].name: values})[0])
        elapsed = time.perf_counter() - started; f0, confidence = decode_fcpe_latent(latent, cent_table); f0, confidence = nearest_resize(f0, target_length), nearest_resize(confidence, target_length)
        return FCPEInference(
            f0[0],
            confidence[0],
            self.last_initialization_sec,
            elapsed,
            int(values.nbytes),
            int(latent.nbytes),
            self._providers,
        )


class OrtCudaFCPEBackend(_OrtFCPEBackend):

    key = "onnxruntime:cuda:fp16"
    provider = "CUDAExecutionProvider"


class OrtDirectMLFCPEBackend(_OrtFCPEBackend):

    key = "onnxruntime:directml:fp32"
    provider = "DmlExecutionProvider"
    load_metric = "model.load.fcpe.shadow_directml"
    inference_metric = "inference.fcpe.shadow_directml"

    def _configure_options(self, ort, options) -> None: options.enable_mem_pattern = False; options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL


def describe_fcpe_inference(result: FCPEInference) -> dict[str, object]: data = asdict(result); data.pop("f0"); data.pop("confidence"); return data
