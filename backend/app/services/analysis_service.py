"""Compare a recorded vocal take with the generated reference melody."""

from __future__ import annotations

import bisect
import statistics
from dataclasses import dataclass
from typing import Any

import models
from app.services import ai_bridge, song_service
from app.utils.json_files import read_json

_HIT_TOLERANCE_SEMITONES = 0.5
_NOTE_OFFSETS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass(frozen=True, slots=True)
class ReferenceIndex:
    starts: tuple[float, ...]
    notes: tuple[tuple[float, int | None], ...]

    @classmethod
    def build(cls, reference_notes: list[dict[str, Any]]) -> "ReferenceIndex":
        normalized = sorted(reference_notes, key=lambda note: float(note.get("start", 0.0)))
        return cls(
            starts=tuple(float(note.get("start", 0.0)) for note in normalized),
            notes=tuple(
                (
                    float(note.get("end", note.get("start", 0.0))),
                    _to_midi(note.get("midi") or note.get("pitch") or note.get("note")),
                )
                for note in normalized
            ),
        )

    def note_at(self, timestamp: float) -> int | None:
        index = bisect.bisect_right(self.starts, timestamp) - 1
        if index < 0:
            return None
        end, midi = self.notes[index]
        return midi if timestamp < end else None


def _to_midi(value: object) -> int | None:
    if isinstance(value, (int, float)):
        return int(round(value))
    if not isinstance(value, str):
        return None

    value = value.strip()
    if len(value) < 2 or value[0].upper() not in _NOTE_OFFSETS:
        return None

    letter = value[0].upper()
    accidental = value[1] if len(value) > 1 and value[1] in {"#", "b"} else ""
    octave_text = value[2:] if accidental else value[1:]
    try:
        octave = int(octave_text)
    except ValueError:
        return None

    accidental_offset = 1 if accidental == "#" else -1 if accidental == "b" else 0
    return (octave + 1) * 12 + _NOTE_OFFSETS[letter] + accidental_offset


def analyze_recording(recording: models.Recording, song: models.Song) -> dict[str, Any]:
    if not song.output_dir:
        raise ValueError("Песня ещё не обработана — нет эталонной мелодии для сравнения")

    output_dir = song_service.resolve_output_dir(song)
    reference_notes = ai_bridge.get_reference_notes(output_dir)
    structure = read_json(output_dir / "structure.json")
    if not reference_notes:
        raise ValueError("Не найден reference.json — эталонная мелодия ещё не построена")

    reference_index = ReferenceIndex.build(reference_notes)
    pitch_frames = ai_bridge.get_analyze_vocal()(recording.path)
    deviations: list[float] = []
    frames: list[dict[str, float]] = []
    hits = 0

    for frame in pitch_frames:
        timestamp = frame.get("time")
        user_midi = _to_midi(frame.get("midi") or frame.get("note"))
        if not isinstance(timestamp, (int, float)) or user_midi is None:
            continue
        reference_midi = reference_index.note_at(float(timestamp))
        if reference_midi is None:
            continue
        deviation = abs(user_midi - reference_midi)
        deviations.append(deviation)
        frames.append({"time": float(timestamp), "deviation_semitones": deviation})
        hits += deviation <= _HIT_TOLERANCE_SEMITONES

    accuracy = round(hits / len(deviations) * 100, 1) if deviations else None
    mean_deviation = round(statistics.fmean(deviations), 3) if deviations else None
    sections = _sections_breakdown(structure, frames) if isinstance(structure, list) else None
    return {
        "pitch_accuracy_percent": accuracy,
        "mean_deviation_semitones": mean_deviation,
        "sections": sections,
    }


def _sections_breakdown(structure: list[dict], frames: list[dict[str, float]]) -> list[dict]:
    result: list[dict] = []
    times = [frame["time"] for frame in frames]
    for section in structure:
        start, end = section.get("start"), section.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        left = bisect.bisect_left(times, float(start))
        right = bisect.bisect_left(times, float(end), lo=left)
        deviations = [frame["deviation_semitones"] for frame in frames[left:right]]
        result.append(
            {
                "label": section.get("label", section.get("name")),
                "start": start,
                "end": end,
                "accuracy_percent": (
                    round(
                        sum(value <= _HIT_TOLERANCE_SEMITONES for value in deviations)
                        / len(deviations)
                        * 100,
                        1,
                    )
                    if deviations
                    else None
                ),
                "mean_deviation_semitones": (
                    round(statistics.fmean(deviations), 3) if deviations else None
                ),
            }
        )
    return result
