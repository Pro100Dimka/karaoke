"""Step 5. Analyse an isolated vocal and build a stable F0 frame track."""

from __future__ import annotations

import argparse
import os
from collections.abc import Iterable

import librosa
import numpy as np

from src.common.json_io import save_json

_TORCHCREPE_MODELS = {"tiny", "full"}


def freq_to_note(freq: float) -> str | None:
    if not np.isfinite(freq) or freq <= 0:
        return None
    midi = int(round(12 * np.log2(freq / 440.0) + 69))
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def _rms_track(y: np.ndarray, sr: int, hop_length: int) -> tuple[np.ndarray, np.ndarray]:
    frame_length = max(1024, hop_length * 4)
    rms = librosa.feature.rms(
        y=y,
        frame_length=frame_length,
        hop_length=hop_length,
        center=True,
    )[0]
    if not len(rms):
        return np.empty(0, dtype=float), np.empty(0, dtype=float)
    reference = max(float(np.max(rms)), 1e-10)
    rms_db = librosa.amplitude_to_db(rms, ref=reference)
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    return times, rms_db


def _analyze_pyin(
    y: np.ndarray,
    sr: int,
    frame_step_sec: float,
    fmin: str,
    fmax: str,
):
    hop_length = max(1, int(round(frame_step_sec * sr)))
    nyquist = max(1.0, sr / 2.0 - 1e-6)
    fmin_hz = min(float(librosa.note_to_hz(fmin)), nyquist * 0.8)
    fmax_hz = min(float(librosa.note_to_hz(fmax)), nyquist)
    if fmin_hz <= 0 or fmin_hz >= fmax_hz:
        return _analyze_energy(y, sr, frame_step_sec)
    frame_length = max(2048, int(np.ceil(sr / fmin_hz * 4)))
    frame_length += frame_length % 2

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y,
        sr=sr,
        fmin=fmin_hz,
        fmax=fmax_hz,
        frame_length=frame_length,
        hop_length=hop_length,
        center=True,
        fill_na=np.nan,
    )
    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)
    rms_times, rms_db = _rms_track(y, sr, hop_length)
    loudness = np.interp(times, rms_times, rms_db) if len(rms_times) else np.full(len(times), -80.0)
    return times, f0, voiced_flag, voiced_probs, loudness


def _analyze_crepe(
    y: np.ndarray,
    sr: int,
    frame_step_sec: float,
    fmin: str,
    fmax: str,
    model_capacity: str = "full",
    confidence_threshold: float = 0.5,
):
    import crepe

    times, frequency, confidence, _ = crepe.predict(
        y,
        sr,
        model_capacity=model_capacity,
        step_size=frame_step_sec * 1000.0,
        viterbi=True,
        verbose=0,
    )
    fmin_hz = float(librosa.note_to_hz(fmin))
    fmax_hz = float(librosa.note_to_hz(fmax))
    voiced = (
        (confidence >= confidence_threshold)
        & (frequency >= fmin_hz)
        & (frequency <= fmax_hz)
    )
    hop_length = max(1, int(round(frame_step_sec * sr)))
    rms_times, rms_db = _rms_track(y, sr, hop_length)
    loudness = np.interp(times, rms_times, rms_db) if len(rms_times) else np.full(len(times), -80.0)
    return times, frequency, voiced, confidence, loudness


def _analyze_energy(y: np.ndarray, sr: int, frame_step_sec: float):
    hop_length = max(1, int(round(frame_step_sec * sr)))
    times, rms_db = _rms_track(y, sr, hop_length)
    if not len(rms_db):
        return times, np.empty(0), np.empty(0, dtype=bool), np.empty(0), rms_db
    threshold = max(float(np.percentile(rms_db, 20)) + 7.0, -38.0)
    voiced = rms_db >= threshold
    return times, np.full(len(times), np.nan), voiced, voiced.astype(float), rms_db


def _rolling_median(values: np.ndarray, window: int = 5) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if len(values) < 3:
        return values.copy()
    window = max(3, int(window) | 1)
    radius = window // 2
    padded = np.pad(values, (radius, radius), mode="edge")
    return np.array([np.nanmedian(padded[i : i + window]) for i in range(len(values))])


def _stabilize_f0(f0: np.ndarray, periodicity: np.ndarray) -> np.ndarray:
    """Correct isolated octave/harmonic errors without flattening real jumps."""
    result = np.asarray(f0, dtype=float).copy()
    confidence = np.asarray(periodicity, dtype=float)
    valid = np.isfinite(result) & (result > 0)
    if valid.sum() < 5:
        return result

    midi = np.full(len(result), np.nan, dtype=float)
    midi[valid] = 69.0 + 12.0 * np.log2(result[valid] / 440.0)
    indices = np.arange(len(midi))
    filled = np.interp(indices, indices[valid], midi[valid])
    local = _rolling_median(filled, 5)
    delta = filled - local
    harmonic_distance = np.minimum.reduce(
        [np.abs(np.abs(delta) - interval) for interval in (12.0, 19.0, 24.0)]
    )
    isolated = np.ones(len(filled), dtype=bool)
    if len(filled) > 2:
        isolated[1:-1] = (
            np.abs(filled[1:-1] - filled[:-2]) > 5.0
        ) & (np.abs(filled[1:-1] - filled[2:]) > 5.0)
    suspicious = valid & isolated & (harmonic_distance < 1.25) & (confidence < 0.82)
    filled[suspicious] = local[suspicious]

    # Only smooth tiny quantisation jitter. Real semitone transitions remain intact.
    smooth = _rolling_median(filled, 3)
    gentle = valid & (np.abs(smooth - filled) <= 0.65)
    filled[gentle] = smooth[gentle]
    result[valid] = 440.0 * 2.0 ** ((filled[valid] - 69.0) / 12.0)
    return result


def _clean_voicing(mask: np.ndarray, *, min_run: int = 2, max_gap: int = 1) -> np.ndarray:
    """Remove one-frame spikes and bridge one-frame holes in voiced regions."""
    result = np.asarray(mask, dtype=bool).copy()
    if len(result) < 3:
        return result

    if max_gap >= 1:
        holes = np.flatnonzero((~result[1:-1]) & result[:-2] & result[2:]) + 1
        result[holes] = True

    start = 0
    while start < len(result):
        value = result[start]
        end = start + 1
        while end < len(result) and result[end] == value:
            end += 1
        if value and end - start < min_run:
            result[start:end] = False
        start = end
    return result


def _torchcrepe_device(torch_module) -> str:
    requested = os.getenv("SONGAPP_DEVICE", "auto").strip().lower()
    if requested == "cpu" or not torch_module.cuda.is_available():
        return "cpu"
    return "cuda"


def _predict_torchcrepe_chunk(
    chunk: np.ndarray,
    *,
    sr: int,
    hop_length: int,
    fmin_hz: float,
    fmax_hz: float,
    model_capacity: str,
    device: str,
):
    import torch
    import torchcrepe

    audio = torch.from_numpy(np.ascontiguousarray(chunk, dtype=np.float32)).unsqueeze(0)
    batch_sizes = (512, 256, 128, 64) if device == "cuda" else (128, 64)
    last_error: RuntimeError | None = None
    for batch_size in batch_sizes:
        try:
            with torch.inference_mode():
                return torchcrepe.predict(
                    audio,
                    sr,
                    hop_length=hop_length,
                    fmin=fmin_hz,
                    fmax=fmax_hz,
                    model=model_capacity,
                    decoder=torchcrepe.decode.viterbi,
                    return_periodicity=True,
                    batch_size=batch_size,
                    device=device,
                    pad=True,
                )
        except RuntimeError as exc:
            last_error = exc
            message = str(exc).lower()
            recoverable = "out of memory" in message or ("shape" in message and "invalid" in message)
            if not recoverable or batch_size == batch_sizes[-1]:
                raise
            if device == "cuda":
                torch.cuda.empty_cache()
            print(f"TorchCrepe retry with smaller batch after: {exc}")
    assert last_error is not None
    raise last_error



def _analyze_torchcrepe(
    y: np.ndarray,
    sr: int,
    frame_step_sec: float,
    fmin: str,
    fmax: str,
    model_capacity: str = "tiny",
):
    """Run TorchCrepe in bounded chunks with exact global frame timestamps."""
    import torch

    if model_capacity not in _TORCHCREPE_MODELS:
        raise ValueError("TorchCrepe model must be 'tiny' or 'full'")

    target_sr = 16_000
    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr, res_type="soxr_hq")
        sr = target_sr
    y = np.asarray(y, dtype=np.float32)
    hop_length = max(1, int(round(frame_step_sec * sr)))
    frame_step_sec = hop_length / sr
    device = _torchcrepe_device(torch)
    if device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True

    fmin_hz = float(librosa.note_to_hz(fmin))
    fmax_hz = float(librosa.note_to_hz(fmax))
    chunk_samples = sr * 20
    context_samples = sr
    total_samples = len(y)
    f0_parts: list[np.ndarray] = []
    periodicity_parts: list[np.ndarray] = []
    time_parts: list[np.ndarray] = []

    for core_start in range(0, total_samples, chunk_samples):
        core_end = min(total_samples, core_start + chunk_samples)
        read_start = max(0, core_start - context_samples)
        read_end = min(total_samples, core_end + context_samples)
        chunk = y[read_start:read_end]
        pitch_tensor, periodicity_tensor = _predict_torchcrepe_chunk(
            chunk,
            sr=sr,
            hop_length=hop_length,
            fmin_hz=fmin_hz,
            fmax_hz=fmax_hz,
            model_capacity=model_capacity,
            device=device,
        )
        chunk_f0 = pitch_tensor.squeeze(0).detach().float().cpu().numpy()
        chunk_periodicity = periodicity_tensor.squeeze(0).detach().float().cpu().numpy()
        global_times = read_start / sr + np.arange(len(chunk_f0)) * frame_step_sec
        # Half-open cores avoid duplicate frames. Keep the final endpoint once.
        if core_end == total_samples:
            keep = (global_times >= core_start / sr) & (global_times <= core_end / sr + 1e-9)
        else:
            keep = (global_times >= core_start / sr) & (global_times < core_end / sr)
        f0_parts.append(chunk_f0[keep])
        periodicity_parts.append(chunk_periodicity[keep])
        time_parts.append(global_times[keep])

    f0 = np.concatenate(f0_parts) if f0_parts else np.empty(0, dtype=float)
    periodicity = (
        np.concatenate(periodicity_parts) if periodicity_parts else np.empty(0, dtype=float)
    )
    times = np.concatenate(time_parts) if time_parts else np.empty(0, dtype=float)
    if not len(f0):
        return times, f0, np.empty(0, dtype=bool), periodicity, np.empty(0)

    periodicity = _rolling_median(periodicity, 3)
    f0 = _stabilize_f0(f0, periodicity)
    rms_times, rms_db = _rms_track(y, sr, hop_length)
    loudness = np.interp(times, rms_times, rms_db) if len(rms_times) else np.full(len(times), -80.0)

    finite_conf = periodicity[np.isfinite(periodicity)]
    adaptive = float(np.percentile(finite_conf, 30)) if finite_conf.size else 0.38
    confidence_threshold = float(np.clip(adaptive, 0.28, 0.48))
    noise_floor = max(float(np.percentile(loudness, 15)) + 5.0, -48.0)
    voiced = (
        np.isfinite(f0)
        & (f0 >= fmin_hz)
        & (f0 <= fmax_hz)
        & (periodicity >= confidence_threshold)
        & (loudness >= noise_floor)
    )
    voiced = _clean_voicing(voiced)
    return times, f0, voiced, periodicity, loudness


def _run_engine(
    engine: str,
    y: np.ndarray,
    sr: int,
    frame_step_sec: float,
    fmin: str,
    fmax: str,
    crepe_model: str,
):
    if engine == "energy":
        return _analyze_energy(y, sr, frame_step_sec)
    if engine == "torchcrepe":
        try:
            return _analyze_torchcrepe(
                y,
                sr,
                frame_step_sec,
                fmin,
                fmax,
                model_capacity=crepe_model,
            )
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            # A pitch-less energy map silently destroys the melody. pYIN is
            # slower but remains a real F0 estimator and is therefore the safe
            # production fallback.
            print(f"TorchCrepe failed ({exc}); falling back to pYIN.")
            try:
                return _analyze_pyin(y, sr, frame_step_sec, fmin, fmax)
            except Exception as pyin_exc:
                print(f"pYIN fallback failed ({pyin_exc}); using vocal activity only.")
                return _analyze_energy(y, sr, frame_step_sec)
    if engine == "crepe":
        try:
            return _analyze_crepe(
                y,
                sr,
                frame_step_sec,
                fmin,
                fmax,
                model_capacity=crepe_model,
            )
        except ImportError:
            print("CREPE/TensorFlow is unavailable; falling back to pYIN.")
    return _analyze_pyin(y, sr, frame_step_sec, fmin, fmax)


def _build_frames(
    times: Iterable[float],
    frequencies: Iterable[float],
    voiced_flags: Iterable[bool],
    probabilities: Iterable[float],
    loudness: Iterable[float],
) -> list[dict]:
    frames = []
    for time, frequency, voiced, probability, loud in zip(
        times,
        frequencies,
        voiced_flags,
        probabilities,
        loudness,
        strict=False,
    ):
        frequency_value = float(frequency) if frequency is not None else np.nan
        is_voiced = bool(voiced) and np.isfinite(frequency_value) and frequency_value > 0
        confidence = float(probability) if np.isfinite(probability) else 0.0
        loudness_db = float(loud) if np.isfinite(loud) else -80.0
        frames.append(
            {
                "time": round(float(time), 3),
                "note": freq_to_note(frequency_value) if is_voiced else None,
                "f0_hz": round(frequency_value, 2) if is_voiced else None,
                "voiced": is_voiced,
                "confidence": round(float(np.clip(confidence, 0.0, 1.0)), 3),
                "loudness_db": round(loudness_db, 1),
            }
        )
    return frames


def analyze_vocal(
    input_path: str,
    frame_step_sec: float = 0.01,
    fmin: str = "C2",
    fmax: str = "C6",
    engine: str = "pyin",
    crepe_model: str = "full",
):
    if frame_step_sec <= 0:
        raise ValueError("frame_step_sec must be positive")
    if float(librosa.note_to_hz(fmin)) >= float(librosa.note_to_hz(fmax)):
        raise ValueError("fmin must be below fmax")
    target_sr = 16_000 if engine == "torchcrepe" else None
    y, sr = librosa.load(input_path, sr=target_sr, mono=True, res_type="soxr_hq")
    if not len(y):
        return []
    analysis = _run_engine(engine, y, sr, frame_step_sec, fmin, fmax, crepe_model)
    return _build_frames(*analysis)


def main() -> None:
    parser = argparse.ArgumentParser(description="Анализ вокала: pitch (F0) по кадрам")
    parser.add_argument("input", help="vocals.wav")
    parser.add_argument("output", nargs="?", default="pitch.json")
    parser.add_argument("--step", type=float, default=0.01, help="шаг анализа в секундах")
    parser.add_argument(
        "--engine",
        default="pyin",
        choices=["pyin", "crepe", "torchcrepe", "energy"],
    )
    parser.add_argument(
        "--crepe-model",
        default="full",
        choices=["tiny", "small", "medium", "large", "full"],
    )
    args = parser.parse_args()
    frames = analyze_vocal(
        args.input,
        frame_step_sec=args.step,
        engine=args.engine,
        crepe_model=args.crepe_model,
    )
    save_json(frames, args.output)
    print(f"Сохранено {len(frames)} кадров в {args.output} (движок: {args.engine})")


if __name__ == "__main__":
    main()
