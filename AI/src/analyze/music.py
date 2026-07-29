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


def estimate_key(chroma_mean: np.ndarray, boundary_chroma_mean: np.ndarray = None,
                  boundary_weight: float = 1.5):
    """
    Корреляция с профилями Krумhansl-Schmuckler -> лучшая тональность.

    boundary_chroma_mean — усреднённая хрома первых+последних нескольких
    секунд трека. Песни статистически чаще начинаются/заканчиваются на
    тонике или доминанте, так что усиление этих участков помогает
    отличить релятивные мажор/минор (например, C major vs A minor —
    ноты одинаковые, но начало/конец чаще выдают настоящую тонику).
    """
    combined = chroma_mean.copy()
    if boundary_chroma_mean is not None:
        combined = chroma_mean + boundary_weight * boundary_chroma_mean

    best_score, best_key = -1, None
    for i in range(12):
        maj = np.roll(MAJOR_PROFILE, i)
        minr = np.roll(MINOR_PROFILE, i)
        maj_corr = np.corrcoef(combined, maj)[0, 1]
        min_corr = np.corrcoef(combined, minr)[0, 1]
        if maj_corr > best_score:
            best_score, best_key = maj_corr, f"{NOTE_NAMES[i]} major"
        if min_corr > best_score:
            best_score, best_key = min_corr, f"{NOTE_NAMES[i]} minor"
    return best_key, float(best_score)


def fold_tempo(bpm: float, low: float = 70.0, high: float = 180.0) -> float:
    """
    librosa.beat.beat_track часто ошибается в 2 раза (даёт половинный
    или удвоенный темп относительно того, что реально слышит человек).
    Складываем результат в "человеческий" диапазон 70-180 BPM
    удвоением/делением пополам, сохраняя исходное значение отдельно
    для прозрачности.
    """
    folded = bpm
    while folded < low and folded > 0:
        folded *= 2
    while folded > high:
        folded /= 2
    return folded


def estimate_time_signature(onset_env: np.ndarray, sr: int, bpm: float,
                             hop_length: int = 512):
    """
    Более надёжная оценка размера такта через автокорреляцию onset-огибающей
    на лагах, кратных длительности такта для гипотез 3/4 и 4/4 (и бонусом
    6/8, который на слух часто путают с 3/4). Раньше использовалась
    эвристика на дисперсии силы долей — она давала почти всегда 4/4.

    Идея: если реальный размер N/4, то автокорреляция onset-огибающей
    должна иметь выраженный пик на лаге "N долей" и его кратных (2N, 3N...),
    сильнее, чем у конкурирующих гипотез.
    """
    beat_period_sec = 60.0 / bpm if bpm > 0 else 0.5
    beat_period_frames = max(1, int(round(beat_period_sec * sr / hop_length)))

    max_lag = beat_period_frames * 9
    if len(onset_env) < max_lag * 2:
        return "4/4", 0.0  # трек слишком короткий для надёжной оценки

    ac = librosa.autocorrelate(onset_env, max_size=max_lag)
    ac0 = ac[0] + 1e-9

    candidates = {"3/4": 3, "4/4": 4, "6/8": 6}
    scores = {}
    for label, group in candidates.items():
        lag = beat_period_frames * group
        vals = [ac[lag * k] for k in (1, 2) if lag * k < len(ac)]
        scores[label] = (np.mean(vals) / ac0) if vals else 0.0

    best_label = max(scores, key=scores.get)
    confidence = float(scores[best_label])
    return best_label, confidence


def analyze_music(input_path: str, key_change_window_sec: float = 20.0):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    # Темп и доли
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    # В librosa >= 0.10 tempo может вернуться как массив (даже из одного числа)
    tempo_raw = float(np.atleast_1d(tempo)[0])
    tempo = fold_tempo(tempo_raw)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    first_beat = float(beat_times[0]) if len(beat_times) else 0.0

    # Изменение темпа по окнам (динамический темп)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    try:
        tempo_func = librosa.feature.rhythm.tempo
    except AttributeError:
        tempo_func = librosa.beat.tempo
    dtempo = tempo_func(onset_envelope=onset_env, sr=sr, aggregate=None)
    dtempo = np.array([fold_tempo(float(b)) for b in dtempo])
    tempo_curve = [
        {"time": float(t), "bpm": float(b)}
        for t, b in zip(librosa.frames_to_time(np.arange(len(dtempo)), sr=sr), dtempo)
    ]

    # Размер такта — автокорреляция onset-огибающей (см. estimate_time_signature)
    time_signature, ts_confidence = estimate_time_signature(onset_env, sr, tempo)

    # Тональность в целом, с усилением начала/конца трека (см. estimate_key)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    n_frames = chroma.shape[1]
    boundary_span = max(1, int(n_frames * 0.05))
    boundary_chroma = np.concatenate(
        [chroma[:, :boundary_span], chroma[:, -boundary_span:]], axis=1
    ).mean(axis=1)
    key, confidence = estimate_key(chroma.mean(axis=1), boundary_chroma)

    # Смена тональности по окнам, со сглаживанием (гистерезисом): считаем
    # смену тональности подтверждённой, только если новое окно повторилось
    # min_repeat раз подряд — иначе это шум/дребезг между релятивными
    # мажором и минором (одинаковый набор нот, разная "тоника"), а не
    # реальная модуляция.
    min_repeat = 2
    raw_windows = []
    hop = int(key_change_window_sec * sr)
    for start in range(0, len(y), hop):
        segment = y[start:start + hop]
        if len(segment) < sr:  # слишком коротко
            continue
        seg_chroma = librosa.feature.chroma_cqt(y=segment, sr=sr)
        seg_key, seg_conf = estimate_key(seg_chroma.mean(axis=1))
        raw_windows.append({"time": round(start / sr, 2), "key": seg_key, "confidence": round(seg_conf, 3)})

    key_changes = []
    confirmed_key = None
    i = 0
    while i < len(raw_windows):
        candidate = raw_windows[i]["key"]
        j = i
        while j < len(raw_windows) and raw_windows[j]["key"] == candidate:
            j += 1
        run_length = j - i
        if candidate != confirmed_key and run_length >= min_repeat:
            key_changes.append({
                "time": raw_windows[i]["time"],
                "key": candidate,
                "confidence": raw_windows[i]["confidence"],
            })
            confirmed_key = candidate
        i = j

    result = {
        "bpm": round(float(tempo), 2),
        "bpm_raw": round(float(tempo_raw), 2),  # необработанное значение от librosa, для отладки
        "first_beat_sec": round(first_beat, 3),
        "tempo_curve": tempo_curve,
        "time_signature": time_signature,
        "time_signature_confidence": round(ts_confidence, 3),
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
