"""
Шаг 6. Построение эталонной мелодии.
pitch.json -> reference.json

Из тысяч точек (кадров pitch.json) строит непрерывную мелодию:
последовательность нот с [начало, конец, нота, точность].

ВАЖНО (v2): старая версия обрывала ноту на ЛЮБОМ кадре, где имя ноты
отличалось от предыдущего. Поскольку сырой F0 от pYIN естественно
дрожит (вибрато, портаменто, шум) даже когда певец держит одну ноту,
это дробило одну реальную ноту на десятки коротких обрывков.

Новая версия:
1. Переводит ноты в MIDI-номера и сглаживает последовательность
   медианой по скользящему окну (устраняет одиночные выбросы).
2. Использует гистерезис: смена "текущей" ноты происходит только
   если новая нота удерживается N кадров подряд, а не один кадр.
3. Перекрывает короткие провалы в voiced (например, согласные,
   дыхание длиной < max_gap_sec) — они не обрывают ноту, если по
   обе стороны от провала одна и та же нота.
4. Только после сглаживания короткие ноты (< min_note_duration)
   отбрасываются — их остаётся значительно меньше.
"""
import argparse
import json
from collections import Counter

import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_to_midi(note: str) -> int:
    if "#" in note:
        name, octave = note[:2], note[2:]
    else:
        name, octave = note[:1], note[1:]
    return NOTE_NAMES.index(name) + (int(octave) + 1) * 12


def midi_to_note(m: int) -> str:
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def _smooth_midi_sequence(midi_seq: list, window: int = 5) -> list:
    """Медиана/мода по скользящему окну, None (тишина) сохраняется как есть."""
    n = len(midi_seq)
    half = window // 2
    smoothed = [None] * n
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        vals = [v for v in midi_seq[lo:hi] if v is not None]
        if not vals:
            smoothed[i] = None
        else:
            smoothed[i] = Counter(vals).most_common(1)[0][0]
    return smoothed


def _merge_adjacent_same_notes(notes: list, max_gap_sec: float = 0.01) -> list:
    """Склеивает соседние ноты с одинаковым именем (например, после
    удаления октавного сбоя между ними — остаются два фрагмента одной
    и той же ноты вместо одного)."""
    if not notes:
        return notes
    merged = [dict(notes[0])]
    for n in notes[1:]:
        last = merged[-1]
        if n["note"] == last["note"] and n["start"] - last["end"] <= max_gap_sec:
            last["end"] = n["end"]
            last["duration"] = round(last["end"] - last["start"], 3)
        else:
            merged.append(dict(n))
    return merged


def _fix_octave_errors(notes: list, max_octave_note_duration: float = 0.15) -> list:
    """
    Pitch-детекторы иногда 'прыгают' ровно на октаву (12 полутонов) на
    резких транзиентах/шуме, создавая короткую ложную ноту между двумя
    одинаковыми/соседними нотами. Если нота:
      - короче max_octave_note_duration
      - и отличается от соседей (слева и справа) ровно на 12 полутонов
    считаем её октавной ошибкой и склеиваем с соседями (удаляем).
    """
    if len(notes) < 3:
        return notes

    result = list(notes)
    changed = True
    while changed:
        changed = False
        for i in range(1, len(result) - 1):
            prev_n, cur_n, next_n = result[i - 1], result[i], result[i + 1]
            if cur_n["duration"] > max_octave_note_duration:
                continue
            prev_midi = note_to_midi(prev_n["note"])
            cur_midi = note_to_midi(cur_n["note"])
            next_midi = note_to_midi(next_n["note"])
            is_octave_from_prev = abs(cur_midi - prev_midi) == 12
            is_octave_from_next = abs(cur_midi - next_midi) == 12
            if is_octave_from_prev and is_octave_from_next and prev_midi == next_midi:
                # явная октавная вставка между двумя одинаковыми нотами — удаляем,
                # расширяя соседнюю (более длинную) ноту на освободившееся время
                if prev_n["duration"] >= next_n["duration"]:
                    prev_n["end"] = cur_n["end"]
                    prev_n["duration"] = round(prev_n["end"] - prev_n["start"], 3)
                else:
                    next_n["start"] = cur_n["start"]
                    next_n["duration"] = round(next_n["end"] - next_n["start"], 3)
                del result[i]
                changed = True
                break
    return result


def _resolve_confidence_threshold(pitch_frames: list, confidence_threshold,
                                   confidence_percentile: float,
                                   min_confidence_floor: float,
                                   max_confidence_ceiling: float) -> float:
    """
    ИСПРАВЛЕНО (v3): раньше был фиксированный порог confidence_threshold=0.4,
    сравниваемый напрямую с полем "confidence" (= voiced_probs из pYIN).

    Проблема: voiced_flag в pYIN — это не "confidence > порог", а решение
    Viterbi/HMM-декодирования по всей последовательности (учитывает соседние
    кадры). Поэтому бывают целые участки, где voiced=True почти везде, но
    сам voiced_probs стабильно низкий (0.05-0.2) — например, тихие/
    приглушённые места после сепарации вокала, дыхание, концы фраз.
    Фиксированный порог 0.4 вырезал такие участки целиком, из-за чего
    в reference.json пропадали целые куски мелодии.

    Теперь, если confidence_threshold не передан явно (None), порог
    считается АДАПТИВНО под конкретную песню/движок: берём
    confidence_percentile-й перцентиль среди confidence кадров,
    помеченных voiced=True, зажимая его в разумный коридор
    [min_confidence_floor, max_confidence_ceiling]. Так порог сам
    подстраивается под то, насколько "уверенно" в среднем модель
    размечает голос в этой конкретной записи, вместо одной жёсткой
    цифры на все случаи.
    """
    if confidence_threshold is not None:
        return float(confidence_threshold)

    voiced_confidences = [
        f.get("confidence", 0.0) for f in pitch_frames if f.get("voiced")
    ]
    if not voiced_confidences:
        return min_confidence_floor

    adaptive = float(np.percentile(voiced_confidences, confidence_percentile))
    return max(min_confidence_floor, min(adaptive, max_confidence_ceiling))


def build_reference(pitch_frames: list, min_note_duration: float = 0.08,
                     confidence_threshold: float | None = None,
                     confidence_percentile: float = 15.0,
                     min_confidence_floor: float = 0.03,
                     max_confidence_ceiling: float = 0.4,
                     smoothing_window: int = 5,
                     stable_frames: int = 3,
                     max_gap_sec: float = 0.08) -> list:
    """
    confidence_threshold — порог по voiced_probs для отбраковки кадра.
                         По умолчанию None: порог вычисляется адаптивно
                         под конкретную песню (см. _resolve_confidence_threshold).
                         Передайте число, чтобы вернуть старое жёсткое
                         поведение (например, 0.4).
    confidence_percentile, min_confidence_floor, max_confidence_ceiling —
                         параметры адаптивного порога (используются только
                         если confidence_threshold=None).
    smoothing_window  — окно медианного сглаживания (в кадрах)
    stable_frames     — сколько кадров подряд должна держаться новая
                         нота, прежде чем считать, что произошла смена ноты
    max_gap_sec       — провалы в voiced короче этого считаются
                         артефактом (согласная/дыхание) и не обрывают ноту,
                         если нота до и после провала совпадает
    """
    if not pitch_frames:
        return []

    step = (pitch_frames[1]["time"] - pitch_frames[0]["time"]) if len(pitch_frames) > 1 else 0.01
    max_gap_frames = max(1, int(round(max_gap_sec / step)))

    resolved_threshold = _resolve_confidence_threshold(
        pitch_frames, confidence_threshold, confidence_percentile,
        min_confidence_floor, max_confidence_ceiling,
    )

    # 1) сырые midi-номера по кадрам (None = не voiced / низкая уверенность)
    raw_midi = []
    confidences = []
    for frame in pitch_frames:
        note = frame.get("note")
        conf = frame.get("confidence", 0.0)
        voiced = frame.get("voiced", False)
        if voiced and note is not None and conf >= resolved_threshold:
            raw_midi.append(note_to_midi(note))
        else:
            raw_midi.append(None)
        confidences.append(conf)

    # 2) сглаживание модой по окну
    smoothed = _smooth_midi_sequence(raw_midi, window=smoothing_window)

    # 3) перекрываем короткие провалы None, если нота до/после совпадает
    i = 0
    n = len(smoothed)
    while i < n:
        if smoothed[i] is None:
            j = i
            while j < n and smoothed[j] is None:
                j += 1
            gap_len = j - i
            left = smoothed[i - 1] if i > 0 else None
            right = smoothed[j] if j < n else None
            if gap_len <= max_gap_frames and left is not None and left == right:
                for k in range(i, j):
                    smoothed[k] = left
            i = j
        else:
            i += 1

    # 4) гистерезис: смена текущей ноты только после stable_frames
    #    подряд идущих кадров с новым значением
    stabilized = [None] * n
    current = None
    candidate = None
    candidate_count = 0
    for idx, val in enumerate(smoothed):
        if val == current:
            candidate, candidate_count = None, 0
        elif val is None:
            # тишина сразу считается тишиной (после шага 3 короткие
            # провалы уже устранены)
            current = None
            candidate, candidate_count = None, 0
        else:
            if val == candidate:
                candidate_count += 1
            else:
                candidate, candidate_count = val, 1
            if candidate_count >= stable_frames:
                current = candidate
                candidate, candidate_count = None, 0
        stabilized[idx] = current

    # 5) группировка стабилизированной последовательности в ноты
    notes = []
    seg_start_idx = None
    seg_note = None

    def flush(end_idx):
        nonlocal seg_start_idx, seg_note
        if seg_note is not None and seg_start_idx is not None:
            start_t = pitch_frames[seg_start_idx]["time"]
            end_t = pitch_frames[end_idx]["time"] if end_idx < n else pitch_frames[-1]["time"] + step
            duration = end_t - start_t
            if duration >= min_note_duration:
                seg_conf = confidences[seg_start_idx:end_idx] or [0.0]
                notes.append({
                    "note": midi_to_note(seg_note),
                    "start": round(start_t, 3),
                    "end": round(end_t, 3),
                    "duration": round(duration, 3),
                    "confidence": round(sum(seg_conf) / len(seg_conf), 3),
                })
        seg_start_idx, seg_note = None, None

    for idx, val in enumerate(stabilized):
        if val != seg_note:
            flush(idx)
            if val is not None:
                seg_start_idx, seg_note = idx, val
    flush(n)

    notes = _fix_octave_errors(notes)
    notes = _merge_adjacent_same_notes(notes)

    print(f"Reference notes: {len(notes)} (raw frames: {len(pitch_frames)})")
    return notes


def main():
    parser = argparse.ArgumentParser(description="Построение эталонной мелодии из pitch.json")
    parser.add_argument("input", help="pitch.json")
    parser.add_argument("output", nargs="?", default="reference.json")
    parser.add_argument("--min-duration", type=float, default=0.08,
                         help="минимальная длительность ноты, сек")
    parser.add_argument("--confidence", type=float, default=None,
                         help="порог уверенности pitch-детектора (по умолчанию "
                              "считается адаптивно под песню, см. --confidence-percentile). "
                              "Передайте число (например 0.4) для старого фиксированного порога")
    parser.add_argument("--confidence-percentile", type=float, default=15.0,
                         help="перцентиль confidence среди voiced-кадров, используемый "
                              "как адаптивный порог (игнорируется, если задан --confidence)")
    parser.add_argument("--confidence-floor", type=float, default=0.03,
                         help="минимальное значение адаптивного порога")
    parser.add_argument("--confidence-ceiling", type=float, default=0.4,
                         help="максимальное значение адаптивного порога")
    parser.add_argument("--smoothing-window", type=int, default=5,
                         help="окно медианного сглаживания, в кадрах")
    parser.add_argument("--stable-frames", type=int, default=3,
                         help="сколько кадров подряд для смены ноты (гистерезис)")
    parser.add_argument("--max-gap", type=float, default=0.08,
                         help="провалы voiced короче этого не обрывают ноту, сек")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        pitch_frames = json.load(f)

    resolved = _resolve_confidence_threshold(
        pitch_frames, args.confidence, args.confidence_percentile,
        args.confidence_floor, args.confidence_ceiling,
    )
    print(f"Порог confidence: {resolved:.3f}"
          + (" (адаптивный)" if args.confidence is None else " (задан вручную)"))

    notes = build_reference(
        pitch_frames,
        min_note_duration=args.min_duration,
        confidence_threshold=args.confidence,
        confidence_percentile=args.confidence_percentile,
        min_confidence_floor=args.confidence_floor,
        max_confidence_ceiling=args.confidence_ceiling,
        smoothing_window=args.smoothing_window,
        stable_frames=args.stable_frames,
        max_gap_sec=args.max_gap,
    )

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

    print(f"Построено {len(notes)} нот -> {args.output}")


if __name__ == "__main__":
    main()
