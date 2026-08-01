"""
Шаг 5. Анализ вокала.
vocals.wav -> pitch.json

Для каждого интервала времени (по умолчанию 10 мс) считает:
высоту голоса (F0 -> нота), громкость, наличие вокала/паузы, уверенность.

Поддерживает два движка:
- pyin (по умолчанию)  — встроен в librosa, без доп. установки, быстрый
- crepe (--engine crepe) — нейросетевой pitch tracker, точнее на тихих/
  приглушённых участках после сепарации, но медленнее и требует
  `pip install crepe tensorflow` (обе библиотеки бесплатные, open-source)
"""

import argparse
import json
import os

import librosa
import numpy as np


def freq_to_note(freq: float) -> str:
    if freq <= 0 or np.isnan(freq):
        return None
    note_number = 12 * np.log2(freq / 440.0) + 69  # MIDI number, A4=69
    note_number = int(round(note_number))
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    octave = note_number // 12 - 1
    name = names[note_number % 12]
    return f"{name}{octave}"


def _analyze_pyin(y: np.ndarray, sr: int, frame_step_sec: float, fmin: str, fmax: str):
    hop_length = max(1, int(round(frame_step_sec * sr)))

    # ВАЖНО: frame_length должен обеспечивать достаточно периодов волны
    # для САМОЙ НИЗКОЙ ноты диапазона (fmin), иначе pYIN даёт шумную,
    # прыгающую оценку F0. Считаем окно от fmin явно (минимум 4 периода,
    # не меньше 2048 сэмплов).
    fmin_hz = librosa.note_to_hz(fmin)
    frame_length = max(2048, int(sr / fmin_hz * 4))
    if frame_length % 2 != 0:
        frame_length += 1

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y,
        sr=sr,
        fmin=fmin_hz,
        fmax=librosa.note_to_hz(fmax),
        frame_length=frame_length,
        hop_length=hop_length,
    )

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)

    return times, f0, voiced_flag, voiced_probs, rms_db


def _analyze_crepe(
    y: np.ndarray,
    sr: int,
    frame_step_sec: float,
    fmin: str,
    fmax: str,
    model_capacity: str = "full",
    confidence_threshold: float = 0.5,
):
    """
    CREPE — нейросетевой pitch tracker (Kim et al., 2018). Обычно точнее
    pYIN на слабом/приглушённом сигнале, но требует TensorFlow.
    Официальный пакет: `pip install crepe` (Apache-2.0, бесплатно).
    """
    import crepe  # локальный импорт, чтобы не требовать TF, если движок не используется

    step_size_ms = frame_step_sec * 1000.0
    times, frequency, confidence, _ = crepe.predict(
        y,
        sr,
        model_capacity=model_capacity,
        step_size=step_size_ms,
        viterbi=True,
        verbose=0,
    )

    fmin_hz = librosa.note_to_hz(fmin)
    fmax_hz = librosa.note_to_hz(fmax)

    voiced_flag = (
        (confidence >= confidence_threshold) & (frequency >= fmin_hz) & (frequency <= fmax_hz)
    )

    # громкость отдельно через librosa RMS на той же временной сетке
    hop_length = max(1, int(round(frame_step_sec * sr)))
    rms = librosa.feature.rms(y=y, frame_length=hop_length * 4, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    rms_db_aligned = np.interp(times, rms_times, rms_db)

    return times, frequency, voiced_flag, confidence, rms_db_aligned


def _analyze_energy(y: np.ndarray, sr: int, frame_step_sec: float):
    """Fast vocal-activity envelope used when GAME already supplies pitch."""
    hop_length = max(1, int(round(frame_step_sec * sr)))
    rms = librosa.feature.rms(y=y, frame_length=hop_length * 4, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    threshold = max(float(np.percentile(rms_db, 20)) + 7.0, -38.0)
    voiced_flag = rms_db >= threshold
    times = librosa.frames_to_time(np.arange(len(rms_db)), sr=sr, hop_length=hop_length)
    f0 = np.full(len(rms_db), np.nan)
    confidence = voiced_flag.astype(float)
    return times, f0, voiced_flag, confidence, rms_db


def _analyze_torchcrepe(y: np.ndarray, sr: int, frame_step_sec: float, fmin: str, fmax: str):
    """GPU neural F0 tracking used to verify GAME's note events.

    GAME is excellent at segmentation; TorchCrepe gives an independent,
    continuous estimate of vocal pitch.  Combining them lets us correct a
    sustained octave error without trusting a single detector blindly.
    """
    import torch
    import torchcrepe

    target_sr = 16_000
    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    hop_length = max(1, int(round(frame_step_sec * sr)))
    requested_device = os.getenv("SONGAPP_DEVICE", "auto").lower()
    device = "cuda" if requested_device != "cpu" and torch.cuda.is_available() else "cpu"
    audio = torch.from_numpy(np.ascontiguousarray(y, dtype=np.float32)).to(device).unsqueeze(0)
    f0, periodicity = torchcrepe.predict(
        audio,
        sr,
        hop_length=hop_length,
        fmin=float(librosa.note_to_hz(fmin)),
        fmax=float(librosa.note_to_hz(fmax)),
        model="full",
        return_periodicity=True,
        batch_size=1024 if device == "cuda" else 256,
        device=device,
    )
    f0 = f0.squeeze(0).detach().cpu().numpy()
    periodicity = periodicity.squeeze(0).detach().cpu().numpy()
    voiced_flag = periodicity >= 0.45

    rms = librosa.feature.rms(y=y, frame_length=max(1024, hop_length * 4), hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    times = np.arange(len(f0), dtype=float) * frame_step_sec
    rms_db_aligned = np.interp(times, rms_times, rms_db)
    return times, f0, voiced_flag, periodicity, rms_db_aligned


def analyze_vocal(
    input_path: str,
    frame_step_sec: float = 0.01,
    fmin: str = "C2",
    fmax: str = "C6",
    engine: str = "pyin",
    crepe_model: str = "full",
):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    if engine == "energy":
        times, f0, voiced_flag, voiced_probs, rms_db = _analyze_energy(
            y,
            sr,
            frame_step_sec,
        )
    elif engine == "torchcrepe":
        try:
            times, f0, voiced_flag, voiced_probs, rms_db = _analyze_torchcrepe(
                y,
                sr,
                frame_step_sec,
                fmin,
                fmax,
            )
        except (ImportError, RuntimeError) as exc:
            print(f"TorchCrepe unavailable ({exc}); using fast vocal activity map.")
            times, f0, voiced_flag, voiced_probs, rms_db = _analyze_energy(
                y,
                sr,
                frame_step_sec,
            )
    elif engine == "crepe":
        try:
            times, f0, voiced_flag, voiced_probs, rms_db = _analyze_crepe(
                y, sr, frame_step_sec, fmin, fmax, model_capacity=crepe_model
            )
        except ImportError:
            print(
                "crepe/tensorflow не установлены — откатываюсь на pyin. "
                "Установить: pip install crepe tensorflow"
            )
            times, f0, voiced_flag, voiced_probs, rms_db = _analyze_pyin(
                y, sr, frame_step_sec, fmin, fmax
            )
    else:
        times, f0, voiced_flag, voiced_probs, rms_db = _analyze_pyin(
            y, sr, frame_step_sec, fmin, fmax
        )

    frames = []
    for t, freq, voiced, prob, loud in zip(
        times, f0, voiced_flag, voiced_probs, rms_db, strict=False
    ):
        voiced = bool(voiced)
        freq_valid = voiced and freq is not None and not np.isnan(freq) and freq > 0
        frames.append(
            {
                "time": round(float(t), 3),
                "note": freq_to_note(freq) if freq_valid else None,
                "f0_hz": round(float(freq), 2) if freq_valid else None,
                "voiced": voiced,
                "confidence": round(float(prob), 3),
                "loudness_db": round(float(loud), 1),
            }
        )

    return frames


def main():
    parser = argparse.ArgumentParser(description="Анализ вокала: pitch (F0) по кадрам")
    parser.add_argument("input", help="vocals.wav")
    parser.add_argument("output", nargs="?", default="pitch.json")
    parser.add_argument("--step", type=float, default=0.01, help="шаг анализа в секундах")
    parser.add_argument(
        "--engine",
        default="pyin",
        choices=["pyin", "crepe", "torchcrepe", "energy"],
        help="pyin (быстро, встроено) или crepe (точнее, требует TF)",
    )
    parser.add_argument(
        "--crepe-model",
        default="full",
        choices=["tiny", "small", "medium", "large", "full"],
        help="размер модели CREPE (больше = точнее, но медленнее)",
    )
    args = parser.parse_args()

    frames = analyze_vocal(
        args.input, frame_step_sec=args.step, engine=args.engine, crepe_model=args.crepe_model
    )

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(frames, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(frames)} кадров в {args.output} (движок: {args.engine})")


if __name__ == "__main__":
    main()
