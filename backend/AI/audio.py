from __future__ import annotations

import contextvars
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import soundfile as sf

from .errors import AICoreError


def resolve_ffmpeg() -> str:
    configured = os.getenv("FFMPEG_BINARY", "").strip()
    if configured:
        candidate = Path(configured)
        executable = str(candidate.resolve()) if candidate.is_file() else shutil.which(configured)
        if executable:
            return executable
        raise AICoreError("FFMPEG_BINARY points to an unavailable FFmpeg executable")
    if getattr(sys, "frozen", False):
        root = Path(sys.executable).resolve().parent
        for directory in (Path(getattr(sys, "_MEIPASS", root / "_internal")), root, root / "_internal"):
            candidate = directory / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
            if candidate.is_file():
                return str(candidate)
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    raise AICoreError("FFmpeg executable not found in the application or PATH; repair the installation")


def run_ffmpeg(arguments: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess:
    command = [resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *arguments]
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise AICoreError(result.stderr.strip() or f"ffmpeg exited with {result.returncode}")
    return result


_mono_cache: contextvars.ContextVar[dict[str, tuple[np.ndarray, int]] | None] = contextvars.ContextVar(
    "audio_mono_cache", default=None
)


@contextmanager
def audio_buffer_cache():
    """Share one decoded copy of each audio file across a pipeline run.

    vocals.flac is independently read from disk by pitch estimation, voice-
    activity detection and forced-alignment repair -- up to three full
    decodes of the same file per song. Anything read via read_mono() while
    this context is active is cached (keyed by resolved path) so the second
    and third readers get it for free; the cache is discarded when the
    context exits so it never leaks between pipeline runs or grows
    unbounded.
    """
    token = _mono_cache.set({})
    try:
        yield
    finally:
        _mono_cache.reset(token)


def read_mono(path: str | Path) -> tuple[np.ndarray, int]:
    """Decode a (guaranteed single-channel) audio file as float64 mono.

    vocals.flac is always produced single-channel (see
    prepare_vocal_reference's "-ac 1"), so averaging an always_2d read's one
    channel is equivalent to a plain mono read, just in the canonical shape
    every cached caller shares. Returns a fresh array each call so a caller
    that mutates its copy in place can never corrupt the shared cache entry.
    """
    key = str(Path(path).resolve())
    cache = _mono_cache.get()
    if cache is not None and key in cache:
        samples, rate = cache[key]
        return samples.copy(), rate
    samples, rate = sf.read(path, always_2d=True, dtype="float64")
    mono = samples.mean(axis=1)
    if cache is not None:
        cache[key] = (mono, rate)
        return mono.copy(), rate
    return mono, rate


def _render(source: str | Path, target: Path, sample_rate: int, channels: int) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix=target.suffix, dir=target.parent)
    os.close(handle)
    try:
        run_ffmpeg(
            ["-i", str(source), "-vn", "-ar", str(sample_rate), "-ac", str(channels), temporary],
            timeout=20 * 60,
        )
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return target


def decode_audio(source: str | Path, target: str | Path, sample_rate: int = 44100, channels: int = 2) -> Path:
    return _render(source, Path(target), sample_rate, channels)


def encode_flac(source: str | Path, target: str | Path, sample_rate: int = 44100, channels: int = 2) -> Path:
    return _render(source, Path(target), sample_rate, channels)


def load_mono(path: str | Path, sample_rate: int = 16000) -> tuple[np.ndarray, int]:
    import librosa

    audio, _ = librosa.load(path, sr=sample_rate, mono=True)
    return np.asarray(audio, dtype=np.float32), sample_rate


def duration(path: str | Path) -> float:
    return float(sf.info(path).duration)
