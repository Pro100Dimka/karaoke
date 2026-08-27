
from __future__ import annotations

import bisect
import json
import statistics
from dataclasses import dataclass
from typing import Any

import models
from app.services import ai_bridge, song_service
from app.utils.json_files import read_json

_HIT_TOLERANCE_SEMITONES = 0.5
_HOLD_TOLERANCE_SEMITONES = 1.0
_RHYTHM_WINDOW_SECONDS = 0.35
_NOTE_OFFSETS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _overall_score(pitch: float, rhythm: float, hold: float, coverage: float) -> float:
    return round(pitch * 0.50 + rhythm * 0.25 + hold * 0.15 + coverage * 0.10, 1)


def _playback_segments(recording: models.Recording) -> list[dict[str, float]]:
    raw = getattr(recording, "playback_segments_json", None)
    if not raw: return []
    try:
        values = json.loads(raw)
    except (TypeError, ValueError):
        return []
    segments = []
    for value in values if isinstance(values, list) else []:
        try:
            start = float(value["start_recording_sec"])
            end = float(value["end_recording_sec"])
            playback = float(value["start_playback_sec"])
        except (KeyError, TypeError, ValueError):
            continue
        if start >= 0 and end > start:
            segments.append({
                "start_recording_sec": start,
                "end_recording_sec": end,
                "start_playback_sec": playback,
            })
    return sorted(segments, key=lambda segment: segment["start_recording_sec"])


def _song_time_for_recording_frame(
    timestamp: float,
    segments: list[dict[str, float]],
    fallback_offset: float,
) -> float | None:
    if not segments: return timestamp + fallback_offset
    for segment in segments:
        start, end = segment["start_recording_sec"], segment["end_recording_sec"]
        if start <= timestamp <= end:
            return segment["start_playback_sec"] + timestamp - start
    return None


@dataclass(frozen=True, slots=True)
class ReferenceIndex:
    starts: tuple[float, ...]
    notes: tuple[tuple[float, int | None], ...]

    @classmethod
    def build(cls, reference_notes: list[dict[str, Any]]) -> ReferenceIndex:
        normalized = sorted(reference_notes, key=lambda note: float(note.get("start", 0.0)))
        return cls(
            starts=tuple(float(note.get("start", 0.0)) for note in normalized),
            notes=tuple(
                (
                    float(note.get("end", note.get("start", 0.0))),
                    _to_midi(note.get("note")),
                )
                for note in normalized
            ),
        )

    def note_at(self, timestamp: float) -> int | None:
        index = bisect.bisect_right(self.starts, timestamp) - 1
        if index < 0: return None
        end, midi = self.notes[index]
        return midi if timestamp < end else None


def _to_midi(value: object) -> int | None:
    if isinstance(value, (int, float)): return int(round(value))
    if not isinstance(value, str): return None

    value = value.strip()
    if len(value) < 2 or value[0].upper() not in _NOTE_OFFSETS: return None

    letter, accidental = value[0].upper(), value[1] if len(value) > 1 and value[1] in {'#', 'b'} else ''
    octave_text = value[2:] if accidental else value[1:]
    try:
        octave = int(octave_text)
    except ValueError:
        return None

    accidental_offset = 1 if accidental == "#" else -1 if accidental == "b" else 0
    return (octave + 1) * 12 + _NOTE_OFFSETS[letter] + accidental_offset


def _normalized_reference_notes(reference_notes: list[dict[str, Any]]) -> list[dict[str, float | int]]:
    normalized = []
    for note in reference_notes:
        start, end, midi = note.get("start"), note.get("end"), _to_midi(note.get("note"))
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or midi is None:
            continue
        if float(end) <= float(start): continue
        normalized.append({"start": float(start), "end": float(end), "midi": midi})
    return sorted(normalized, key=lambda note: note["start"])


def _singing_metrics(
    reference_notes: list[dict[str, float | int]],
    voiced_frames: list[tuple[float, int]],
    deviations: list[float],
    pitch_accuracy: float | None,
) -> dict[str, float | None]:
    if pitch_accuracy is None or not voiced_frames or not reference_notes:
        return {
            "rhythm_accuracy_percent": None,
            "note_hold_percent": None,
            "note_coverage_percent": None,
            "overall_score_percent": None,
        }

    voiced_frames.sort(key=lambda frame: frame[0])
    times = [frame[0] for frame in voiced_frames]
    covered, rhythm_scores = 0, []
    for note in reference_notes:
        start, end, target = float(note["start"]), float(note["end"]), int(note["midi"])
        note_left = bisect.bisect_left(times, start)
        note_right = bisect.bisect_left(times, end, lo=note_left)
        if note_right > note_left: covered += 1

        search_left = bisect.bisect_left(times, start - _RHYTHM_WINDOW_SECONDS)
        search_right = bisect.bisect_right(times, start + _RHYTHM_WINDOW_SECONDS, lo=search_left)
        matching = [
            abs(timestamp - start)
            for timestamp, midi in voiced_frames[search_left:search_right]
            if abs(midi - target) <= _HOLD_TOLERANCE_SEMITONES
        ]
        timing_error = min(matching) if matching else _RHYTHM_WINDOW_SECONDS
        rhythm_scores.append(max(0.0, 1.0 - timing_error / _RHYTHM_WINDOW_SECONDS) * 100)

    rhythm = round(statistics.fmean(rhythm_scores), 1)
    hold = round(
        sum(value <= _HOLD_TOLERANCE_SEMITONES for value in deviations) / len(deviations) * 100,
        1,
    )
    coverage = round(covered / len(reference_notes) * 100, 1)
    overall = _overall_score(pitch_accuracy, rhythm, hold, coverage)
    return {
        "rhythm_accuracy_percent": rhythm,
        "note_hold_percent": hold,
        "note_coverage_percent": coverage,
        "overall_score_percent": overall,
    }


def analyze_recording(recording: models.Recording, song: models.Song) -> dict[str, Any]:
    if not song.output_dir: raise ValueError("Песня ещё не обработана — нет эталонной мелодии для сравнения")

    output_dir = song_service.resolve_output_dir(song)
    reference_notes, structure = ai_bridge.get_reference_notes(output_dir), read_json(output_dir / 'structure.json')
    if not reference_notes: raise ValueError("Не найдены вокальные ноты — мелодия ещё не построена")

    normalized_reference = _normalized_reference_notes(reference_notes)
    reference_index, pitch_frames = ReferenceIndex.build(reference_notes), ai_bridge.analyze_vocal(recording.path)
    deviations: list[float] = []
    frames: list[dict[str, float]] = []
    voiced_frames: list[tuple[float, int]] = []
    hits = 0

    playback_offset_sec = float(getattr(recording, "playback_offset_sec", 0) or 0)
    playback_segments = _playback_segments(recording)
    for frame in pitch_frames:
        timestamp = frame.get("time")
        user_midi = _to_midi(frame.get("midi") or frame.get("note"))
        if not isinstance(timestamp, (int, float)) or user_midi is None: continue
        # Map take time through the exact play/pause/seek segments captured by
        # the recorder. Legacy takes without segments retain offset behaviour.
        song_time = _song_time_for_recording_frame(
            float(timestamp), playback_segments, playback_offset_sec
        )
        if song_time is None: continue
        voiced_frames.append((song_time, user_midi))
        reference_midi = reference_index.note_at(song_time)
        if reference_midi is None: continue
        deviation = abs(user_midi - reference_midi)
        deviations.append(deviation)
        frames.append({"time": song_time, "deviation_semitones": deviation})
        hits += deviation <= _HIT_TOLERANCE_SEMITONES

    accuracy, mean_deviation, sections = round(hits / len(deviations) * 100, 1) if deviations else None, round(statistics.fmean(deviations), 3) if deviations else None, _sections_breakdown(structure, frames) if isinstance(structure, list) else None
    return {
        "pitch_accuracy_percent": accuracy,
        "mean_deviation_semitones": mean_deviation,
        **_singing_metrics(normalized_reference, voiced_frames, deviations, accuracy),
        "sections": sections,
    }


def _sections_breakdown(structure: list[dict], frames: list[dict[str, float]]) -> list[dict]:
    result: list[dict] = []
    times = [frame["time"] for frame in frames]
    for section in structure:
        start, end = section.get("start"), section.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)): continue
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
