"""
Шаг 9.5. Пост-обработка эталонной мелодии с учётом текста.
reference.json + lyricsSync.json + pitch.json -> reference.json (обновлённый)

Два независимых исправления:

1. fill_gaps_during_active_singing — закрывает провалы МЕЖДУ соседними
   нотами, если весь провал приходится на активное пение по тексту, а
   не на паузу. Причина провала не в тексте и не в слогах: build_reference
   (шаг 6) требует confidence выше адаптивного порога, и если голос в
   моменте чуть тише обычного (не смолк — именно чуть тише порога),
   кадр помечается "не voiced" и в мелодии образуется дыра, хотя по
   lyricsSync там явно поётся слово. Отличаем это от настоящей паузы
   через СЫРЫЕ кадры pitch.json (до отсечки по confidence, которую
   применяет build_reference) — см. докстринг функции.

2. split_notes_by_syllables — разбивает одну долгую ноту на несколько
   того же тона по слогам текста, но ТОЛЬКО там, где рядом с границей
   слога есть настоящий провал громкости (акустическое подтверждение
   повторной атаки/согласной) — иначе певец мог тянуть легато через
   несколько слогов без повторной атаки, и резать ноту там же означало
   бы придумывать паузу, которой в записи нет ("каша" в MIDI). Когда
   провал найден, точка разреза СНАПАЕТСЯ к нему, а не берётся из
   тайминга Whisper напрямую — тайминги Whisper на границах слов сами
   по себе неточны (см. src/lyrics/sync.py), поэтому склейка по чистому
   тексту давала слышимое запаздывание.

ВАЖНО: обе функции не переоценивают ВЫСОТУ по-новому там, где она уже
была определена уверенно — они только используют более полную картину
(сырые кадры) там, где основной пайплайн решил, что данных недостаточно,
и текст (lyricsSync) как независимый сигнал "тут точно не тишина".
Не проверено на реальном аудио в этой среде (нет доступа к librosa/
аудио) — покрыто модульными тестами на синтетических данных
(tests/test_split_notes.py).
"""
import argparse
import bisect
import json
from collections import Counter

from src.common.notes import note_to_midi
from src.lyrics.syllabify import build_syllable_spans


def _times_index(pitch_frames: list) -> list:
    return [f["time"] for f in pitch_frames]


def _frames_in_range(pitch_frames: list, times_index: list, t0: float, t1: float) -> list:
    lo = bisect.bisect_left(times_index, t0)
    hi = bisect.bisect_right(times_index, t1)
    return pitch_frames[lo:hi]


def _active_singing_spans(lyrics_lines: list) -> list:
    """Объединённые (слитые) интервалы активного пения по lyricsSync.json.
    Использует word-level тайминги, если есть; иначе — тайминги всей строки
    (грубее, но лучше, чем ничего, для строк без word-level данных)."""
    spans = []
    for line in lyrics_lines or []:
        words = line.get("words") or []
        if words:
            for w in words:
                if w.get("start") is not None and w.get("end") is not None:
                    spans.append((float(w["start"]), float(w["end"])))
        elif line.get("start") is not None and line.get("end") is not None:
            spans.append((float(line["start"]), float(line["end"])))
    spans.sort()
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def _fully_covered_by_singing(active_spans: list, t0: float, t1: float) -> bool:
    """True, если весь интервал [t0, t1] покрыт объединением активных
    отрезков пения (без непокрытых промежутков внутри)."""
    if t1 <= t0 or not active_spans:
        return False
    starts = [s for s, _ in active_spans]
    idx = max(0, bisect.bisect_right(starts, t0) - 1)
    cur = t0
    for s, e in active_spans[idx:]:
        if e <= cur:
            continue
        if s > cur:
            return False
        cur = max(cur, e)
        if cur >= t1:
            return True
    return cur >= t1


def fill_gaps_during_active_singing(notes: list, lyrics_lines: list, pitch_frames: list,
                                     max_gap_duration: float = 0.75,
                                     min_voiced_ratio: float = 0.50,
                                     min_restored_duration: float = 0.14,
                                     min_dominant_ratio: float = 0.50,
                                     fill_confidence: float = 0.3) -> list:
    """
    max_gap_duration — провалы длиннее этого не трогаем (это уже, скорее
                        всего, настоящая пауза/вдох, не дыра детектора)
    min_voiced_ratio  — какая доля сырых кадров провала должна иметь
                        распознанную высоту (без учёта confidence), чтобы
                        считать это дырой детектора, а не безголосой
                        согласной (к/т/п и т.п. внутри слова — там высоты
                        объективно нет, и это НЕ баг)
    fill_confidence   — confidence, с которым помечается восстановленная
                        нота (сознательно ниже обычного, чтобы был виден
                        источник — эвристика, а не прямое измерение)
    """
    if not notes or len(notes) < 2 or not pitch_frames:
        return notes

    active_spans = _active_singing_spans(lyrics_lines)
    if not active_spans:
        return notes
    times_index = _times_index(pitch_frames)

    result = [dict(notes[0])]
    for nxt in notes[1:]:
        prev = result[-1]
        gap_start, gap_end = prev["end"], nxt["start"]
        gap_dur = gap_end - gap_start
        if 0 < gap_dur <= max_gap_duration and _fully_covered_by_singing(active_spans, gap_start, gap_end):
            frames = _frames_in_range(pitch_frames, times_index, gap_start, gap_end)
            note_votes = [f["note"] for f in frames if f.get("note")]
            if frames and (len(note_votes) / len(frames)) >= min_voiced_ratio:
                fill_note_name, dominant_votes = Counter(note_votes).most_common(1)[0]
                # A raw frame in a gap is not strong enough evidence for a new
                # note: it is often consonant noise, reverb, or a pYIN octave
                # error. Bridge only a sustained note confirmed on both sides.
                if (
                    prev["note"] == nxt["note"] == fill_note_name
                ):
                    prev["end"] = nxt["end"]
                    prev["duration"] = round(prev["end"] - prev["start"], 3)
                    prev["confidence"] = max(
                        prev.get("confidence", fill_confidence),
                        nxt.get("confidence", fill_confidence),
                    )
                    continue
                # Restore a missing voiced syllable only when raw pYIN keeps
                # one pitch for a meaningful part of the gap.  This is much
                # stricter than the old "one raw frame = a note" heuristic:
                # it brings back quiet vocal phrases but not consonants,
                # reverb tails or tiny octave glitches.
                if (
                    gap_dur >= min_restored_duration
                    and dominant_votes / len(note_votes) >= min_dominant_ratio
                ):
                    candidate_midi = note_to_midi(fill_note_name)
                    neighbor_distance = min(
                        abs(candidate_midi - note_to_midi(prev["note"])),
                        abs(candidate_midi - note_to_midi(nxt["note"])),
                    )
                    stable_ratio = dominant_votes / len(note_votes)
                    # A recovered pitch that continues a neighbouring note
                    # (or moves just a semitone) is safe at the normal gate.
                    # A completely new pitch needs substantially stronger
                    # evidence; otherwise pYIN octave/noise artefacts become
                    # visible as extra notes in the karaoke guide.
                    context_confirmed = neighbor_distance <= 1
                    independently_confirmed = (
                        gap_dur >= 0.22 and stable_ratio >= 0.68
                    )
                    if context_confirmed or independently_confirmed:
                        result.append({
                            "note": fill_note_name,
                            "start": round(gap_start, 3),
                            "end": round(gap_end, 3),
                            "duration": round(gap_dur, 3),
                            "confidence": round(fill_confidence, 3),
                            "source": "sustained_gap_recovery",
                        })
        result.append(dict(nxt))
    return result


def _find_acoustic_split_point(pitch_frames: list, times_index: list, candidate_time: float,
                                lo_bound: float, hi_bound: float,
                                search_window: float = 0.15,
                                dip_margin_db: float = 2.5):
    """
    Ищет настоящий провал громкости рядом с candidate_time (тайминг слога
    из Whisper) в пределах [lo_bound, hi_bound] — то есть акустическое
    подтверждение повторной атаки/согласной между слогами. Возвращает
    время провала или None, если провала нет (вероятно, легато — резать
    тут не нужно).

    Провал считается настоящим, если он тише ОБОИХ окружающих локальных
    пиков минимум на dip_margin_db — просто "тише предыдущего кадра"
    недостаточно, нужен именно провал с обеих сторон.
    """
    lo = max(lo_bound, candidate_time - search_window)
    hi = min(hi_bound, candidate_time + search_window)
    if hi <= lo:
        return None
    frames = _frames_in_range(pitch_frames, times_index, lo, hi)
    loud = [(f["time"], f["loudness_db"]) for f in frames if f.get("loudness_db") is not None]
    if len(loud) < 3:
        return None

    min_v = min(v for _, v in loud)
    tied_times = sorted(t for t, v in loud if v == min_v)
    min_t = tied_times[len(tied_times) // 2]
    left_peak = max((v for t, v in loud if t <= min_t), default=None)
    right_peak = max((v for t, v in loud if t >= min_t), default=None)
    if left_peak is None or right_peak is None:
        return None
    if (left_peak - min_v) >= dip_margin_db and (right_peak - min_v) >= dip_margin_db:
        return min_t
    return None


def split_notes_by_syllables(notes: list, lyrics_lines: list, pitch_frames: list = None,
                              min_segment_duration: float = 0.12,
                              retrigger_gap: float = 0.02,
                              acoustic_search_window: float = 0.15,
                              acoustic_dip_margin_db: float = 2.5) -> list:
    """
    pitch_frames — если передан, граница слога разбивает ноту, ТОЛЬКО
                   если рядом (± acoustic_search_window) есть настоящий
                   провал громкости (см. _find_acoustic_split_point), и
                   точка разреза сдвигается к этому провалу. Если None —
                   старое поведение "на слово" (резать по каждой границе
                   слога вслепую), оставлено для обратной совместимости,
                   но даёт худшее совпадение с реальным пением.

    Идемпотентно: повторный вызов на уже разбитых нотах не найдёт новых
    внутренних границ (осколки уже короче порога) и вернёт список без
    изменений — можно безопасно перезапускать на одном проекте.
    """
    if not notes:
        return notes

    # Word starts come from forced alignment and describe the user's visible
    # lyric rhythm.  Prefer them over estimated intra-word syllable timings;
    # the latter are only a fallback when word timings are unavailable.
    word_boundaries = sorted({
        float(word["start"])
        for line in lyrics_lines or []
        for word in line.get("words", []) or []
        if word.get("start") is not None
    })
    syllables = build_syllable_spans(lyrics_lines)
    if not word_boundaries and not syllables:
        return notes

    boundary_times = word_boundaries or sorted({s["start"] for s in syllables})
    times_index = _times_index(pitch_frames) if pitch_frames else None

    result = []
    for note in notes:
        start, end = note["start"], note["end"]
        candidates = [
            t for t in boundary_times
            if start + min_segment_duration <= t <= end - min_segment_duration
        ]

        cut_points_inner = []
        for t in candidates:
            actual_t = t
            if pitch_frames:
                found = _find_acoustic_split_point(
                    pitch_frames, times_index, t, start, end,
                    acoustic_search_window, acoustic_dip_margin_db)
                if found is None:
                    continue  # нет провала громкости — вероятно легато, не режем
                actual_t = found
            if not (start + min_segment_duration <= actual_t <= end - min_segment_duration):
                continue
            if cut_points_inner and actual_t - cut_points_inner[-1] < min_segment_duration:
                continue
            cut_points_inner.append(actual_t)

        if not cut_points_inner:
            result.append(note)
            continue

        cut_points = [start] + cut_points_inner + [end]
        for i in range(len(cut_points) - 1):
            seg_start = cut_points[i]
            seg_end = cut_points[i + 1]
            if i < len(cut_points) - 2:
                seg_end = max(seg_start + 0.01, seg_end - retrigger_gap)
            seg = dict(note)
            seg["start"] = round(seg_start, 3)
            seg["end"] = round(seg_end, 3)
            seg["duration"] = round(seg_end - seg_start, 3)
            if i > 0:
                seg["retrigger"] = True
            result.append(seg)

    result.sort(key=lambda n: n["start"])
    return result


def align_note_boundaries_to_words(notes: list, lyrics_lines: list, pitch_frames: list,
                                   word_window: float = 0.18,
                                   max_snap_distance: float = 0.14,
                                   min_note_duration: float = 0.10) -> list:
    """Snap existing note transitions to real word attacks when audio agrees.

    Word timings provide the intended rhythm, while the loudness dip in the
    separated vocal is the evidence that a new attack actually occurred.  We
    therefore never create, remove or retune notes here; only an already
    detected boundary may move by a small amount.
    """
    if len(notes) < 2 or not pitch_frames:
        return notes

    word_starts = sorted({
        float(word["start"])
        for line in lyrics_lines or []
        for word in line.get("words", []) or []
        if word.get("start") is not None
    })
    if not word_starts:
        return notes

    result = [dict(note) for note in notes]
    times_index = _times_index(pitch_frames)
    for index in range(len(result) - 1):
        left, right = result[index], result[index + 1]
        boundary = (left["end"] + right["start"]) / 2
        nearby = min(word_starts, key=lambda start: abs(start - boundary))
        if abs(nearby - boundary) > word_window:
            continue

        lo = left["start"] + min_note_duration
        hi = right["end"] - min_note_duration
        snapped = _find_acoustic_split_point(
            pitch_frames, times_index, nearby, lo, hi,
            search_window=word_window, dip_margin_db=2.0,
        )
        if snapped is None or abs(snapped - boundary) > max_snap_distance:
            continue
        if snapped - left["start"] < min_note_duration or right["end"] - snapped < min_note_duration:
            continue

        left["end"] = round(snapped, 3)
        left["duration"] = round(left["end"] - left["start"], 3)
        right["start"] = round(snapped, 3)
        right["duration"] = round(right["end"] - right["start"], 3)

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Дозаполняет пробелы и разбивает долгие ноты reference.json по слогам")
    parser.add_argument("reference", help="reference.json")
    parser.add_argument("lyrics_sync", help="lyricsSync.json")
    parser.add_argument("--pitch", default=None,
                         help="pitch.json (нужен для заполнения пробелов и "
                              "акустической проверки границ слогов; без него — "
                              "старое поведение 'режем по каждой границе слога вслепую')")
    parser.add_argument("output", nargs="?", default=None,
                         help="куда сохранить (по умолчанию перезаписать reference.json)")
    parser.add_argument("--min-segment", type=float, default=0.12,
                         help="минимальная длительность осколка ноты, сек")
    parser.add_argument("--retrigger-gap", type=float, default=0.02,
                         help="зазор между осколками одной ноты, сек")
    parser.add_argument("--max-gap-fill", type=float, default=0.35,
                         help="максимальная длина пробела, который можно заполнить, сек")
    args = parser.parse_args()

    with open(args.reference, encoding="utf-8") as f:
        notes = json.load(f)
    with open(args.lyrics_sync, encoding="utf-8") as f:
        lyrics_lines = json.load(f)
    pitch_frames = None
    if args.pitch:
        with open(args.pitch, encoding="utf-8") as f:
            pitch_frames = json.load(f)

    before = len(notes)
    if pitch_frames:
        notes = fill_gaps_during_active_singing(notes, lyrics_lines, pitch_frames,
                                                  max_gap_duration=args.max_gap_fill)
    notes = split_notes_by_syllables(notes, lyrics_lines, pitch_frames,
                                      min_segment_duration=args.min_segment,
                                      retrigger_gap=args.retrigger_gap)

    output = args.output or args.reference
    with open(output, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

    print(f"Ноты: {before} -> {len(notes)} после дозаполнения/разбиения -> {output}")


if __name__ == "__main__":
    main()
