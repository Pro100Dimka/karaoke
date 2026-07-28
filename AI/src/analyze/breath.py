"""
Шаг 7. Анализ дыхания.
vocals.wav (+ опционально reference.json) -> breaths.json

Определяет паузы (где певец молчит), потенциальные вдохи и
окончания фраз (паузы длиннее заданного порога).
"""
import argparse
import json
import numpy as np
import librosa


def analyze_breath(input_path: str, top_db: float = 30.0,
                    phrase_gap_sec: float = 0.6,
                    breath_gap_sec: float = 0.15):
    y, sr = librosa.load(input_path, sr=None, mono=True)

    # Находим не-тихие (voiced/loud) интервалы
    intervals = librosa.effects.split(y, top_db=top_db)
    intervals_sec = [(s / sr, e / sr) for s, e in intervals]

    pauses = []
    for i in range(len(intervals_sec) - 1):
        gap_start = intervals_sec[i][1]
        gap_end = intervals_sec[i + 1][0]
        gap_duration = gap_end - gap_start
        if gap_duration <= 0:
            continue

        if gap_duration >= phrase_gap_sec:
            kind = "phrase_end"   # конец музыкальной фразы
        elif gap_duration >= breath_gap_sec:
            kind = "breath"       # вероятный вдох
        else:
            kind = "micro_pause"  # микропауза внутри фразы

        pauses.append({
            "start": round(gap_start, 3),
            "end": round(gap_end, 3),
            "duration": round(gap_duration, 3),
            "type": kind,
        })

    phrases = [
        {"start": round(s, 3), "end": round(e, 3), "duration": round(e - s, 3)}
        for s, e in intervals_sec
    ]

    return {"phrases": phrases, "pauses": pauses}


def main():
    parser = argparse.ArgumentParser(description="Анализ пауз/дыхания в вокальной дорожке")
    parser.add_argument("input", help="vocals.wav")
    parser.add_argument("output", nargs="?", default="breaths.json")
    parser.add_argument("--top-db", type=float, default=30.0,
                         help="порог тишины в дБ (выше = чувствительнее к тихому вокалу)")
    parser.add_argument("--phrase-gap", type=float, default=0.6,
                         help="пауза длиннее -> конец фразы, сек")
    parser.add_argument("--breath-gap", type=float, default=0.15,
                         help="пауза длиннее -> вероятный вдох, сек")
    args = parser.parse_args()

    result = analyze_breath(args.input, args.top_db, args.phrase_gap, args.breath_gap)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Найдено {len(result['phrases'])} фраз, {len(result['pauses'])} пауз -> {args.output}")


if __name__ == "__main__":
    main()
