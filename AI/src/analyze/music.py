"""
Шаг 4. Анализ минусовки.
instrumental.wav -> music.json

Рассчитывает: BPM, первую долю, темп, изменение темпа,
размер (4/4, 3/4 ...), тональность, смену тональности.
"""
import argparse
import json
import numpy as np
import librosa

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def estimate_key(chroma_mean: np.ndarray):
    """Корреляция с профилями Krumhansl-Schmuckler -> лучшая тональность."""
    best_score, best_key = -1, None
    for i in range(12):
        maj = np.roll(MAJOR_PROFILE, i)
        minr = np.roll(MINOR_PROFILE, i)
        maj_corr = np.corrcoef(chroma_mean, maj)[0, 1]
        min_corr = np.corrcoef(chroma_mean, minr)[0, 1]
        if maj_corr > best_score:
            best_score, best_key = maj_corr, f"{NOTE_NAMES[i]} major"
        if min_corr > best_score:
            best_score, best_key = min_corr, f"{NOTE_NAMES[i]} minor"
    return best_key, float(best_score)


def analyze_music(input_path: str, key_change_window_sec: float = 20.0):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    # Темп и доли
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    # В librosa >= 0.10 tempo может вернуться как массив (даже из одного числа)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    first_beat = float(beat_times[0]) if len(beat_times) else 0.0

    # Изменение темпа по окнам (динамический темп)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    # librosa.beat.tempo переименован в librosa.feature.rhythm.tempo (0.10+),
    # но старый alias пока работает — на всякий случай пробуем оба варианта
    try:
        tempo_func = librosa.feature.rhythm.tempo
    except AttributeError:
        tempo_func = librosa.beat.tempo
    dtempo = tempo_func(onset_envelope=onset_env, sr=sr, aggregate=None)
    tempo_curve = [
        {"time": float(t), "bpm": float(b)}
        for t, b in zip(librosa.frames_to_time(np.arange(len(dtempo)), sr=sr), dtempo)
    ]

    # Размер такта (эвристика по интервалам между сильными долями через autocorrelation)
    intervals = np.diff(beat_times) if len(beat_times) > 1 else np.array([])
    time_signature = "4/4"  # разумный дефолт
    if len(intervals) > 8:
        # ищем период в группах из 3 или 4 долей по стабильности акцента
        # упрощённая эвристика: смотрим на автокорреляцию силы онсетов на долях
        beat_strength = onset_env[librosa.time_to_frames(beat_times, sr=sr).clip(max=len(onset_env) - 1)]
        for group in (3, 4):
            groups = [beat_strength[i::group] for i in range(group)]
            variances = [np.var(g) for g in groups if len(g) > 1]
            if variances and max(variances) / (np.mean(variances) + 1e-9) > 1.5:
                time_signature = f"{group}/4"
                break

    # Тональность в целом
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key, confidence = estimate_key(chroma.mean(axis=1))

    # Смена тональности по окнам
    key_changes = []
    hop = int(key_change_window_sec * sr)
    prev_key = None
    for start in range(0, len(y), hop):
        segment = y[start:start + hop]
        if len(segment) < sr:  # слишком коротко
            continue
        seg_chroma = librosa.feature.chroma_cqt(y=segment, sr=sr)
        seg_key, seg_conf = estimate_key(seg_chroma.mean(axis=1))
        if seg_key != prev_key:
            key_changes.append({
                "time": round(start / sr, 2),
                "key": seg_key,
                "confidence": round(seg_conf, 3),
            })
            prev_key = seg_key

    result = {
        "bpm": round(float(tempo), 2),
        "first_beat_sec": round(first_beat, 3),
        "tempo_curve": tempo_curve,
        "time_signature": time_signature,
        "key": key,
        "key_confidence": round(confidence, 3),
        "key_changes": key_changes,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Анализ минусовки: BPM, тональность, размер")
    parser.add_argument("input", help="instrumental.wav или song.wav")
    parser.add_argument("output", nargs="?", default="music.json")
    args = parser.parse_args()

    result = analyze_music(args.input)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Сохранено: {args.output}")
    print(json.dumps({k: v for k, v in result.items() if k != "tempo_curve"},
                      ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
