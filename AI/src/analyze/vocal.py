"""
Шаг 5. Анализ вокала.
vocals.wav -> pitch.json

Для каждого интервала времени (по умолчанию 10 мс) считает:
высоту голоса (F0 -> нота), громкость, наличие вокала/паузы, уверенность.
"""
import argparse
import json
import numpy as np
import librosa


def freq_to_note(freq: float) -> str:
    if freq <= 0 or np.isnan(freq):
        return None
    note_number = 12 * np.log2(freq / 440.0) + 69  # MIDI number, A4=69
    note_number = int(round(note_number))
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    octave = note_number // 12 - 1
    name = names[note_number % 12]
    return f"{name}{octave}"


def analyze_vocal(input_path: str, frame_step_sec: float = 0.01,
                   fmin: str = "C2", fmax: str = "C6"):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    hop_length = max(1, int(round(frame_step_sec * sr)))
    frame_length = hop_length * 4  # окно анализа шире шага для устойчивости pYIN

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, sr=sr,
        fmin=librosa.note_to_hz(fmin),
        fmax=librosa.note_to_hz(fmax),
        frame_length=frame_length,
        hop_length=hop_length,
    )

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    # приводим к дБ для более привычной шкалы громкости
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)

    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)

    frames = []
    for t, freq, voiced, prob, loud in zip(times, f0, voiced_flag, voiced_probs, rms_db):
        frames.append({
            "time": round(float(t), 3),
            "note": freq_to_note(freq) if voiced else None,
            "f0_hz": round(float(freq), 2) if voiced and not np.isnan(freq) else None,
            "voiced": bool(voiced),
            "confidence": round(float(prob), 3),
            "loudness_db": round(float(loud), 1),
        })

    return frames


def main():
    parser = argparse.ArgumentParser(description="Анализ вокала: pitch (F0) по кадрам")
    parser.add_argument("input", help="vocals.wav")
    parser.add_argument("output", nargs="?", default="pitch.json")
    parser.add_argument("--step", type=float, default=0.01, help="шаг анализа в секундах")
    args = parser.parse_args()

    frames = analyze_vocal(args.input, frame_step_sec=args.step)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(frames, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(frames)} кадров в {args.output}")


if __name__ == "__main__":
    main()
