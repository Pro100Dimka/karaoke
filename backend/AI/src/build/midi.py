"""
Шаг 13 (доп.). Экспорт мелодии в MIDI.
reference.json -> melody.mid
"""

import argparse
import json

import pretty_midi

from src.common.notes import note_to_midi as _note_to_midi_fallback


def note_to_midi(note: str) -> int:
    """Совместимость со старым кодом: сначала pretty_midi (понимает и
    бемоли, напр. 'Db4'), при неудаче — общий разбор из src.common.notes."""
    try:
        return pretty_midi.note_name_to_number(note)
    except Exception:
        return _note_to_midi_fallback(note)


def quantize_notes(notes: list, bpm: float, first_beat: float = 0.0,
                    division: int = 16, strength: float = 0.5) -> list:
    """
    Привязывает старт/конец нот к ритмической сетке (по умолчанию к
    шестнадцатым долям), рассчитанной из BPM и времени первой доли.

    Без квантизации ноты стоят в "сыром" времени пения — на слух в
    MIDI-плеере/DAW это может звучать неряшливо, "не в такт", даже
    если реально певец пел почти точно. Полная (жёсткая) квантизация
    наоборот убивает живое ощущение и человеческий тайминг, поэтому
    strength — это доля сдвига к сетке (0.0 = не трогать, 1.0 = жёстко
    приклеить к сетке, 0.5 по умолчанию — сдвиг наполовину пути к сетке).
    """
    if not notes or bpm <= 0:
        return notes

    grid_step = (60.0 / bpm) / (division / 4)  # длительность одной доли сетки, сек

    def snap(t: float) -> float:
        rel = t - first_beat
        nearest = round(rel / grid_step) * grid_step
        snapped = first_beat + nearest
        return t + strength * (snapped - t)

    quantized = []
    for n in notes:
        new_start = snap(n["start"])
        new_end = snap(n["end"])
        if new_end <= new_start:
            new_end = new_start + max(0.05, n.get("duration", 0.05))
        q = dict(n)
        q["start"] = round(new_start, 3)
        q["end"] = round(new_end, 3)
        q["duration"] = round(new_end - new_start, 3)
        quantized.append(q)

    # после квантизации соседние ноты могут наложиться — разводим по времени
    quantized.sort(key=lambda n: n["start"])
    for i in range(len(quantized) - 1):
        if quantized[i]["end"] > quantized[i + 1]["start"]:
            quantized[i]["end"] = max(quantized[i]["start"] + 0.05, quantized[i + 1]["start"] - 0.001)
            quantized[i]["duration"] = round(quantized[i]["end"] - quantized[i]["start"], 3)

    return quantized


def build_midi(
    notes: list,
    instrument_name: str = "Voice Oohs",
    min_velocity: int = 40,
    max_velocity: int = 110,
    tempo: float = 120.0,
) -> pretty_midi.PrettyMIDI:

    midi = pretty_midi.PrettyMIDI(initial_tempo=tempo)

    program = pretty_midi.instrument_name_to_program(instrument_name)
    instrument = pretty_midi.Instrument(program=program, name="Vocal Melody")

    if not notes:
        midi.instruments.append(instrument)
        return midi

    # ---------------------------------
    # сортировка
    # ---------------------------------

    notes = sorted(notes, key=lambda n: n["start"])

    # ---------------------------------
    # объединение одинаковых нот
    # ---------------------------------

    merged = []

    MERGE_GAP = 0.05

    for note in notes:

        if not merged:
            merged.append(dict(note))
            continue

        last = merged[-1]

        if (
            last["note"] == note["note"]
            and note["start"] - last["end"] <= MERGE_GAP
            and not note.get("retrigger")
        ):

            last["end"] = max(last["end"], note["end"])
            last["duration"] = last["end"] - last["start"]

            last["confidence"] = max(
                last.get("confidence", 0.8),
                note.get("confidence", 0.8),
            )

        else:
            merged.append(dict(note))

    # ---------------------------------
    # экспорт
    # ---------------------------------

    MIN_LENGTH = 0.05

    for i, n in enumerate(merged):

        try:
            pitch = note_to_midi(n["note"])
        except Exception:
            continue

        if not (0 <= pitch <= 127):
            continue

        start = round(float(n["start"]), 3)
        end = round(float(n["end"]), 3)

        if end <= start:
            end = start + MIN_LENGTH

        confidence = max(0.0, min(1.0, n.get("confidence", 0.8)))

        # немного сглаживаем velocity
        velocity = int(
            min_velocity
            + (confidence ** 0.7)
            * (max_velocity - min_velocity)
        )

        velocity = max(1, min(127, velocity))

        # не допускаем наложения нот
        if i + 1 < len(merged):

            next_start = merged[i + 1]["start"]

            if end > next_start:

                end = max(
                    start + MIN_LENGTH,
                    next_start - 0.001,
                )

        instrument.notes.append(
            pretty_midi.Note(
                velocity=velocity,
                pitch=pitch,
                start=start,
                end=end,
            )
        )

    midi.instruments.append(instrument)
    print(f"MIDI notes: {len(instrument.notes)}")
    return midi


def add_tempo_and_key(midi: pretty_midi.PrettyMIDI, music_json_path: str | None):
    """Добавляет тональность как текстовую метку."""

    if not music_json_path:
        return

    with open(music_json_path, "r", encoding="utf-8") as f:
        music = json.load(f)

    key = music.get("key")

    if key:
        midi.lyrics.append(
            pretty_midi.Lyric(
                text=f"Key: {key}",
                time=0.0,
            )
        )


def main():
    parser = argparse.ArgumentParser(description="Экспорт эталонной мелодии в MIDI")
    parser.add_argument("input", help="reference.json")
    parser.add_argument("output", nargs="?", default="melody.mid")
    parser.add_argument(
        "--music",
        default=None,
        help="music.json (для темпа и тональности)"
    )
    parser.add_argument(
        "--instrument",
        default="Voice Oohs",
        help="название GM-инструмента (см. pretty_midi.INSTRUMENT_MAP)",
    )
    parser.add_argument("--quantize", action="store_true",
                         help="привязать ноты к ритмической сетке по BPM")
    parser.add_argument("--quantize-division", type=int, default=16,
                         help="доли сетки квантизации (16 = шестнадцатые)")
    parser.add_argument("--quantize-strength", type=float, default=0.5,
                         help="сила квантизации 0..1 (0=выкл, 1=жёстко к сетке)")

    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        notes = json.load(f)

    # --------------------------
    # Получаем темп ДО создания MIDI
    # --------------------------

    tempo = 120.0
    first_beat = 0.0

    if args.music:
        with open(args.music, "r", encoding="utf-8") as f:
            music = json.load(f)

        tempo = float(
            music.get("tempo")
            or music.get("bpm")
            or music.get("Tempo")
            or 120.0
        )
        first_beat = float(music.get("first_beat_sec", 0.0))

    print(f"Tempo: {tempo:.2f} BPM")

    if args.quantize:
        notes = quantize_notes(notes, tempo, first_beat,
                                division=args.quantize_division,
                                strength=args.quantize_strength)
        print(f"Квантизация применена: division=1/{args.quantize_division}, "
              f"strength={args.quantize_strength}")

    # --------------------------
    # Создаем MIDI уже с нужным темпом
    # --------------------------

    midi = build_midi(
        notes,
        instrument_name=args.instrument,
        tempo=tempo,
    )

    # Добавляем только тональность
    add_tempo_and_key(midi, args.music)

    midi.write(args.output)

    print(f"Сохранено {len(notes)} нот -> {args.output}")

if __name__ == "__main__":
    main()