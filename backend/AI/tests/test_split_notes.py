"""
Тесты для syllabify.py и split_notes.py. Не требует librosa/torch —
только json+stdlib, как и test_reference.py.
"""

from src.build.split_notes import (
    align_note_boundaries_to_words,
    filter_unanchored_long_notes,
    fill_gaps_during_active_singing,
    split_notes_by_syllables,
)
from src.lyrics.syllabify import (
    build_syllable_spans,
    split_word_span_into_syllables,
    syllabify_word,
)


def _flat_loudness_frames(t0, t1, step=0.01, loudness=-6.0):
    frames = []
    t = t0
    while t < t1:
        frames.append({"time": round(t, 3), "loudness_db": loudness})
        t += step
    return frames


def _frames_with_dip(
    t0, t1, dip_center, dip_half_width=0.06, step=0.01, base_loudness=-6.0, dip_loudness=-15.0
):
    """Синтетические кадры pitch.json: ровная громкость с одним настоящим
    провалом вокруг dip_center (имитация согласной/повторной атаки)."""
    frames = _flat_loudness_frames(t0, t1, step, base_loudness)
    for f in frames:
        if abs(f["time"] - dip_center) <= dip_half_width:
            f["loudness_db"] = dip_loudness
    return frames


def test_syllabify_word_known_cases():
    assert syllabify_word("молоко") == ["мо", "ло", "ко"]
    assert syllabify_word("город") == ["го", "род"]
    assert syllabify_word("широкий") == ["ши", "ро", "кий"]
    assert syllabify_word("магистрали") == ["ма", "ги", "стра", "ли"]
    assert syllabify_word("дома") == ["до", "ма"]


def test_syllabify_word_no_vowels():
    assert syllabify_word("м") == ["м"]
    assert syllabify_word("") == []


def test_split_word_span_proportional():
    spans = split_word_span_into_syllables("дома", 10.0, 11.0)
    assert [s["text"] for s in spans] == ["до", "ма"]
    assert spans[0]["start"] == 10.0
    assert spans[-1]["end"] == 11.0
    # непрерывность: конец одного слога == начало следующего
    for a, b in zip(spans, spans[1:]):
        assert a["end"] == b["start"]


def test_build_syllable_spans_skips_lines_without_words():
    lines = [
        {"text": "без слов", "start": 0.0, "end": 1.0},  # нет "words" -> пропускается
        {
            "text": "город",
            "start": 1.0,
            "end": 2.0,
            "words": [{"word": "город", "start": 1.0, "end": 2.0}],
        },
    ]
    spans = build_syllable_spans(lines)
    assert [s["text"] for s in spans] == ["го", "род"]


def test_split_notes_by_syllables_prefers_real_word_boundaries():
    """
    Синтетика из жалобы пользователя: одна долгая нота G3 (0-3с), а на
    ней поётся "широкий город" (2 слова, 5 слогов) — должно получиться
    5 нот той же высоты, все кроме первой помечены retrigger.
    """
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [
        {
            "text": "широкий город",
            "start": 0.0,
            "end": 3.0,
            "words": [
                {"word": "широкий", "start": 0.0, "end": 1.5},
                {"word": "город", "start": 1.5, "end": 3.0},
            ],
        }
    ]
    split = split_notes_by_syllables(
        notes, lyrics_lines, min_segment_duration=0.1, retrigger_gap=0.02
    )

    assert len(split) == 2, f"expected two word-aligned notes, got {len(split)}: {split}"
    assert all(n["note"] == "G3" for n in split)
    assert split[0].get("retrigger") is not True
    assert all(n.get("retrigger") is True for n in split[1:])
    # ноты идут по возрастанию времени и не накладываются
    for a, b in zip(split, split[1:]):
        assert a["end"] <= b["start"]
    # первая и последняя нота начинаются/заканчиваются как исходная
    assert split[0]["start"] == 0.0
    assert split[-1]["end"] == 3.0


def test_split_notes_leaves_short_note_untouched():
    """Нота короче порога сегмента не должна дробиться даже при наличии слогов внутри."""
    notes = [{"note": "A4", "start": 0.0, "end": 0.15, "duration": 0.15, "confidence": 0.9}]
    lyrics_lines = [
        {
            "text": "да",
            "start": 0.0,
            "end": 0.15,
            "words": [{"word": "да", "start": 0.0, "end": 0.15}],
        }
    ]
    split = split_notes_by_syllables(
        notes, lyrics_lines, min_segment_duration=0.12, retrigger_gap=0.02
    )
    assert split == notes


def test_split_notes_is_idempotent():
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [
        {
            "text": "широкий город",
            "start": 0.0,
            "end": 3.0,
            "words": [
                {"word": "широкий", "start": 0.0, "end": 1.5},
                {"word": "город", "start": 1.5, "end": 3.0},
            ],
        }
    ]
    once = split_notes_by_syllables(notes, lyrics_lines)
    twice = split_notes_by_syllables(once, lyrics_lines)
    assert once == twice


def test_build_midi_does_not_remerge_retriggered_syllable_notes():
    """
    Регрессия: раньше build_midi склеивал соседние ноты одной высоты с
    маленьким зазором (< MERGE_GAP=0.05) — это ровно то, что производит
    split_notes.py, поэтому без флага "retrigger" разбиение по слогам
    сводилось бы на нет уже на экспорте в MIDI.
    """
    notes = [
        {"note": "G3", "start": 0.0, "end": 0.98, "duration": 0.98, "confidence": 0.8},
        {
            "note": "G3",
            "start": 1.0,
            "end": 1.98,
            "duration": 0.98,
            "confidence": 0.8,
            "retrigger": True,
        },
        {
            "note": "G3",
            "start": 2.0,
            "end": 2.98,
            "duration": 0.98,
            "confidence": 0.8,
            "retrigger": True,
        },
    ]
    try:
        from src.build.midi import build_midi
    except ImportError:
        print(
            "SKIP test_build_midi_does_not_remerge_retriggered_syllable_notes: pretty_midi не установлен"
        )
        return
    midi = build_midi(notes)
    assert len(midi.instruments[0].notes) == 3, "retrigger-ноты не должны склеиваться в одну"


def test_split_notes_acoustic_gate_splits_when_real_dip_present():
    """Есть настоящий провал громкости на границе слогов (0.06с уже, но
    заметно тише соседних пиков) -> ноту разбиваем, точка разреза
    снапается к самому провалу, а не к сырому таймингу Whisper (1.53,
    сдвинут на 30мс от реального провала на 1.5, как бывает у Whisper)."""
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [
        {
            "text": "молоко дома",
            "start": 0.0,
            "end": 3.0,
            "words": [
                {"word": "молоко", "start": 0.0, "end": 1.53},  # Whisper "неточен" тут
                {"word": "дома", "start": 1.53, "end": 3.0},
            ],
        }
    ]
    pitch_frames = _frames_with_dip(0.0, 3.0, dip_center=1.5)

    split = split_notes_by_syllables(
        notes, lyrics_lines, pitch_frames, min_segment_duration=0.3, retrigger_gap=0.02
    )

    assert len(split) == 2, f"ожидалось 2 ноты (один настоящий провал), получили: {split}"
    assert split[1].get("retrigger") is True
    # точка разреза должна быть у самого провала (~1.5), а не у тайминга Whisper (1.53)
    assert abs(split[0]["end"] - 1.5) < 0.05, f"разрез не снапнулся к провалу: {split[0]['end']}"


def test_split_notes_acoustic_gate_keeps_legato_note_whole():
    """Громкость ровная (легато, повторной атаки нет) -> нота НЕ должна
    разбиваться, даже если по тексту там граница слога/слова — иначе
    получилась бы придуманная пауза, которой нет в записи ('каша')."""
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [
        {
            "text": "молоко дома",
            "start": 0.0,
            "end": 3.0,
            "words": [
                {"word": "молоко", "start": 0.0, "end": 1.5},
                {"word": "дома", "start": 1.5, "end": 3.0},
            ],
        }
    ]
    pitch_frames = _flat_loudness_frames(0.0, 3.0)  # ни одного провала

    split = split_notes_by_syllables(
        notes, lyrics_lines, pitch_frames, min_segment_duration=0.3, retrigger_gap=0.02
    )

    assert len(split) == 1, f"легато не должно резаться без акустических доказательств: {split}"
    assert split == notes


def test_align_note_boundary_uses_real_pitch_change_when_legato():
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.12, "duration": 1.12},
        {"note": "A3", "start": 1.12, "end": 2.0, "duration": 0.88},
    ]
    lyrics = [
        {
            "text": "one two",
            "words": [
                {"word": "one", "start": 0.0, "end": 1.0},
                {"word": "two", "start": 1.0, "end": 2.0},
            ],
        }
    ]
    frames = []
    for index in range(201):
        time = round(index * 0.01, 2)
        frames.append(
            {
                "time": time,
                "loudness_db": -6.0,
                "f0_hz": 196.0 if time < 1.03 else 220.0,
                "confidence": 0.9,
            }
        )

    aligned = align_note_boundaries_to_words(notes, lyrics, frames)

    assert abs(aligned[0]["end"] - 1.03) < 0.03
    assert aligned[0]["end"] == aligned[1]["start"]


def test_fill_gaps_during_active_singing_fills_detector_dropout():
    """Провал МЕЖДУ нотами полностью приходится на активное пение по
    тексту, а сырые кадры pitch.json там всё-таки показывают высоту
    (просто с низким confidence, отсеянным build_reference) -> дыру
    нужно закрыть новой нотой с этой высотой и пониженным confidence."""
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.8},
        {"note": "A3", "start": 1.2, "end": 2.0, "duration": 0.8, "confidence": 0.8},
    ]
    lyrics_lines = [
        {
            "text": "город дома",
            "start": 0.0,
            "end": 2.0,
            "words": [{"word": "город дома", "start": 0.0, "end": 2.0}],  # поётся весь провал
        }
    ]
    pitch_frames = [
        {"time": round(t, 2), "note": "G#3"}  # ниже порога confidence, но высота была
        for t in [1.0, 1.05, 1.1, 1.15]
    ]

    filled = fill_gaps_during_active_singing(notes, lyrics_lines, pitch_frames)

    assert len(filled) == 3, f"ожидалась вставленная нота-заплатка: {filled}"
    patch = filled[1]
    assert patch["note"] == "G#3"
    assert patch.get("source") == "sustained_gap_recovery"
    assert patch["confidence"] < 0.5


def test_fill_gaps_during_active_singing_leaves_real_unvoiced_gap():
    """Провал без распознанной высоты в сырых кадрах (безголосая согласная
    внутри слова, например) — это не баг детектора, оставляем как есть."""
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.8},
        {"note": "A3", "start": 1.2, "end": 2.0, "duration": 0.8, "confidence": 0.8},
    ]
    lyrics_lines = [
        {
            "text": "город дома",
            "start": 0.0,
            "end": 2.0,
            "words": [{"word": "город дома", "start": 0.0, "end": 2.0}],
        }
    ]
    pitch_frames = [{"time": round(t, 2), "note": None} for t in [1.0, 1.05, 1.1, 1.15]]

    filled = fill_gaps_during_active_singing(notes, lyrics_lines, pitch_frames)
    assert filled == notes


def test_fill_gaps_during_active_singing_ignores_gap_during_real_pause():
    """Провал совпадает с реальной паузой по тексту (между строками, вне
    слов) — заполнять не нужно, даже если в сырых кадрах случайно
    мелькнула высота (шум/дыхание)."""
    notes = [
        {"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.8},
        {"note": "A3", "start": 1.2, "end": 2.0, "duration": 0.8, "confidence": 0.8},
    ]
    lyrics_lines = [
        {
            "text": "строка раз",
            "start": 0.0,
            "end": 1.0,
            "words": [{"word": "строка раз", "start": 0.0, "end": 1.0}],
        },
        # следующая строка начинается только в 1.2 — пауза 1.0-1.2 реальна
        {
            "text": "строка два",
            "start": 1.2,
            "end": 2.0,
            "words": [{"word": "строка два", "start": 1.2, "end": 2.0}],
        },
    ]
    pitch_frames = [{"time": round(t, 2), "note": "G#3"} for t in [1.0, 1.05, 1.1, 1.15]]

    filled = fill_gaps_during_active_singing(notes, lyrics_lines, pitch_frames)
    assert filled == notes


def test_filter_unanchored_long_notes_removes_tail_outside_words():
    notes = [
        {"note": "G3", "start": 0.0, "end": 0.45, "duration": 0.45},
        {"note": "A3", "start": 2.0, "end": 3.6, "duration": 1.6},
        {"note": "B3", "start": 4.0, "end": 5.3, "duration": 1.3},
    ]
    lyrics = [
        {
            "text": "one two",
            "words": [
                {"word": "one", "start": 0.0, "end": 0.45},
                {"word": "two", "start": 4.0, "end": 5.25},
            ],
        }
    ]

    filtered = filter_unanchored_long_notes(notes, lyrics)

    assert [note["note"] for note in filtered] == ["G3", "B3"]


def _run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"OK   {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    import sys

    sys.exit(1 if _run_all() else 0)
