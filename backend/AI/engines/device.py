"""Shared compute-device selection for lazily loaded AI engines."""

from __future__ import annotations

import os

from ..errors import EngineUnavailableError


def select_torch_device(torch) -> str:
    preference = os.getenv("SONGAPP_DEVICE", "auto").strip().lower()
    if preference == "cpu":
        return "cpu"
    if preference == "cuda":
        if not torch.cuda.is_available():
            raise EngineUnavailableError("CUDA was requested, but PyTorch cannot access a CUDA GPU")
        return "cuda:0"
    if preference not in {"", "auto"}:
        raise EngineUnavailableError(f"Unsupported SONGAPP_DEVICE={preference!r}")
    return "cuda:0" if torch.cuda.is_available() else "cpu"
