"""
Шаг 6. Построение эталонной мелодии.
pitch.json -> reference.json

Из тысяч точек (кадров pitch.json) строит непрерывную мелодию:
последовательность нот с [начало, конец, нота, точность].
"""
import argparse
import json


def build_reference(pitch_frames: list, min_note_duration: float = 0.06,
                     confidence_threshold: float = 0.4) -> list:
    """
    Группирует последовательные кадры с одинаковой (или близкой) нотой
    в одну ноту. Короткие/неуверенные фрагменты отбрасываются или
    сливаются с соседями.
    """
    notes = []
    current_note = None
    current_start = None
    current_confidences = []
    prev_time = None
    prev_step = None

    def flush(end_time):
        nonlocal current_note, current_start, current_confidences
        if current_note is not None and current_start is not None:
            duration = end_time - current_start
            if duration >= min_note_duration:
                notes.append({
                    "note": current_note,
                    "start": round(current_start, 3),
                    "end": round(end_time, 3),
                    "duration": round(duration, 3),
                    "confidence": round(sum(current_confidences) / len(current_confidences), 3)
                    if current_confidences else 0.0,
                })
        current_note, current_start, current_confidences = None, None, []

    for frame in pitch_frames:
        t = frame["time"]
        note = frame.get("note")
        conf = frame.get("confidence", 0.0)
        voiced = frame.get("voiced", False)

        step = t - prev_time if prev_time is not None else (
            pitch_frames[1]["time"] - pitch_frames[0]["time"] if len(pitch_frames) > 1 else 0.01
        )
        prev_time = t

        valid = voiced and note is not None and conf >= confidence_threshold

        if not valid:
            flush(t)
            prev_step = step
            continue

        if note != current_note:
            flush(t)
            current_note = note
            current_start = t
        current_confidences.append(conf)
        prev_step = step

    if pitch_frames:
        last_t = pitch_frames[-1]["time"] + (prev_step or 0.01)
        flush(last_t)
    print(f"Reference notes: {len(notes)}")
    return notes


def main():
    parser = argparse.ArgumentParser(description="Построение эталонной мелодии из pitch.json")
    parser.add_argument("input", help="pitch.json")
    parser.add_argument("output", nargs="?", default="reference.json")
    parser.add_argument("--min-duration", type=float, default=0.06,
                         help="минимальная длительность ноты, сек")
    parser.add_argument("--confidence", type=float, default=0.4,
                         help="порог уверенности pitch-детектора")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        pitch_frames = json.load(f)

    notes = build_reference(pitch_frames, args.min_duration, args.confidence)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

    print(f"Построено {len(notes)} нот -> {args.output}")


if __name__ == "__main__":
    main()
