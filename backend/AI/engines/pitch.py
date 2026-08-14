from __future__ import annotations

import numpy as np

from ..audio import load_mono
from ..errors import EngineUnavailableError
from ..models import PitchFrame
from ..profiler import profile_operation
from .base import PitchEstimator
from .device import select_torch_device


class FCPEPitchEstimator(PitchEstimator):
    name = "fcpe"

    def __init__(self, sr=16000, hop=160, fmin=55.0, fmax=1400.0):
        self.sr = int(sr)
        self.hop = max(1, int(hop))
        self.fmin = float(fmin)
        self.fmax = float(fmax)
        self._model = None
        self._device = None

    def fingerprint(self) -> dict[str, object]:
        return {
            "name": self.name,
            "sample_rate": self.sr,
            "hop": self.hop,
            "fmin": self.fmin,
            "fmax": self.fmax,
            "decoder": "local_argmax",
            "threshold": 0.006,
            "confidence_semantics": "fcpe-vuv-v2",
        }

    def _load_model(self):
        try:
            import torch
            import torchfcpe
        except ImportError as exc:
            raise EngineUnavailableError("Install torch and torchfcpe for FCPE") from exc
        if self._model is None:
            self._device = select_torch_device(torch)
            with profile_operation("model.load.fcpe"):
                self._model = torchfcpe.spawn_bundled_infer_model(device=self._device)
        return torch, self._model

    def estimate(self, audio):
        torch, model = self._load_model()
        y, _ = load_mono(audio, self.sr)
        if y.size == 0:
            return []

        # Source separators may emit floating-point samples just outside the
        # conventional range. TorchFCPE rejects those tensors, so attenuate only
        # truly clipped input while preserving the waveform and dynamics.
        y = np.asarray(y, dtype=np.float32)
        peak = float(np.max(np.abs(y)))
        if peak > 0.999:
            y = np.ascontiguousarray(y * (0.999 / peak), dtype=np.float32)

        # Official TorchFCPE input shape is [batch, samples, channel].
        tensor = torch.from_numpy(np.asarray(y, dtype=np.float32)).unsqueeze(0).unsqueeze(-1)
        with profile_operation("transfer.cpu_to_gpu.fcpe", byte_count=y.nbytes):
            tensor = tensor.to(self._device)
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
                result = model.infer(tensor, **kwargs)
            except TypeError:
                # Compatibility with older torchfcpe releases.
                compatible = {
                    key: value
                    for key, value in kwargs.items()
                    if key in {"sr", "decoder_mode", "threshold"}
                }
                result = model.infer(tensor, **compatible)

        if isinstance(result, (tuple, list)):
            f0_tensor = result[0]
            confidence_tensor = result[1] if len(result) > 1 else None
        else:
            f0_tensor = result
            confidence_tensor = None

        with profile_operation("postprocess.fcpe"):
            f0 = np.asarray(f0_tensor.squeeze().detach().cpu(), dtype=np.float32).reshape(-1)
        confidence = None
        if confidence_tensor is not None:
            candidate = np.asarray(
                confidence_tensor.squeeze().detach().cpu(), dtype=np.float32
            ).reshape(-1)
            if len(candidate) == len(f0):
                confidence = candidate

        step = (
            self.hop / self.sr if len(f0) == target_length else len(y) / self.sr / max(1, len(f0))
        )
        energy_window = max(32, int(self.sr * 0.025))
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
                conf = max(0.0, min(1.0, float(confidence[index])))
                voiced = bool(valid and conf >= 0.05)
            else:
                # TorchFCPE's documented infer() API returns f0 after its own
                # threshold-based V/UV decision. Do not reinterpret waveform RMS
                # as model confidence: doing so silently deletes quiet valid notes
                # and promotes loud leakage/noise. Energy remains a separate feature.
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
        return output


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
        if y.size == 0:
            return []
        hop = max(64, int(sr * self.hop_seconds))
        frame = 2048
        f0, voiced, probability = librosa.pyin(
            y,
            fmin=self.fmin,
            fmax=self.fmax,
            sr=sr,
            frame_length=frame,
            hop_length=hop,
            fill_na=np.nan,
        )
        rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop, center=True)[0]
        times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)
        output = []
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
