from __future__ import annotations

import numpy as np

from ..audio import load_mono
from ..errors import EngineUnavailableError
from ..models import PitchFrame
from .base import PitchEstimator
from .device import select_torch_device


class FCPEPitchEstimator(PitchEstimator):
    name = "fcpe"

    def __init__(self, sr=16000, hop=160, fmin=55.0, fmax=1400.0):
        self.sr, self.hop, self.fmin, self.fmax = int(sr), int(hop), float(fmin), float(fmax)
        self._model = self._device = None

    def _load(self):
        try:
            import torch
            import torchfcpe
        except ImportError as error:
            raise EngineUnavailableError("torchfcpe is unavailable") from error
        if self._model is None:
            self._device = select_torch_device(torch, "pitch")
            self._model = torchfcpe.spawn_bundled_infer_model(device=self._device)
        return torch, self._model

    def estimate(self, audio):
        torch, model = self._load()
        signal, _ = load_mono(audio, self.sr)
        if not signal.size:
            return []
        tensor = torch.from_numpy(signal).view(1, -1, 1).to(self._device)
        with torch.inference_mode():
            raw = model.infer(tensor, sr=self.sr, decoder_mode="local_argmax", threshold=0.006)
        frequencies = np.asarray((raw[0] if isinstance(raw, (tuple, list)) else raw).squeeze().cpu())
        step = len(signal) / self.sr / max(1, len(frequencies))
        return [PitchFrame(index * step, float(hz) if self.fmin <= hz <= self.fmax else 0, 1.0 if self.fmin <= hz <= self.fmax else 0, self.fmin <= hz <= self.fmax) for index, hz in enumerate(frequencies)]


class PyinFallbackPitchEstimator(FCPEPitchEstimator):
    name = "pyin"
