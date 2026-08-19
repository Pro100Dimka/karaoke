from __future__ import annotations

import os
from contextlib import suppress

import numpy as np

from ..audio import load_mono
from ..backend_shadow import ShadowPolicy
from ..errors import EngineUnavailableError
from ..models import PitchFrame
from ..profiler import profile_operation
from ..utils.numeric import clamp01
from .base import PitchEstimator
from .device import fallback_torch_device, select_torch_device
from .fcpe_backends import (
    OrtCudaFCPEBackend,
    OrtDirectMLFCPEBackend,
    describe_fcpe_inference,
)


class FCPEPitchEstimator(PitchEstimator):
    name = "fcpe"

    def __init__(
        self,
        sr=16000,
        hop=160,
        fmin=55.0,
        fmax=1400.0,
        *,
        shadow_policy: ShadowPolicy | None = None,
        shadow_backend_factory=None,
    ):
        self.sr = int(sr)
        self.hop = max(1, int(hop))
        self.fmin = float(fmin)
        self.fmax = float(fmax)
        self._model = None
        self._device = None
        self._shadow_policy = shadow_policy or ShadowPolicy.from_env("KARAOKE_AI_FCPE_SHADOW")
        self._shadow_backend_factory = shadow_backend_factory
        self._shadow_backend = None
        self.last_shadow_diagnostics: dict[str, object] = {"selected": False}
        self.last_shadow_frames: list[PitchFrame] = []

    def fingerprint(self) -> dict[str, object]: return {'name': self.name, 'sample_rate': self.sr, 'hop': self.hop, 'fmin': self.fmin, 'fmax': self.fmax, 'decoder': 'local_argmax', 'threshold': 0.006, 'confidence_semantics': 'fcpe-vuv-v2'}

    def _load_model(self):
        try:
            import torch
            import torchfcpe
        except ImportError as exc:
            raise EngineUnavailableError("Install torch and torchfcpe for FCPE") from exc
        if self._model is None:
            self._device = select_torch_device(torch, "fcpe")
            with profile_operation("model.load.fcpe"):
                try:
                    self._model = torchfcpe.spawn_bundled_infer_model(device=self._device)
                except Exception as exc:
                    fallback = fallback_torch_device("fcpe", self._device, exc)
                    if fallback is None: raise
                    self._device = fallback
                    self._model = torchfcpe.spawn_bundled_infer_model(device=fallback)
        return torch, self._model

    @staticmethod
    def _infer(model, tensor, kwargs):
        try:
            return model.infer(tensor, **kwargs)
        except TypeError:
            compatible = {
                key: value
                for key, value in kwargs.items()
                if key in {"sr", "decoder_mode", "threshold"}
            }
            return model.infer(tensor, **compatible)

    def estimate(self, audio):
        torch, model = self._load_model()
        y, _ = load_mono(audio, self.sr)
        if y.size == 0: return []

        y = np.asarray(y, dtype=np.float32)
        peak = float(np.max(np.abs(y)))
        if peak > 0.999: y = np.ascontiguousarray(y * (0.999 / peak), dtype=np.float32)

        tensor = torch.from_numpy(np.asarray(y, dtype=np.float32)).unsqueeze(0).unsqueeze(-1)
        with profile_operation("transfer.cpu_to_gpu.fcpe", byte_count=y.nbytes): tensor = tensor.to(self._device)
        target_length = (len(y) // self.hop) + 1
        kwargs = {
            "sr": self.sr,
            "decoder_mode": "local_argmax",
            "threshold": 0.006,
            "f0_min": self.fmin,
            "f0_max": self.fmax,
            "interp_uv": False,
            "output_interp_target_length": target_length,
        }
        with torch.inference_mode(), profile_operation("inference.fcpe"):
            try:
                result = self._infer(model, tensor, kwargs)
            except Exception as exc:
                fallback = fallback_torch_device("fcpe", self._device, exc)
                if fallback is None: raise
                self._model = None
                torch, model = self._load_model()
                with profile_operation("transfer.cpu_to_gpu.fcpe", byte_count=y.nbytes):
                    tensor = (
                        torch.from_numpy(np.asarray(y, dtype=np.float32))
                        .unsqueeze(0)
                        .unsqueeze(-1)
                        .to(fallback)
                    )
                result = self._infer(model, tensor, kwargs)

        if isinstance(result, (tuple, list)):
            f0_tensor = result[0]
            confidence_tensor = result[1] if len(result) > 1 else None
        else:
            f0_tensor = result
            confidence_tensor = None

        with profile_operation("postprocess.fcpe"): f0 = np.asarray(f0_tensor.squeeze().detach().cpu(), dtype=np.float32).reshape(-1)
        confidence = None
        if confidence_tensor is not None:
            candidate = np.asarray(
                confidence_tensor.squeeze().detach().cpu(), dtype=np.float32
            ).reshape(-1)
            if len(candidate) == len(f0): confidence = candidate

        step, energy_window = self.hop / self.sr if len(f0) == target_length else len(y) / self.sr / max(1, len(f0)), max(32, int(self.sr * 0.025))
        output: list[PitchFrame] = []
        for index, value in enumerate(f0):
            hz = float(value)
            start = min(len(y), int(round(index * step * self.sr)))
            end = min(len(y), start + energy_window)
            energy = (
                float(np.sqrt(np.mean(np.square(y[start:end])) + 1e-12)) if end > start else 0.0
            )
            valid = np.isfinite(hz) and self.fmin <= hz <= self.fmax
            if confidence is not None:
                conf = clamp01(float(confidence[index]))
                voiced = bool(valid and conf >= 0.05)
            else:
                voiced = bool(valid)
                conf = 1.0 if voiced else 0.0
            output.append(
                PitchFrame(
                    time=index * step,
                    frequency=hz if voiced else 0.0,
                    confidence=conf if voiced else 0.0,
                    voiced=voiced,
                    energy=energy,
                )
            )
        self._run_shadow(audio, model, tensor, y, target_length, output)
        return output

    def _configured_shadow_class(self):
        backend = os.getenv("KARAOKE_AI_FCPE_SHADOW_BACKEND", "cuda").strip().casefold()
        if backend in {"directml", "dml"}: return OrtDirectMLFCPEBackend
        if backend in {"cuda", "ort-cuda", "onnxruntime-cuda"}: return OrtCudaFCPEBackend
        raise EngineUnavailableError(f"Unknown FCPE shadow backend: {backend}")

    def _create_shadow_backend(self): return self._shadow_backend_factory() if self._shadow_backend_factory is not None else self._configured_shadow_class()()

    def _shadow_key(self) -> str:
        if self._shadow_backend is not None: return str(getattr(self._shadow_backend, "key", "custom"))
        if self._shadow_backend_factory is not None: return str(getattr(self._shadow_backend_factory, "key", "custom"))
        try:
            return str(getattr(self._configured_shadow_class(), "key", "custom"))
        except EngineUnavailableError as exc:
            return f"invalid:{exc}"

    def _run_shadow(self, audio, model, tensor, y, target_length, production) -> None:
        selected = self._shadow_policy.selects(str(audio))
        self.last_shadow_frames = []
        self.last_shadow_diagnostics = {
            "selected": selected,
            "production": "pytorch:auto:fp32",
            "shadow": self._shadow_key(),
            "resident": self._shadow_policy.keep_session_resident,
        }
        if not selected: return
        try:
            if self._shadow_backend is None:
                self._shadow_backend = self._create_shadow_backend()
                self.last_shadow_diagnostics["shadow"] = self._shadow_key()
            mel = np.asarray(model.wav2mel(tensor, self.sr).detach().cpu(), dtype=np.float32)
            cent_table = np.asarray(model.model.cent_table.detach().cpu(), dtype=np.float32)
            candidate = self._shadow_backend.infer(
                mel,
                cent_table,
                target_length=target_length,
            )
            step = self.hop / self.sr
            frames = []
            for index, value in enumerate(candidate.f0):
                hz = min(float(value), self.fmax)
                valid = np.isfinite(hz) and self.fmin <= hz <= self.fmax
                frames.append(
                    PitchFrame(
                        index * step,
                        hz if valid else 0.0,
                        1.0 if valid else 0.0,
                        bool(valid),
                        production[index].energy if index < len(production) else 0.0,
                    )
                )
            self.last_shadow_frames = frames
            size = min(len(production), len(frames))
            voiced_equal = sum(
                production[index].voiced == frames[index].voiced for index in range(size)
            )
            self.last_shadow_diagnostics.update(
                status="compared",
                **describe_fcpe_inference(candidate),
                production_frames=len(production),
                shadow_frames=len(frames),
                voiced_agreement=voiced_equal / size if size else 1.0,
            )
        except Exception as exc:  # noqa: BLE001 - shadow cannot affect production
            self.last_shadow_diagnostics.update(
                status="failed", error=f"{type(exc).__name__}: {exc}"
            )
        finally:
            if not self._shadow_policy.keep_session_resident: self.release_shadow()

    def release_shadow(self) -> None:
        if self._shadow_backend is not None:
            with suppress(Exception): self._shadow_backend.release()
        self._shadow_backend = None


class PyinFallbackPitchEstimator(PitchEstimator):
    name = "pyin-fallback"

    def __init__(self, sr=16000, hop_seconds=0.01, fmin=55, fmax=1400):
        self.sr = sr
        self.hop_seconds = hop_seconds
        self.fmin = fmin
        self.fmax = fmax

    def estimate(self, audio):
        try:
            import librosa
        except ImportError as exc:
            raise EngineUnavailableError("Install librosa to use the pYIN fallback") from exc

        y, sr = load_mono(audio, self.sr)
        if y.size == 0: return []
        hop, frame = max(64, int(sr * self.hop_seconds)), 2048
        f0, voiced, probability = librosa.pyin(
            y,
            fmin=self.fmin,
            fmax=self.fmax,
            sr=sr,
            frame_length=frame,
            hop_length=hop,
            fill_na=np.nan,
        )
        rms, times, output = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop, center=True)[0], librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop), []
        for index, timestamp in enumerate(times):
            hz = float(f0[index]) if np.isfinite(f0[index]) else 0.0
            is_voiced = bool(voiced[index]) and hz > 0
            output.append(
                PitchFrame(
                    float(timestamp),
                    hz,
                    float(probability[index] if np.isfinite(probability[index]) else 0),
                    is_voiced,
                    float(rms[index] if index < len(rms) else 0),
                )
            )
        return output
