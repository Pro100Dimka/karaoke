"""
Шаг 13 (доп.). Экспорт мелодии в MIDI.
reference.json -> melody.mid
"""

import argparse
import json

import pretty_midi
from src.common.notes import note_to_midi as _note_to_midi_fallback





def _midi_utf8_text(text: str) -> str:
    """Encode Unicode as a latin-1-safe proxy carrying UTF-8 bytes."""
    return str(text or "").encode("utf-8").decode("latin-1")


def decode_midi_utf8_text(text: str) -> str:
    """Decode UTF-8 bytes exposed as latin-1 text by MIDI libraries."""
    try:
        return str(text).encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return str(text)


class UnicodePrettyMIDI(pretty_midi.PrettyMIDI):
    """PrettyMIDI writer that preserves Unicode lyric events as UTF-8 bytes.

    The in-memory API keeps normal Unicode strings.  Only during serialization
    are lyric/text payloads converted to a latin-1-safe proxy because
    pretty_midi itself hardcodes latin-1 for MIDI meta events.
    """

    def write(self, filename):
        original_lyrics = [lyric.text for lyric in self.lyrics]
        original_markers = [marker.text for marker in self.text_events]
        try:
            for lyric in self.lyrics:
                lyric.text = _midi_utf8_text(lyric.text)
            for marker in self.text_events:
                marker.text = _midi_utf8_text(marker.text)
            return super().write(filename)
        finally:
            for lyric, text in zip(self.lyrics, original_lyrics):
                lyric.text = text
            for marker, text in zip(self.text_events, original_markers):
                marker.text = text

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

    midi = UnicodePrettyMIDI(initial_tempo=tempo)

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

    with open(music_json_path, encoding="utf-8") as f:
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

    with open(args.input, encoding="utf-8") as f:
        notes = json.load(f)

    # --------------------------
    # Получаем темп ДО создания MIDI
    # --------------------------

    tempo = 120.0
    first_beat = 0.0

    if args.music:
        with open(args.music, encoding="utf-8") as f:
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

def _flatten_words(lyrics_sync: list[dict]) -> list[dict]:
    words = []
    for line_index, line in enumerate(lyrics_sync or []):
        for word_index, word in enumerate(line.get("words") or []):
            text = str(word.get("word") or "").strip()
            start, end = word.get("start"), word.get("end")
            if not text or start is None or end is None or float(end) <= float(start):
                continue
            words.append({
                "text": text,
                "start": float(start),
                "end": float(end),
                "line_index": line_index,
                "word_index": word_index,
            })
    return sorted(words, key=lambda item: item["start"])


def _midi_float(freq: float) -> float:
    import math
    return 69.0 + 12.0 * math.log2(freq / 440.0)


def build_vocal_midi(
    pitch_frames: list[dict],
    lyrics_sync: list[dict],
    *,
    tempo: float = 120.0,
    instrument_name: str = "Voice Oohs",
    pitch_bend_range: float = 2.0,
) -> pretty_midi.PrettyMIDI:
    """Build a MIDI transcription that follows the sung voice itself.

    Unlike :func:`build_midi`, this function does not quantize or merge the
    lyric structure.  Word boundaries create explicit retriggers, while pitch
    changes inside a word create additional notes.  Pitch-bend events preserve
    vibrato, slides and intonation between semitones.
    """
    import math
    import statistics

    midi = UnicodePrettyMIDI(initial_tempo=tempo)
    program = pretty_midi.instrument_name_to_program(instrument_name)
    instrument = pretty_midi.Instrument(program=program, name="Vocal transcription")
    frames = [f for f in pitch_frames or [] if f.get("f0_hz") and f.get("voiced", True)]
    words = _flatten_words(lyrics_sync)
    if not frames:
        midi.instruments.append(instrument)
        return midi

    # Use lyric timing where available; otherwise one global span.
    spans = words or [{"text": "", "start": frames[0]["time"], "end": frames[-1]["time"] + 0.01}]
    for word in spans:
        start, end = float(word["start"]), float(word["end"])
        local = [f for f in frames if start <= float(f["time"]) < end]
        if not local:
            continue
        midi.lyrics.append(pretty_midi.Lyric(text=word["text"], time=start))

        # Convert to continuous MIDI pitch and lightly median-filter only tiny
        # one-frame jitter; real transitions and ornamentation stay intact.
        values = [_midi_float(float(f["f0_hz"])) for f in local]
        smooth = values[:]
        for i in range(1, len(values) - 1):
            med = statistics.median(values[i - 1:i + 2])
            if abs(values[i] - med) < 0.75:
                smooth[i] = med

        # Split only after a pitch change persists for at least 3 frames.
        segments = []
        seg_start = 0
        current = round(statistics.median(smooth[:min(5, len(smooth))]))
        candidate = None
        candidate_start = None
        for i, value in enumerate(smooth):
            rounded = int(round(value))
            if abs(rounded - current) >= 1:
                if candidate == rounded:
                    if i - candidate_start + 1 >= 3:
                        cut = candidate_start
                        if cut > seg_start:
                            segments.append((seg_start, cut, current))
                        seg_start = cut
                        current = rounded
                        candidate = None
                        candidate_start = None
                else:
                    candidate = rounded
                    candidate_start = i
            else:
                candidate = None
                candidate_start = None
        segments.append((seg_start, len(local), current))

        for seg_i, (a, b, base_pitch) in enumerate(segments):
            if b <= a:
                continue
            note_start = max(start, float(local[a]["time"]))
            note_end = end if b == len(local) else float(local[b]["time"])
            if note_end - note_start < 0.025:
                continue
            confidences = [float(f.get("confidence", 0.7)) for f in local[a:b]]
            velocity = int(max(30, min(120, 45 + 70 * statistics.median(confidences))))
            instrument.notes.append(pretty_midi.Note(
                velocity=velocity,
                pitch=max(0, min(127, int(base_pitch))),
                start=note_start,
                end=note_end,
            ))
            # Preserve the detailed contour as pitch bend around the note.
            last_bend = None
            for frame, value in zip(local[a:b], smooth[a:b]):
                semitones = value - base_pitch
                bend = int(round(max(-8191, min(8191, semitones / pitch_bend_range * 8192))))
                if last_bend is None or abs(bend - last_bend) >= 32:
                    instrument.pitch_bends.append(pretty_midi.PitchBend(bend, float(frame["time"])))
                    last_bend = bend
            instrument.pitch_bends.append(pretty_midi.PitchBend(0, note_end))

    instrument.notes.sort(key=lambda n: (n.start, n.end))
    # Enforce monophony without deleting word retriggers.
    for left, right in zip(instrument.notes, instrument.notes[1:]):
        if left.end > right.start:
            left.end = max(left.start + 0.01, right.start - 0.001)
    midi.instruments.append(instrument)
    return midi
