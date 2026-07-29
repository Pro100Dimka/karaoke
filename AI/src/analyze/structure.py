"""
Дополнительный шаг. Автоматическая структурная сегментация песни.
instrumental.wav (или song.wav) -> structure.json

Разбивает трек на структурные блоки (куплет/припев/бридж и т.п.) без
разметки вручную — через матрицу самоподобия (self-similarity) по
хрома-признакам и агломеративную кластеризацию (всё уже есть в librosa,
доп. ничего ставить не нужно).

Зачем: карта сложности (evaluation/difficulty_map.py) до этого строилась
только по строкам текста — то есть "сложность" считалась построчно.
Секции отсюда можно использовать вместо строк, чтобы увидеть сложность
по структурным блокам целиком (например: "самый сложный блок — второй
припев, 7.8/10"), что ближе к тому, как обычно думают про песню.

Метки блоков (Section A, Section B...) условны — алгоритм не знает,
что именно куплет, а что припев, только группирует похожие по звучанию
участки в один кластер.
"""
import argparse
import json

import librosa
import numpy as np


def segment_structure(input_path: str, n_segments: int = 6) -> list:
    y, sr = librosa.load(input_path, sr=None, mono=True)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)

    # объединяем тембральные (mfcc) и гармонические (chroma) признаки —
    # так кластеризация учитывает и мелодию/аккорды, и общий "окрас" звука
    features = np.vstack([chroma, mfcc])

    # librosa.segment.agglomerative кластеризует кадры по признакам в
    # n_segments связных по времени сегментов
    boundaries_frames = librosa.segment.agglomerative(features, n_segments)
    boundaries_frames = np.unique(np.concatenate([[0], boundaries_frames, [features.shape[1]]]))
    boundary_times = librosa.frames_to_time(boundaries_frames, sr=sr)

    # метка кластера для каждого сегмента — по преобладающему звучанию
    # (упрощённо: группируем похожие по средней хроме сегменты под одной буквой)
    segment_chromas = []
    for i in range(len(boundary_times) - 1):
        f_start = boundaries_frames[i]
        f_end = boundaries_frames[i + 1]
        segment_chromas.append(chroma[:, f_start:f_end].mean(axis=1))

    labels = _label_similar_segments(segment_chromas)

    sections = []
    for i in range(len(boundary_times) - 1):
        sections.append({
            "start": round(float(boundary_times[i]), 2),
            "end": round(float(boundary_times[i + 1]), 2),
            "label": labels[i],
        })
    return sections


def _label_similar_segments(segment_features: list, similarity_threshold: float = 0.93) -> list:
    """Даёт одинаковую букву похожим по звучанию сегментам (A, B, C...)."""
    import string

    labels = [None] * len(segment_features)
    cluster_reps = []  # список (label, feature) уже назначенных кластеров
    alphabet = string.ascii_uppercase

    for i, feat in enumerate(segment_features):
        assigned = None
        for label, rep in cluster_reps:
            norm = (np.linalg.norm(feat) * np.linalg.norm(rep)) + 1e-9
            similarity = float(np.dot(feat, rep) / norm)
            if similarity >= similarity_threshold:
                assigned = label
                break
        if assigned is None:
            assigned = alphabet[len(cluster_reps) % len(alphabet)]
            cluster_reps.append((assigned, feat))
        labels[i] = f"Section {assigned}"
    return labels


def main():
    parser = argparse.ArgumentParser(description="Автоматическая структурная сегментация песни")
    parser.add_argument("input", help="instrumental.wav или song.wav")
    parser.add_argument("output", nargs="?", default="structure.json")
    parser.add_argument("--segments", type=int, default=6,
                         help="ориентировочное число структурных блоков")
    args = parser.parse_args()

    sections = segment_structure(args.input, args.segments)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(sections, f, ensure_ascii=False, indent=2)

    print(f"Найдено {len(sections)} структурных блоков -> {args.output}")
    for s in sections:
        print(f"  {s['start']:>6.1f}s - {s['end']:>6.1f}s  {s['label']}")


if __name__ == "__main__":
    main()
