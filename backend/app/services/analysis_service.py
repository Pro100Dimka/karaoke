"""
Анализ голоса пользователя: насколько точно спел относительно эталонной
мелодии, которую AI-пайплайн уже вычислил для песни (reference.json).

Переиспользуем src.analyze.vocal.analyze_vocal из AI-пакета для питч-трекинга
записи пользователя — так методика сравнения "запись пользователя vs эталон"
остаётся той же самой, что использовалась при построении самой мелодии, и
результаты гарантированно сопоставимы.
"""
import json
import statistics
from pathlib import Path

import models
from app.services import ai_bridge


def _read_json(path: Path):
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _note_at_time(reference_notes: list[dict], t: float) -> int | None:
    for note in reference_notes:
        if note["start"] <= t < note["end"]:
            return _to_midi(note.get("midi") or note.get("pitch") or note.get("note"))
    return None


def _to_midi(value) -> int | None:
    if isinstance(value, int | float):
        return int(round(value))
    if not isinstance(value, str):
        return None
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    value = value.strip()
    if len(value) < 2 or value[0].upper() not in names:
        return None
    letter = value[0].upper()
    accidental = value[1] if len(value) > 1 and value[1] in {"#", "b"} else ""
    octave_part = value[2:] if accidental else value[1:]
    try:
        octave = int(octave_part)
    except ValueError:
        return None
    return (octave + 1) * 12 + names[letter] + (1 if accidental == "#" else -1 if accidental == "b" else 0)


def analyze_recording(recording: models.Recording, song: models.Song) -> dict:
    if not song.output_dir:
        raise ValueError("Песня ещё не обработана — нет эталонной мелодии для сравнения")

    out_dir = Path(song.output_dir)
    reference_notes = _read_json(out_dir / "reference.json")
    structure = _read_json(out_dir / "structure.json")
    if reference_notes is None:
        raise ValueError("Не найден reference.json — эталонная мелодия ещё не построена")

    analyze_vocal = ai_bridge.get_analyze_vocal()
    pitch_frames = analyze_vocal(recording.path)  # ожидается список {"time": t, "midi": n, ...}

    deviations = []
    hits = 0
    total = 0
    per_frame = []

    for frame in pitch_frames:
        t = frame.get("time")
        user_midi = _to_midi(frame.get("midi") or frame.get("note"))
        if t is None or user_midi is None:
            continue
        ref_midi = _note_at_time(reference_notes, t)
        if ref_midi is None:
            continue  # пауза в оригинале — не судим тишину/выдох
        total += 1
        deviation = abs(user_midi - ref_midi)
        deviations.append(deviation)
        per_frame.append({"time": t, "deviation_semitones": deviation})
        if deviation <= 0.5:  # в пределах полутона считаем попаданием
            hits += 1

    accuracy_percent = round((hits / total) * 100, 1) if total else None
    mean_deviation = round(statistics.mean(deviations), 3) if deviations else None

    sections = None
    if structure:
        sections = _sections_breakdown(structure, per_frame)

    return {
        "pitch_accuracy_percent": accuracy_percent,
        "mean_deviation_semitones": mean_deviation,
        "sections": sections,
    }


def _sections_breakdown(structure: list[dict], per_frame: list[dict]) -> list[dict]:
    breakdown = []
    for section in structure:
        start, end = section.get("start"), section.get("end")
        if start is None or end is None:
            continue
        in_section = [f for f in per_frame if start <= f["time"] < end]
        if in_section:
            avg_dev = round(statistics.mean(f["deviation_semitones"] for f in in_section), 3)
            hit_ratio = round(
                sum(1 for f in in_section if f["deviation_semitones"] <= 0.5) / len(in_section) * 100, 1
            )
        else:
            avg_dev = None
            hit_ratio = None
        breakdown.append({
            "label": section.get("label", section.get("name")),
            "start": start,
            "end": end,
            "accuracy_percent": hit_ratio,
            "mean_deviation_semitones": avg_dev,
        })
    return breakdown
