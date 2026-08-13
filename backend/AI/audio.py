from __future__ import annotations

import math
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

import config

from .errors import AICoreError

DEFAULT_FFMPEG_TIMEOUT_SEC = 30 * 60


def decode_audio(
    source: str | Path,
    target: str | Path,
    sample_rate: int = 44_100,
    *,
    timeout_sec: int = DEFAULT_FFMPEG_TIMEOUT_SEC,
) -> Path:
    source_path = Path(source)
    target_path = Path(target)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f"{target_path.name}.", suffix=".wav.tmp", dir=target_path.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    command = [
        config.FFMPEG_EXE,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "2",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s24le",
        "-f",
        "wav",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=timeout_sec)
        if not temporary.is_file() or temporary.stat().st_size < 44:
            raise AICoreError("FFmpeg finished but did not create a valid WAV file")
        # Verify readability before publishing the artifact.
        info = sf.info(temporary)
        if info.frames <= 0 or info.samplerate != sample_rate:
            raise AICoreError("FFmpeg created an empty WAV or unexpected sample rate")
        os.replace(temporary, target_path)
    except FileNotFoundError as exc:
        raise AICoreError("FFmpeg is required but was not found in PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise AICoreError(f"FFmpeg exceeded the {timeout_sec}-second safety timeout") from exc
    except subprocess.CalledProcessError as exc:
        details = exc.stderr.decode("utf-8", "replace").strip()
        raise AICoreError(details or "FFmpeg failed without an error message") from exc
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, AICoreError):
            raise
        raise AICoreError(f"Could not validate decoded WAV: {exc}") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return target_path


def load_mono(
    path: str | Path,
    target_sample_rate: int | None = None,
) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    mono = np.mean(audio, axis=1, dtype=np.float32)

    if target_sample_rate is not None:
        if target_sample_rate <= 0:
            raise ValueError("target_sample_rate must be positive")
        if sample_rate != target_sample_rate:
            divisor = math.gcd(sample_rate, target_sample_rate)
            mono = resample_poly(
                mono,
                target_sample_rate // divisor,
                sample_rate // divisor,
            ).astype(np.float32, copy=False)
            sample_rate = target_sample_rate

    return np.ascontiguousarray(mono, dtype=np.float32), int(sample_rate)


def duration(path: str | Path) -> float:
    return float(sf.info(path).duration)
