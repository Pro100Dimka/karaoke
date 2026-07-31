"""
Общие хелперы для работы с нотами/MIDI-номерами.

Раньше NOTE_NAMES/note_to_midi/midi_to_note были продублированы (с мелкими
расхождениями в реализации note_to_midi) сразу в трёх местах:
src/build/midi.py, src/build/reference.py, src/evaluation/difficulty_map.py.
Вынесены сюда как единственный источник истины.

Специально БЕЗ импорта pretty_midi: это чистая математика над строками
вида 'C#4' / 'A3' / 'C#-1', которые сам пайплайн генерирует внутри —
внешняя библиотека тут не нужна, а reference.py/difficulty_map.py должны
оставаться лёгкими (тяжёлый pretty_midi нужен только на шаге экспорта
в .mid — см. src/build/midi.py).
"""

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_to_midi(note: str) -> int:
    """'C#4' -> 61, 'A3' -> 57, 'C#-1' -> 1 и т.п."""
    if "#" in note:
        name, octave = note[:2], note[2:]
    else:
        name, octave = note[:1], note[1:]
    return NOTE_NAMES.index(name) + (int(octave) + 1) * 12


def midi_to_note(m: int) -> str:
    """61 -> 'C#4' и т.п."""
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"
