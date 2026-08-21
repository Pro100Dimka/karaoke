from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .audio import DEFAULT_FFMPEG_TIMEOUT_SEC, render_wav_atomic
from .errors import AICoreError
from .pitch_quantization import quantize_voiced_points
from .profiler import profile_operation

VOCAL_REFERENCE_PREPROCESS_VERSION = "v4-mono-wpe5-psola-note-lock-20260821"

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


def _dereverberate_chunk(
    audio: np.ndarray,
    sample_rate: int,
    iterations: int = _WPE_ITERATIONS,
) -> np.ndarray:
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
        iterations=max(1, int(iterations)),
        psd_context=1,
    )
    result = istft(cleaned[:, 0, :].T, size=size, shift=shift)[: audio.size]
    if result.size != audio.size or not np.all(np.isfinite(result)):
        raise AICoreError("Vocal dereverberation produced invalid audio")
    peak = float(np.max(np.abs(result)))
    if peak > 0.999: result *= 0.999 / peak
    return result.astype(np.float32, copy=False)


def _dereverberate_mono(
    source: Path,
    target: Path,
    *,
    iterations: int = _WPE_ITERATIONS,
) -> Path:
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
            cleaned = _dereverberate_chunk(
                audio[start:end], sample_rate, iterations=iterations
            )
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


def _autotune_mono(source: Path, target: Path) -> Path:
    """Remove vibrato by replacing Praat's voiced pitch tier with stable notes."""
    try:
        import parselmouth
        from parselmouth.praat import call
    except ImportError as exc:
        raise AICoreError("Praat-Parselmouth is required for vocal pitch locking") from exc

    try:
        sound = parselmouth.Sound(str(source))
        manipulation = call(sound, "To Manipulation", 0.01, 55.0, 1400.0)
        pitch_tier = call(manipulation, "Extract pitch tier")
        count = int(call(pitch_tier, "Get number of points"))
        if count:
            times = [float(call(pitch_tier, "Get time from index", index)) for index in range(1, count + 1)]
            frequencies = [float(call(pitch_tier, "Get value at index", index)) for index in range(1, count + 1)]
            locked = quantize_voiced_points(times, frequencies)
            call(pitch_tier, "Remove points between", float(sound.xmin), float(sound.xmax))
            for timestamp, frequency in zip(times, locked, strict=True):
                call(pitch_tier, "Add point", timestamp, frequency)
            call([pitch_tier, manipulation], "Replace pitch tier")
        tuned = call(manipulation, "Get resynthesis (overlap-add)")
        audio = np.asarray(tuned.values, dtype=np.float32).reshape(-1)
    except Exception as exc:
        raise AICoreError(f"Praat vocal pitch locking failed: {exc}") from exc

    source_info = validate_vocal_reference(source)
    if audio.size != source_info.frames or not np.all(np.isfinite(audio)):
        raise AICoreError("Vocal pitch locking changed duration or produced invalid audio")
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.999: audio *= 0.999 / peak
    sf.write(target, audio, source_info.samplerate, subtype="PCM_24", format="WAV")
    validate_vocal_reference(target)
    return target


def prepare_vocal_reference(
    source: str | Path,
    target: str | Path,
    *,
    wpe_iterations: int = _WPE_ITERATIONS,
) -> Path:
    """Create the mono, time-preserving vocal used by every downstream stage.

    Downmix is completed before WPE removes predictable late reflections.
    Praat PSOLA then locks the voiced contour to stable semitones and removes
    vibrato without changing timing. Stationary-noise removal is applied last;
    sample rate and duration remain unchanged.
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
        tuned = temporary / "tuned.wav"
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
        _dereverberate_mono(
            mono, dereverberated, iterations=max(1, int(wpe_iterations))
        )
        _autotune_mono(dereverberated, tuned)
        return render_wav_atomic(
            tuned,
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
