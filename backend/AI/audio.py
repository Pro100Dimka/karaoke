from __future__ import annotations

import os
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import soundfile as sf

from .errors import AICoreError


def run_ffmpeg(arguments: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess:
    command = [os.getenv("FFMPEG_BINARY", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *arguments]
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise AICoreError(result.stderr.strip() or f"ffmpeg exited with {result.returncode}")
    return result


@contextmanager
def audio_buffer_cache():
    yield


def _render(source: str | Path, target: Path, sample_rate: int, channels: int) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix=target.suffix, dir=target.parent)
    os.close(handle)
    try:
        run_ffmpeg(["-i", str(source), "-vn", "-ar", str(sample_rate), "-ac", str(channels), temporary])
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
