"""
Шаг 9.5. Разбиение долгих нот по слогам текста.
reference.json + lyricsSync.json -> reference.json (обновлённый)

ПРОБЛЕМА: build_reference (src/build/reference.py) строит ноты только
из высоты голоса (pitch.json) — она не знает про текст. Если певец
держит одну и ту же высоту на протяжении целой фразы из нескольких
слов/слогов ("широкий город магистрали и дома" на одной ноте), это
становится ОДНОЙ длинной нотой в reference.json/MIDI, хотя на слух там
явно несколько слогов — то есть ритмическое движение мелодии теряется,
и в нотном/MIDI-представлении это выглядит как одна монотонная лежащая
нота вместо фразы.

РЕШЕНИЕ: используем word-level тайминги из lyricsSync.json (см.
src/lyrics/sync.py) и эвристическую слогоразбивку (src/lyrics/
syllabify.py), чтобы найти границы слогов ВНУТРИ каждой ноты, и
разбиваем ноту на несколько последовательных нот той же высоты — по
одной на слог. Между соседними "осколками" одной ноты вставляется
маленький зазор (retrigger_gap), чтобы в MIDI это были отдельные
note-on события, а не одна протянутая нота — иначе шаг склейки
одинаковых нот в build/midi.py (build_midi, MERGE_GAP=0.05) снова
слепит их в одну. Поэтому все ноты-осколки, кроме первой, помечаются
"retrigger": true — build_midi проверяет этот флаг и НЕ склеивает такую
ноту с предыдущей, даже если её высота совпадает и зазор мал (см.
исправление в build/midi.py).

ВАЖНО — что это НЕ делает: высота ноты не пересчитывается и не
проверяется по аудио заново (аудио тут вообще не участвует) — если
опорная нота была определена неверно, разбиение унаследует ту же
ошибку на все получившиеся осколки. Также деление внутри слова на
слоги — эвристика по буквам (см. syllabify.py), не forced-alignment;
границы слогов внутри слова приблизительные. Не проверено на реальном
аудио в этой среде (нет доступа к librosa/аудио) — покрыто модульным
тестом на синтетических данных (tests/test_split_notes.py).
"""
import argparse
import json

from src.lyrics.syllabify import build_syllable_spans


def split_notes_by_syllables(notes: list, lyrics_lines: list,
                              min_segment_duration: float = 0.12,
                              retrigger_gap: float = 0.02) -> list:
    """
    notes            — ноты из reference.json (start/end/note/confidence/...)
    lyrics_lines     — строки из lyricsSync.json (со словами и таймингами)
    min_segment_duration — минимальная длительность осколка ПОСЛЕ вычета
                       retrigger_gap; граница слога, которая дала бы более
                       короткий осколок, игнорируется (лучше оставить ноту
                       целой, чем породить неразличимо короткие обрывки)
    retrigger_gap    — тишина между осколками одной ноты, сек (должна быть
                       заметно меньше min_segment_duration и достаточной,
                       чтобы MIDI-плеер показал раздельные атаки)

    Идемпотентно: повторный вызов на уже разбитых нотах не найдёт новых
    внутренних границ (осколки уже короче порога) и вернёт список без
    изменений — можно безопасно перезапускать на одном проекте.
    """
    if not notes:
        return notes

    syllables = build_syllable_spans(lyrics_lines)
    if not syllables:
        return notes

    boundary_times = sorted({s["start"] for s in syllables})

    result = []
    for note in notes:
        start, end = note["start"], note["end"]
        # внутренние границы слогов: должны оставлять оба соседних
        # осколка не короче min_segment_duration (с учётом retrigger_gap)
        inner = [
            t for t in boundary_times
            if start + min_segment_duration <= t <= end - min_segment_duration
        ]
        if not inner:
            result.append(note)
            continue

        cut_points = [start] + inner + [end]
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


def main():
    parser = argparse.ArgumentParser(
        description="Разбивает долгие ноты reference.json на слоги по lyricsSync.json")
    parser.add_argument("reference", help="reference.json")
    parser.add_argument("lyrics_sync", help="lyricsSync.json")
    parser.add_argument("output", nargs="?", default=None,
                         help="куда сохранить (по умолчанию перезаписать reference.json)")
    parser.add_argument("--min-segment", type=float, default=0.12,
                         help="минимальная длительность осколка ноты, сек")
    parser.add_argument("--retrigger-gap", type=float, default=0.02,
                         help="зазор между осколками одной ноты, сек")
    args = parser.parse_args()

    with open(args.reference, "r", encoding="utf-8") as f:
        notes = json.load(f)
    with open(args.lyrics_sync, "r", encoding="utf-8") as f:
        lyrics_lines = json.load(f)

    before = len(notes)
    notes = split_notes_by_syllables(notes, lyrics_lines,
                                      min_segment_duration=args.min_segment,
                                      retrigger_gap=args.retrigger_gap)

    output = args.output or args.reference
    with open(output, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)

    print(f"Ноты: {before} -> {len(notes)} после разбиения по слогам -> {output}")


if __name__ == "__main__":
    main()
