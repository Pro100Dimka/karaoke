from __future__ import annotations

import os
import tempfile
from pathlib import Path

import soundfile as sf

from .audio import run_ffmpeg
from .errors import AICoreError

VOCAL_REFERENCE_PREPROCESS_VERSION = "mono-clean-wpe-v1"

_STFT_SIZE = 1024
_STFT_SHIFT = 256


def validate_vocal_reference(path: str | Path):
    info = sf.info(path)
    if info.channels != 1 or info.frames <= 0:
        raise AICoreError("Vocal reference must be non-empty mono audio")
    return info


def _dereverberate(source: Path, work_dir: Path, iterations: int) -> Path:
    """Remove delay/echo/reverb smeared into the separated vocal stem via WPE.

    A produced vocal often carries a mix delay/echo/reverb effect that survives
    source separation untouched (MSST isolates the vocal *source*, not effects
    baked into it). That smearing directly corrupts everything downstream that
    reads vocals.flac: pitch tracking picks up echo tails as extra voiced
    frames, and the forced aligner sees blurred, doubled phonemes. WPE uses the
    stereo pair from separation as a 2-channel array to estimate and cancel the
    late reflections before anything else touches the audio.
    """
    import numpy as np
    from nara_wpe.utils import istft, stft
    from nara_wpe.wpe import wpe

    audio, rate = sf.read(source, always_2d=True, dtype="float64")
    if audio.shape[1] < 2:
        return source
    y = audio.T
    stft_options = {"size": _STFT_SIZE, "shift": _STFT_SHIFT}
    spectrum = stft(y, **stft_options).transpose(2, 0, 1)
    dereverbed = wpe(spectrum, taps=10, delay=3, iterations=iterations, statistics_mode="full")
    z = istft(dereverbed.transpose(1, 2, 0), size=stft_options["size"], shift=stft_options["shift"])
    target = work_dir / f".dereverb-{os.urandom(4).hex()}.wav"
    sf.write(target, np.clip(z.T, -1.0, 1.0).astype(np.float32), rate)
    return target


def prepare_vocal_reference(
    source: str | Path, target: str | Path, sample_rate=44100, *, wpe_iterations: int = 0, **_options
):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    dereverbed = Path(source)
    try:
        if wpe_iterations > 0:
            try:
                dereverbed = _dereverberate(Path(source), target.parent, wpe_iterations)
            except ImportError:
                dereverbed = Path(source)
        handle, temporary = tempfile.mkstemp(suffix=".flac", dir=target.parent)
        os.close(handle)
        try:
            run_ffmpeg([
                "-i", str(dereverbed), "-vn", "-ac", "1", "-ar", str(sample_rate),
                "-af", "highpass=f=70,lowpass=f=14000,afftdn=nr=12:nf=-45:tn=1,anlmdn=s=0.002:p=0.002:r=0.006",
                temporary,
            ])
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    finally:
        if dereverbed != Path(source):
            dereverbed.unlink(missing_ok=True)
    return validate_vocal_reference(target)
