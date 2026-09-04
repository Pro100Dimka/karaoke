from __future__ import annotations

import os
import tempfile
from pathlib import Path

import soundfile as sf

from .audio import run_ffmpeg
from .errors import AICoreError

VOCAL_REFERENCE_PREPROCESS_VERSION = "mono-clean-gate-v1"

# Delay/echo gate: a produced vocal's delay/echo repeat is an attenuated copy
# of the same signal, so gating out anything quieter than the vocal's own
# typical loudness suppresses it without needing to detect its exact timing
# or delay length. Confirmed by ear against a real recording with an audible
# delay effect. Tune these if a song still has an audible delay (raise
# GATE_THRESHOLD_PERCENTILE) or if quiet real vocal parts get chopped
# (lower it, or loosen GATE_RANGE/GATE_RATIO).
GATE_THRESHOLD_PERCENTILE = 75  # of the vocal's own per-frame RMS loudness
GATE_RANGE = 0.0015  # residual amplitude left below the threshold (~-56dB)
GATE_RATIO = 25
GATE_ATTACK_MS = 1
GATE_RELEASE_MS = 50
GATE_FRAME_SECONDS = 0.02


def validate_vocal_reference(path: str | Path):
    info = sf.info(path)
    if info.channels != 1 or info.frames <= 0:
        raise AICoreError("Vocal reference must be non-empty mono audio")
    return info


def _gate_threshold(source: Path, percentile: float) -> float:
    import numpy as np

    audio, rate = sf.read(source, always_2d=True, dtype="float64")
    mono = audio.mean(axis=1)
    frame = max(1, round(rate * GATE_FRAME_SECONDS))
    usable = len(mono) // frame * frame
    if usable < frame:
        return 0.0
    rms = np.sqrt(np.mean(mono[:usable].reshape(-1, frame) ** 2, axis=1))
    audible = rms[rms > 1e-9]
    return float(np.percentile(audible, percentile)) if len(audible) else 0.0


def prepare_vocal_reference(source: str | Path, target: str | Path, sample_rate=44100, **_options):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    threshold = _gate_threshold(Path(source), GATE_THRESHOLD_PERCENTILE)
    gate = f"agate=threshold={threshold:.6f}:range={GATE_RANGE}:ratio={GATE_RATIO}:attack={GATE_ATTACK_MS}:release={GATE_RELEASE_MS}:makeup=1," if threshold > 0 else ""
    handle, temporary = tempfile.mkstemp(suffix=".flac", dir=target.parent)
    os.close(handle)
    try:
        run_ffmpeg([
            "-i", str(source), "-vn", "-ac", "1", "-ar", str(sample_rate),
            "-af", f"{gate}highpass=f=70,lowpass=f=14000,afftdn=nr=12:nf=-45:tn=1,anlmdn=s=0.002:p=0.002:r=0.006",
            temporary,
        ], timeout=20 * 60)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return validate_vocal_reference(target)
