from __future__ import annotations

import os
import tempfile
from pathlib import Path

import soundfile as sf

from .audio import run_ffmpeg
from .errors import AICoreError

VOCAL_REFERENCE_PREPROCESS_VERSION = "mono-clean-v1"


def validate_vocal_reference(path: str | Path):
    info = sf.info(path)
    if info.channels != 1 or info.frames <= 0:
        raise AICoreError("Vocal reference must be non-empty mono audio")
    return info


def prepare_vocal_reference(source: str | Path, target: str | Path, sample_rate=44100, **_options):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(suffix=".flac", dir=target.parent)
    os.close(handle)
    try:
        run_ffmpeg([
            "-i", str(source), "-vn", "-ac", "1", "-ar", str(sample_rate),
            "-af", "highpass=f=70,lowpass=f=14000,afftdn=nr=12:nf=-45:tn=1,anlmdn=s=0.002:p=0.002:r=0.006",
            temporary,
        ])
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return validate_vocal_reference(target)
