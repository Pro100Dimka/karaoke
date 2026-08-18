"""Backend-neutral deterministic shadow execution policy."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from .utils.env import env_flag


@dataclass(frozen=True, slots=True)
class ShadowPolicy:
    enabled: bool = False
    sample_rate: float = 0.0
    keep_session_resident: bool = False

    @classmethod
    def from_env(cls, prefix: str = "KARAOKE_AI_CTC_SHADOW") -> ShadowPolicy:
        enabled = env_flag(prefix)
        raw_rate = os.getenv(f"{prefix}_RATE", "1" if enabled else "0")
        try:
            rate = float(raw_rate)
        except ValueError:
            rate = 0.0
        resident = env_flag(f"{prefix}_RESIDENT")
        return cls(enabled, min(1.0, max(0.0, rate)), resident)

    def selects(self, identity: str) -> bool:
        if not self.enabled or self.sample_rate <= 0:
            return False
        if self.sample_rate >= 1:
            return True
        bucket = int.from_bytes(hashlib.sha256(identity.encode("utf-8")).digest()[:8], "big")
        return bucket / (2**64 - 1) < self.sample_rate
