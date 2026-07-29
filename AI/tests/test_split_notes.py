"""
Тесты для syllabify.py и split_notes.py. Не требует librosa/torch —
только json+stdlib, как и test_reference.py.
"""
from src.lyrics.syllabify import syllabify_word, split_word_span_into_syllables, build_syllable_spans
from src.build.split_notes import split_notes_by_syllables


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
        {"text": "город", "start": 1.0, "end": 2.0,
         "words": [{"word": "город", "start": 1.0, "end": 2.0}]},
    ]
    spans = build_syllable_spans(lines)
    assert [s["text"] for s in spans] == ["го", "род"]


def test_split_notes_by_syllables_splits_long_note_on_multi_syllable_phrase():
    """
    Синтетика из жалобы пользователя: одна долгая нота G3 (0-3с), а на
    ней поётся "широкий город" (2 слова, 5 слогов) — должно получиться
    5 нот той же высоты, все кроме первой помечены retrigger.
    """
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [{
        "text": "широкий город", "start": 0.0, "end": 3.0,
        "words": [
            {"word": "широкий", "start": 0.0, "end": 1.5},
            {"word": "город", "start": 1.5, "end": 3.0},
        ],
    }]
    split = split_notes_by_syllables(notes, lyrics_lines, min_segment_duration=0.1, retrigger_gap=0.02)

    assert len(split) == 5, f"ожидалось 5 нот-слогов, получили {len(split)}: {split}"
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
    lyrics_lines = [{
        "text": "да", "start": 0.0, "end": 0.15,
        "words": [{"word": "да", "start": 0.0, "end": 0.15}],
    }]
    split = split_notes_by_syllables(notes, lyrics_lines, min_segment_duration=0.12, retrigger_gap=0.02)
    assert split == notes


def test_split_notes_is_idempotent():
    notes = [{"note": "G3", "start": 0.0, "end": 3.0, "duration": 3.0, "confidence": 0.8}]
    lyrics_lines = [{
        "text": "широкий город", "start": 0.0, "end": 3.0,
        "words": [
            {"word": "широкий", "start": 0.0, "end": 1.5},
            {"word": "город", "start": 1.5, "end": 3.0},
        ],
    }]
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
        {"note": "G3", "start": 1.0, "end": 1.98, "duration": 0.98, "confidence": 0.8, "retrigger": True},
        {"note": "G3", "start": 2.0, "end": 2.98, "duration": 0.98, "confidence": 0.8, "retrigger": True},
    ]
    try:
        from src.build.midi import build_midi
    except ImportError:
        print("SKIP test_build_midi_does_not_remerge_retriggered_syllable_notes: pretty_midi не установлен")
        return
    midi = build_midi(notes)
    assert len(midi.instruments[0].notes) == 3, "retrigger-ноты не должны склеиваться в одну"


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
