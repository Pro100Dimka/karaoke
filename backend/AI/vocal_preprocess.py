from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from .audio import DEFAULT_FFMPEG_TIMEOUT_SEC, render_wav_atomic
from .errors import AICoreError

VOCAL_REFERENCE_PREPROCESS_VERSION = "v1-mono-denoise-tail-gate-20260821"


def validate_vocal_reference(path: str | Path):
    info = sf.info(path)
    if info.frames <= 0 or info.samplerate <= 0 or info.channels != 1:
        raise AICoreError("Vocal reference must be non-empty mono audio")
    return info


def _adaptive_gate_threshold(source: Path) -> float:
    """Keep sung attacks while suppressing low-level delay/reverb tails."""
    try:
        audio, _sample_rate = sf.read(source, dtype="float32", always_2d=True)
        mono = np.mean(audio, axis=1, dtype=np.float32)
        values = np.abs(mono[np.isfinite(mono)])
        if values.size < 256: raise ValueError
        quiet = float(np.percentile(values, 35))
        body = float(np.percentile(values, 75))
        return max(0.001, min(0.03, quiet + max(0.0, body - quiet) * 0.08))
    except (OSError, RuntimeError, ValueError):
        return 0.008


def prepare_vocal_reference(source: str | Path, target: str | Path) -> Path:
    """Create the mono, time-preserving vocal used by every downstream stage.

    The filter chain is the project's former vocal-analysis cleanup: mono
    downmix first, then conservative band limiting, stationary-noise removal,
    and a gentle gate for reverb/delay tails. It deliberately performs no
    pitch correction, time stretching, or phase-vocoder resynthesis.
    """
    source_path, target_path = Path(source), Path(target)
    source_info = sf.info(source_path)
    threshold = _adaptive_gate_threshold(source_path)

    def validate(path: Path) -> None:
        info = validate_vocal_reference(path)
        if info.samplerate != source_info.samplerate:
            raise AICoreError("Vocal preprocessing changed the sample rate")
        delta = abs(float(info.duration) - float(source_info.duration))
        if delta > max(0.002, 1.5 / max(1, source_info.samplerate)):
            raise AICoreError(f"Vocal preprocessing changed duration by {delta:.6f}s")

    graph = (
        "aformat=channel_layouts=mono,"
        "highpass=f=65:p=2,lowpass=f=6500:p=2,"
        "afftdn=nr=6:nf=-50:tn=1:gs=3,"
        f"agate=threshold={threshold:.6f}:ratio=2.0:attack=8:release=85:knee=2"
    )
    return render_wav_atomic(
        source_path,
        target_path,
        [
            "-vn",
            "-af",
            graph,
            "-ac",
            "1",
            "-ar",
            str(source_info.samplerate),
            "-c:a",
            "pcm_s24le",
            "-f",
            "wav",
        ],
        timeout_sec=DEFAULT_FFMPEG_TIMEOUT_SEC,
        not_found_message="FFmpeg is required for vocal preprocessing",
        timeout_message="Vocal preprocessing exceeded the safety timeout",
        failed_message="FFmpeg vocal preprocessing failed",
        validate=validate,
        profile_name="vocal_reference.ffmpeg",
    )
