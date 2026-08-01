"""
Шаг 11. Построение карты сложности.
reference.json (+ lyricsSync.json для разбивки по строкам) -> difficulty.json

Для каждой части песни (строки текста) считает:
диапазон, самые высокие/низкие ноты, среднюю высоту,
скорость исполнения, длину нот и итоговую сложность (0-10).
"""
import argparse
import json

import numpy as np
from src.common.notes import midi_to_note, note_to_midi  # noqa: F401  (реэкспорт)


def notes_in_range(notes: list, start: float, end: float) -> list:
    return [n for n in notes if n["start"] < end and n["end"] > start]


def compute_difficulty(section_notes: list) -> dict:
    if not section_notes:
        return {
            "range": None, "highest": None, "lowest": None,
            "avg_pitch": None, "notes_per_sec": 0, "avg_note_length": 0,
            "difficulty": 0,
        }

    midis = [note_to_midi(n["note"]) for n in section_notes]
    durations = [n["duration"] for n in section_notes]

    highest, lowest = max(midis), min(midis)
    span_semitones = highest - lowest
    avg_pitch_midi = round(sum(midis) / len(midis))
    total_time = section_notes[-1]["end"] - section_notes[0]["start"]
    notes_per_sec = len(section_notes) / total_time if total_time > 0 else 0
    avg_note_length = sum(durations) / len(durations)

    # Эвристика сложности 0..10:
    # больше диапазон, больше нот/сек, короче ноты -> сложнее
    range_score = min(span_semitones / 24, 1.0) * 4       # до 4 баллов за диапазон (2 октавы)
    speed_score = min(notes_per_sec / 4, 1.0) * 4          # до 4 баллов за скорость (4 ноты/сек)
    length_score = min(1.0 / max(avg_note_length, 0.05) / 8, 1.0) * 2  # до 2 баллов за короткие ноты
    difficulty = round(range_score + speed_score + length_score, 1)

    return {
        "range": f"{midi_to_note(lowest)}-{midi_to_note(highest)}",
        "highest": midi_to_note(highest),
        "lowest": midi_to_note(lowest),
        "avg_pitch": midi_to_note(avg_pitch_midi),
        "notes_per_sec": round(notes_per_sec, 2),
        "avg_note_length": round(avg_note_length, 3),
        "difficulty": min(difficulty, 10.0),
    }


def build_difficulty_map(reference_notes: list, sections: list) -> list:
    """
    sections: список {"start":.., "end":.., "text": ...} — обычно строки
    из lyricsSync.json, но можно передать любые границы (куплет/припев).
    """
    result = []
    for sec in sections:
        sec_notes = notes_in_range(reference_notes, sec["start"], sec["end"])
        stats = compute_difficulty(sec_notes)
        result.append({
            "start": sec["start"],
            "end": sec["end"],
            "text": sec.get("text"),
            **stats,
        })
    return result


def main():
    parser = argparse.ArgumentParser(description="Построение карты сложности")
    parser.add_argument("--reference", required=True, help="reference.json")
    parser.add_argument("--sections", required=True,
                         help="lyricsSync.json (строки как секции) или произвольный JSON со start/end/text")
    parser.add_argument("output", nargs="?", default="difficulty.json")
    args = parser.parse_args()

    with open(args.reference, encoding="utf-8") as f:
        reference_notes = json.load(f)
    with open(args.sections, encoding="utf-8") as f:
        sections = json.load(f)

    difficulty_map = build_difficulty_map(reference_notes, sections)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(difficulty_map, f, ensure_ascii=False, indent=2)

    overall = round(np.mean([s["difficulty"] for s in difficulty_map if s["difficulty"]]), 1) \
        if difficulty_map else 0
    print(f"Карта сложности построена: {args.output}")
    print(f"Средняя сложность песни: {overall}/10")


if __name__ == "__main__":
    main()
