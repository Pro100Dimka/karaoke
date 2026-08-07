"""
Тесты для build/midi.py — квантизация нот под ритм-сетку.
Требует pretty_midi (для импорта модуля, хотя тестируем чистую функцию).
"""

from src.build.midi import quantize_notes


def test_quantize_notes_snaps_toward_grid():
    # BPM=120 -> одна доля = 0.5 сек, 16-я доля = 0.125 сек
    notes = [{"note": "G3", "start": 0.51, "end": 1.02, "duration": 0.51, "confidence": 0.8}]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, division=16, strength=1.0)
    # 0.51 должно притянуться к ближайшей 1/16 (0.5), 1.02 -> 1.0
    assert abs(quantized[0]["start"] - 0.5) < 1e-6
    assert abs(quantized[0]["end"] - 1.0) < 1e-6


def test_quantize_notes_zero_strength_is_noop():
    notes = [{"note": "G3", "start": 0.51, "end": 1.02, "duration": 0.51, "confidence": 0.8}]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, strength=0.0)
    assert quantized[0]["start"] == 0.51
    assert quantized[0]["end"] == 1.02


def test_quantize_notes_no_overlap_after_snapping():
    notes = [
        {"note": "G3", "start": 0.0, "end": 0.49, "duration": 0.49, "confidence": 0.8},
        {"note": "A3", "start": 0.50, "end": 0.99, "duration": 0.49, "confidence": 0.8},
    ]
    quantized = quantize_notes(notes, bpm=120.0, first_beat=0.0, strength=1.0)
    assert quantized[0]["end"] <= quantized[1]["start"]


def test_quantize_notes_empty_or_invalid_bpm():
    assert quantize_notes([], bpm=120.0) == []
    notes = [{"note": "G3", "start": 0.0, "end": 1.0, "duration": 1.0}]
    assert quantize_notes(notes, bpm=0) == notes


def test_vocal_midi_retriggers_at_word_boundaries_and_adds_lyrics():
    from src.build.midi import build_vocal_midi
    frames = []
    for i in range(100):
        t = i * 0.01
        frames.append({"time": t, "f0_hz": 220.0 if t < 0.5 else 246.94,
                       "voiced": True, "confidence": 0.9})
    lyrics = [{"words": [
        {"word": "ла", "start": 0.0, "end": 0.5},
        {"word": "ла", "start": 0.5, "end": 1.0},
    ]}]
    midi = build_vocal_midi(frames, lyrics)
    assert len(midi.instruments[0].notes) >= 2
    assert [lyric.text for lyric in midi.lyrics] == ["ла", "ла"]
    assert abs(midi.instruments[0].notes[1].start - 0.5) < 0.02


def test_vocal_midi_contains_pitch_bend_for_vibrato():
    import math
    from src.build.midi import build_vocal_midi
    frames = [{"time": i * 0.01,
               "f0_hz": 220.0 * 2 ** ((0.3 * math.sin(i / 4)) / 12),
               "voiced": True, "confidence": 0.9} for i in range(60)]
    lyrics = [{"words": [{"word": "аа", "start": 0.0, "end": 0.6}]}]
    midi = build_vocal_midi(frames, lyrics)
    assert midi.instruments[0].pitch_bends
    assert any(pb.pitch != 0 for pb in midi.instruments[0].pitch_bends)


def test_vocal_midi_writes_cyrillic_lyrics_as_utf8(tmp_path):
    from src.build.midi import build_vocal_midi, decode_midi_utf8_text
    import pretty_midi

    frames = [
        {"time": i * 0.01, "f0_hz": 220.0, "voiced": True, "confidence": 0.9}
        for i in range(40)
    ]
    lyrics = [{"words": [{"word": "Привіт", "start": 0.0, "end": 0.4}]}]
    path = tmp_path / "unicode.mid"

    build_vocal_midi(frames, lyrics).write(str(path))

    raw = path.read_bytes()
    assert "Привіт".encode("utf-8") in raw
    loaded = pretty_midi.PrettyMIDI(str(path))
    assert decode_midi_utf8_text(loaded.lyrics[0].text) == "Привіт"
