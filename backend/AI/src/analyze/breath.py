"""
Шаг 7. Анализ дыхания.
vocals.wav (+ опционально pitch.json) -> breaths.json

Определяет паузы (где певец молчит), потенциальные вдохи и
окончания фраз (паузы длиннее заданного порога).

v2: если передан pitch.json (из шага 5), используем voiced-флаг
pitch-детектора вместо/вместе с простым RMS-порогом. Причина: чистый
top_db-порог на самой громкости путает тихое пение с настоящей тишиной
(и наоборот — громкий шум/дыхание с пением). voiced-флаг pYIN/CREPE
уже "понимает" наличие именно тональной вокальной энергии, а не любой
громкости, так что пересечение (voiced ИЛИ громко) даёт более честные
границы фраз.
"""

import argparse
import json

import librosa
import numpy as np


def _estimate_adaptive_top_db(
    y: np.ndarray,
    sr: int,
    margin_db: float = 6.0,
    min_top_db: float = 20.0,
    max_top_db: float = 50.0,
) -> float:
    """
    librosa.effects.split(top_db=X) считает силу X дБ ниже пикового
    уровня трека тишиной. Фиксированное число (например, 30 дБ) хорошо
    работает "в среднем", но на тихо сведённом или, наоборот, сильно
    сжатом (loud, low dynamic range) треке даёт неверную границу.

    Вместо фиксированного значения меряем реальный шумовой пол трека:
    10-й перцентиль RMS (в дБ относительно пикового уровня) — это
    приблизительно "тихие" участки (паузы/фоновый шум). top_db
    выставляем чуть выше этого пола (margin_db запаса), чтобы граница
    силы проходила между реальной тишиной и реальным пением, а не по
    произвольной константе.
    """
    rms = librosa.feature.rms(y=y)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    noise_floor_db = float(np.percentile(rms_db, 10))  # отрицательное число, напр. -42.0
    adaptive = abs(noise_floor_db) - margin_db
    return float(np.clip(adaptive, min_top_db, max_top_db))


def _intervals_from_rms(y: np.ndarray, sr: int, top_db: float):
    intervals = librosa.effects.split(y, top_db=top_db)
    return [(s / sr, e / sr) for s, e in intervals]


def _intervals_from_pitch(pitch_frames: list, merge_gap_sec: float = 0.05):
    """Строит интервалы 'звучания' из voiced-флагов pitch.json."""
    if not pitch_frames:
        return []
    step = pitch_frames[1]["time"] - pitch_frames[0]["time"] if len(pitch_frames) > 1 else 0.01

    intervals = []
    start = None
    prev_t = None
    for frame in pitch_frames:
        t = frame["time"]
        voiced = frame.get("voiced", False)
        if voiced and start is None:
            start = t
        elif not voiced and start is not None:
            intervals.append((start, prev_t + step))
            start = None
        prev_t = t
    if start is not None:
        intervals.append((start, prev_t + step))

    # склеиваем интервалы, разделённые микро-провалами (артефакты детектора)
    merged = []
    for s, e in intervals:
        if merged and s - merged[-1][1] <= merge_gap_sec:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def _union_intervals(a: list, b: list):
    """Объединение (union) двух списков интервалов [(start,end), ...]."""
    all_intervals = sorted(a + b)
    if not all_intervals:
        return []
    merged = [all_intervals[0]]
    for s, e in all_intervals[1:]:
        if s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def analyze_breath(
    input_path: str,
    top_db: float = None,
    phrase_gap_sec: float = 0.6,
    breath_gap_sec: float = 0.15,
    pitch_frames: list = None,
):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    if top_db is None:
        top_db = _estimate_adaptive_top_db(y, sr)

    rms_intervals = _intervals_from_rms(y, sr, top_db)

    if pitch_frames:
        pitch_intervals = _intervals_from_pitch(pitch_frames)
        intervals_sec = _union_intervals(rms_intervals, pitch_intervals)
    else:
        intervals_sec = rms_intervals

    pauses = []
    for i in range(len(intervals_sec) - 1):
        gap_start = intervals_sec[i][1]
        gap_end = intervals_sec[i + 1][0]
        gap_duration = gap_end - gap_start
        if gap_duration <= 0:
            continue

        if gap_duration >= phrase_gap_sec:
            kind = "phrase_end"  # конец музыкальной фразы
        elif gap_duration >= breath_gap_sec:
            kind = "breath"  # вероятный вдох
        else:
            kind = "micro_pause"  # микропауза внутри фразы

        pauses.append(
            {
                "start": round(gap_start, 3),
                "end": round(gap_end, 3),
                "duration": round(gap_duration, 3),
                "type": kind,
            }
        )

    phrases = [
        {"start": round(s, 3), "end": round(e, 3), "duration": round(e - s, 3)}
        for s, e in intervals_sec
    ]

    return {"phrases": phrases, "pauses": pauses, "top_db_used": round(top_db, 1)}


def main():
    parser = argparse.ArgumentParser(description="Анализ пауз/дыхания в вокальной дорожке")
    parser.add_argument("input", help="vocals.wav")
    parser.add_argument("output", nargs="?", default="breaths.json")
    parser.add_argument(
        "--top-db",
        type=float,
        default=None,
        help="порог тишины в дБ; по умолчанию считается " "автоматически из шумового пола трека",
    )
    parser.add_argument(
        "--phrase-gap", type=float, default=0.6, help="пауза длиннее -> конец фразы, сек"
    )
    parser.add_argument(
        "--breath-gap", type=float, default=0.15, help="пауза длиннее -> вероятный вдох, сек"
    )
    parser.add_argument(
        "--pitch", default=None, help="pitch.json (шаг 5) — включает voiced-флаг в VAD"
    )
    args = parser.parse_args()

    pitch_frames = None
    if args.pitch:
        with open(args.pitch, encoding="utf-8") as f:
            pitch_frames = json.load(f)

    result = analyze_breath(args.input, args.top_db, args.phrase_gap, args.breath_gap, pitch_frames)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Найдено {len(result['phrases'])} фраз, {len(result['pauses'])} пауз -> {args.output}")


if __name__ == "__main__":
    main()
