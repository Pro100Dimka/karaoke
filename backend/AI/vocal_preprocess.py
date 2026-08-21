from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .audio import DEFAULT_FFMPEG_TIMEOUT_SEC, render_wav_atomic
from .errors import AICoreError
from .profiler import profile_operation

VOCAL_REFERENCE_PREPROCESS_VERSION = "v3-mono-wpe5-dereverb-denoise-20260821"

_WPE_CHUNK_SECONDS = 30
_WPE_OVERLAP_SECONDS = 2
_WPE_TAPS = 24
_WPE_DELAY = 3
_WPE_ITERATIONS = 5


def validate_vocal_reference(path: str | Path):
    info = sf.info(path)
    if info.frames <= 0 or info.samplerate <= 0 or info.channels != 1:
        raise AICoreError("Vocal reference must be non-empty mono audio")
    return info


def _dereverberate_chunk(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    if audio.size < max(512, sample_rate // 4) or float(np.max(np.abs(audio))) < 1e-7:
        return audio.astype(np.float32, copy=True)
    try:
        from nara_wpe.utils import istft, stft
        from nara_wpe.wpe import wpe
    except ImportError as exc:
        raise AICoreError("NARA-WPE is required for vocal dereverberation") from exc

    size = 1024 if sample_rate >= 32_000 else 512
    shift = size // 4
    spectrum = stft(audio.astype(np.float64, copy=False), size, shift)
    observation = spectrum.T[:, np.newaxis, :]
    cleaned = wpe(
        observation,
        taps=_WPE_TAPS,
        delay=_WPE_DELAY,
        iterations=_WPE_ITERATIONS,
        psd_context=1,
    )
    result = istft(cleaned[:, 0, :].T, size=size, shift=shift)[: audio.size]
    if result.size != audio.size or not np.all(np.isfinite(result)):
        raise AICoreError("Vocal dereverberation produced invalid audio")
    peak = float(np.max(np.abs(result)))
    if peak > 0.999: result *= 0.999 / peak
    return result.astype(np.float32, copy=False)


def _dereverberate_mono(source: Path, target: Path) -> Path:
    audio, sample_rate = sf.read(source, dtype="float32", always_2d=False)
    if audio.ndim != 1 or audio.size == 0:
        raise AICoreError("Dereverberation input must be non-empty mono audio")

    chunk_size = max(1, _WPE_CHUNK_SECONDS * sample_rate)
    overlap = min(_WPE_OVERLAP_SECONDS * sample_rate, chunk_size // 4)
    step = max(1, chunk_size - overlap)
    output = np.zeros(audio.size, dtype=np.float32)
    weights = np.zeros(audio.size, dtype=np.float32)
    with profile_operation("vocal_reference.wpe", byte_count=audio.nbytes):
        for start in range(0, audio.size, step):
            end = min(audio.size, start + chunk_size)
            cleaned = _dereverberate_chunk(audio[start:end], sample_rate)
            blend = np.ones(cleaned.size, dtype=np.float32)
            fade = min(overlap, cleaned.size)
            if start > 0 and fade: blend[:fade] = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            if end < audio.size and fade: blend[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
            output[start:end] += cleaned * blend
            weights[start:end] += blend
            if end == audio.size: break
    output /= np.maximum(weights, 1e-6)
    sf.write(target, output, sample_rate, subtype="PCM_24", format="WAV")
    validate_vocal_reference(target)
    return target


def prepare_vocal_reference(source: str | Path, target: str | Path) -> Path:
    """Create the mono, time-preserving vocal used by every downstream stage.

    Downmix is deliberately completed before WPE removes predictable late
    reflections (reverb and delay). Conservative stationary-noise removal is
    applied last. No stage changes pitch, sample rate, duration, or timing.
    """
    source_path, target_path = Path(source), Path(target)
    source_info = sf.info(source_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    def validate(path: Path) -> None:
        info = validate_vocal_reference(path)
        if info.samplerate != source_info.samplerate:
            raise AICoreError("Vocal preprocessing changed the sample rate")
        delta = abs(float(info.duration) - float(source_info.duration))
        if delta > max(0.002, 1.5 / max(1, source_info.samplerate)):
            raise AICoreError(f"Vocal preprocessing changed duration by {delta:.6f}s")

    with tempfile.TemporaryDirectory(prefix="karaoke-vocal-clean-", dir=target_path.parent) as raw:
        temporary = Path(raw)
        mono = temporary / "mono.wav"
        dereverberated = temporary / "dereverberated.wav"
        render_wav_atomic(
            source_path,
            mono,
            [
                "-vn", "-af", "aformat=channel_layouts=mono", "-ac", "1",
                "-ar", str(source_info.samplerate), "-c:a", "pcm_s24le", "-f", "wav",
            ],
            timeout_sec=DEFAULT_FFMPEG_TIMEOUT_SEC,
            not_found_message="FFmpeg is required for vocal preprocessing",
            timeout_message="Vocal mono conversion exceeded the safety timeout",
            failed_message="FFmpeg vocal mono conversion failed",
            validate=validate_vocal_reference,
            profile_name="vocal_reference.mono",
        )
        _dereverberate_mono(mono, dereverberated)
        return render_wav_atomic(
            dereverberated,
            target_path,
            [
                "-vn", "-af", "highpass=f=65:p=2,lowpass=f=6500:p=2,afftdn=nr=6:nf=-50:tn=1:gs=3,volume=0.90",
                "-ac", "1", "-ar", str(source_info.samplerate), "-c:a", "pcm_s24le", "-f", "wav",
            ],
            timeout_sec=DEFAULT_FFMPEG_TIMEOUT_SEC,
            not_found_message="FFmpeg is required for vocal preprocessing",
            timeout_message="Vocal cleanup exceeded the safety timeout",
            failed_message="FFmpeg vocal cleanup failed",
            validate=validate,
            profile_name="vocal_reference.cleanup",
        )
