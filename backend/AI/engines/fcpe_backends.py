"""FCPE neural-core adapters for authoritative PyTorch and optional ORT shadow."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import numpy as np

from ..backend_registry import AI_BACKEND_REGISTRY, fcpe_onnx_path
from ..errors import EngineUnavailableError
from ..profiler import profile_operation


def decode_fcpe_latent(
    latent: np.ndarray,
    cent_table: np.ndarray,
    *,
    threshold: float = 0.006,
) -> tuple[np.ndarray, np.ndarray]:
    confidence = latent.max(axis=-1)
    center = latent.argmax(axis=-1)
    offsets = np.arange(-4, 5)
    indices = np.clip(center[..., None] + offsets, 0, latent.shape[-1] - 1)
    local = np.take_along_axis(latent, indices, axis=-1)
    cents = np.take(cent_table, indices)
    decoded = (local * cents).sum(axis=-1) / np.maximum(local.sum(axis=-1), 1e-30)
    f0 = 10.0 * np.power(2.0, decoded / 1200.0)
    f0[confidence <= threshold] = 0.0
    return f0.astype(np.float32), confidence.astype(np.float32)


def nearest_resize(values: np.ndarray, length: int) -> np.ndarray:
    if values.shape[-1] == length:
        return values
    indices = np.floor(np.arange(length) * values.shape[-1] / length).astype(np.int64)
    return values[..., np.minimum(indices, values.shape[-1] - 1)]


@dataclass(frozen=True, slots=True)
class FCPEInference:
    f0: np.ndarray
    confidence: np.ndarray
    session_initialization_sec: float
    inference_sec: float
    input_bytes: int
    output_bytes: int
    providers: tuple[str, ...]


class OrtCudaFCPEBackend:
    """Lazy ORT CUDA adapter for an exported FCPE neural core."""

    def __init__(self, artifact=None):
        self.artifact = artifact or fcpe_onnx_path()
        self._session = None
        self._providers: tuple[str, ...] = ()
        self.last_initialization_sec = 0.0

    def availability(self):
        return AI_BACKEND_REGISTRY.get("fcpe", "onnxruntime:cuda:fp16").availability()

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
            raise EngineUnavailableError("FCPE ONNX artifact is not configured")
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        started = time.perf_counter()
        with profile_operation("model.load.fcpe.shadow_ort"):
            session = ort.InferenceSession(
                str(self.artifact),
                sess_options=options,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
        self.last_initialization_sec = time.perf_counter() - started
        self._providers = tuple(session.get_providers())
        if not self._providers or self._providers[0] != "CUDAExecutionProvider":
            raise EngineUnavailableError(
                f"ORT FCPE session did not activate CUDAExecutionProvider: {self._providers}"
            )
        disable_fallback = getattr(session, "disable_fallback", None)
        if disable_fallback is not None:
            disable_fallback()
        self._session = session
        return session

    def infer(
        self,
        mel: np.ndarray,
        cent_table: np.ndarray,
        *,
        target_length: int,
    ) -> FCPEInference:
        session = self._load()
        values = np.ascontiguousarray(mel, dtype=np.float32)
        started = time.perf_counter()
        with profile_operation("inference.fcpe.shadow_ort", byte_count=int(values.nbytes)):
            latent = np.asarray(session.run(None, {session.get_inputs()[0].name: values})[0])
        elapsed = time.perf_counter() - started
        f0, confidence = decode_fcpe_latent(latent, cent_table)
        f0 = nearest_resize(f0, target_length)
        confidence = nearest_resize(confidence, target_length)
        return FCPEInference(
            f0[0],
            confidence[0],
            self.last_initialization_sec,
            elapsed,
            int(values.nbytes),
            int(latent.nbytes),
            self._providers,
        )

    def release(self) -> None:
        self._session = None
        self._providers = ()
        self.last_initialization_sec = 0.0


def describe_fcpe_inference(result: FCPEInference) -> dict[str, object]:
    data = asdict(result)
    data.pop("f0")
    data.pop("confidence")
    return data
