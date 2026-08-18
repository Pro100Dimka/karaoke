from __future__ import annotations

import math
import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

import config

from .errors import AICoreError
from .profiler import profile_operation, record_operation

DEFAULT_FFMPEG_TIMEOUT_SEC = 30 * 60


def run_ffmpeg(
    command: list[str],
    *,
    timeout_sec: float,
    not_found_message: str,
    timeout_message: str,
    failed_message: str,
) -> None:
    """Run an ffmpeg subprocess, mapping every failure mode to AICoreError.

    Every ffmpeg call site in the AI core built its own command and then
    independently repeated the same FileNotFoundError/TimeoutExpired/
    CalledProcessError -> AICoreError translation (including stderr
    decoding). This centralizes exactly that translation; command
    construction and any post-run artifact validation stay at each call
    site since those genuinely differ per caller.
    """
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=timeout_sec)
    except FileNotFoundError as exc:
        raise AICoreError(not_found_message) from exc
    except subprocess.TimeoutExpired as exc:
        raise AICoreError(timeout_message) from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace").strip()
        raise AICoreError(detail or failed_message) from exc
_AUDIO_CACHE: ContextVar[dict[tuple[str, int, int, int | None], tuple[np.ndarray, int]] | None] = (
    ContextVar("ai_audio_cache", default=None)
)


@contextmanager
def audio_buffer_cache():
    """Reuse decoded/resampled PCM inside one pipeline run without sharing mutable arrays."""
    token = _AUDIO_CACHE.set({})
    try:
        yield
    finally:
        _AUDIO_CACHE.reset(token)


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
    started = time.perf_counter()
    try:
        with profile_operation("decode.ffmpeg", byte_count=source_path.stat().st_size):
            run_ffmpeg(
                command,
                timeout_sec=timeout_sec,
                not_found_message="FFmpeg is required but was not found in PATH",
                timeout_message=f"FFmpeg exceeded the {timeout_sec}-second safety timeout",
                failed_message="FFmpeg failed without an error message",
            )
        if not temporary.is_file() or temporary.stat().st_size < 44:
            raise AICoreError("FFmpeg finished but did not create a valid WAV file")
        # Verify readability before publishing the artifact.
        info = sf.info(temporary)
        if info.frames <= 0 or info.samplerate != sample_rate:
            raise AICoreError("FFmpeg created an empty WAV or unexpected sample rate")
        os.replace(temporary, target_path)
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, AICoreError):
            raise
        raise AICoreError(f"Could not validate decoded WAV: {exc}") from exc
    finally:
        temporary.unlink(missing_ok=True)
    record_operation(
        "decode.output",
        elapsed_sec=time.perf_counter() - started,
        byte_count=target_path.stat().st_size,
    )
    return target_path


def load_mono(
    path: str | Path,
    target_sample_rate: int | None = None,
) -> tuple[np.ndarray, int]:
    source = Path(path).resolve()
    stat = source.stat()
    key = (str(source), stat.st_size, stat.st_mtime_ns, target_sample_rate)
    cache = _AUDIO_CACHE.get()
    if cache is not None and key in cache:
        audio, sample_rate = cache[key]
        record_operation("audio.cache_hit", byte_count=audio.nbytes)
        return audio.copy(), sample_rate

    with profile_operation("audio.read", byte_count=stat.st_size):
        audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
    mono = np.mean(audio, axis=1, dtype=np.float32)

    if target_sample_rate is not None:
        if target_sample_rate <= 0:
            raise ValueError("target_sample_rate must be positive")
        if sample_rate != target_sample_rate:
            divisor = math.gcd(sample_rate, target_sample_rate)
            with profile_operation("audio.resample", byte_count=mono.nbytes):
                mono = resample_poly(
                    mono,
                    target_sample_rate // divisor,
                    sample_rate // divisor,
                ).astype(np.float32, copy=False)
            sample_rate = target_sample_rate

    result = np.ascontiguousarray(mono, dtype=np.float32)
    rate = int(sample_rate)
    if cache is not None:
        cache[key] = (result, rate)
    record_operation("audio.load_mono", byte_count=stat.st_size)
    return result.copy() if cache is not None else result, rate


def duration(path: str | Path) -> float:
    return float(sf.info(path).duration)
