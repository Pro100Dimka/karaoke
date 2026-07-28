"""
Шаг 13 (доп.). Экспорт мелодии в MIDI.
reference.json -> melody.mid
"""

import argparse
import json

import pretty_midi

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_to_midi(note: str) -> int:
    """Совместимость со старым кодом."""
    try:
        return pretty_midi.note_name_to_number(note)
    except Exception:
        if "#" in note:
            name, octave = note[:2], note[2:]
        else:
            name, octave = note[:1], note[1:]
        return NOTE_NAMES.index(name) + (int(octave) + 1) * 12


def build_midi(
    notes: list,
    instrument_name: str = "Voice Oohs",
    min_velocity: int = 40,
    max_velocity: int = 110,
) -> pretty_midi.PrettyMIDI:

    midi = pretty_midi.PrettyMIDI()

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
    """Опционально: проставить темп и тональность из music.json (шаг 4)."""

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
    parser.add_argument("--music", default=None, help="music.json (для тональности как маркера)")
    parser.add_argument(
        "--instrument",
        default="Voice Oohs",
        help="название GM-инструмента (см. pretty_midi.INSTRUMENT_MAP)",
    )

    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        notes = json.load(f)

    midi = build_midi(notes, instrument_name=args.instrument)

    add_tempo_and_key(midi, args.music)

    midi.write(args.output)
    print(f"Сохранено {len(notes)} нот -> {args.output}")


if __name__ == "__main__":
    main()