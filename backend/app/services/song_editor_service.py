from __future__ import annotations

import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from AI.midi import write_midi
from AI.models import Syllable, VocalNote, Word
from app.utils.json_files import read_json, write_json


def _number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"{name} must be finite")
    return number


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid index") from exc


def _indices(value: Any, fallback: Any = None) -> list[int]:
    raw = value if isinstance(value, list) else ([fallback] if fallback is not None else [])
    result: list[int] = []
    for item in raw:
        parsed = _int_or_none(item)
        if parsed is not None and parsed not in result:
            result.append(parsed)
    return sorted(result)


def _normalize_note(raw: dict[str, Any], duration: float) -> dict[str, Any]:
    start = _number(raw.get("start"), "note.start")
    end = _number(raw.get("end"), "note.end")
    midi = int(round(_number(raw.get("midi_note", raw.get("midi")), "note.midi")))
    if start < 0 or end <= start:
        raise ValueError("Each note must have start >= 0 and end > start")
    if duration > 0 and end > duration + 0.05:
        raise ValueError("A note lies outside the song duration")
    if not 0 <= midi <= 127:
        raise ValueError("MIDI note must be between 0 and 127")
    velocity = int(raw.get("velocity") or 96)
    velocity = max(1, min(127, velocity))
    return {
        "start": round(start, 6),
        "end": round(end, 6),
        "midi_note": midi,
        "velocity": velocity,
        "word_index": _int_or_none(raw.get("word_index")),
        "syllable_index": _int_or_none(raw.get("syllable_index")),
        "syllable_indices": _indices(raw.get("syllable_indices"), raw.get("syllable_index")),
        "editor_text": str(raw.get("editor_text") or ""),
        "cents": [],
        "edited": True,
    }


def _words(song_map: dict[str, Any]) -> list[Word]:
    result: list[Word] = []
    for i, raw in enumerate(song_map.get("words") or []):
        if not isinstance(raw, dict):
            continue
        result.append(
            Word(
                float(raw.get("start") or 0.0),
                max(float(raw.get("start") or 0.0), float(raw.get("end") or 0.0)),
                str(raw.get("text") or raw.get("word") or "?").strip() or "?",
                max(0.0, min(1.0, float(raw.get("confidence") or 1.0))),
                int(raw.get("index", i)),
            )
        )
    return result


def _syllables(song_map: dict[str, Any]) -> list[Syllable]:
    result: list[Syllable] = []
    for i, raw in enumerate(song_map.get("syllables") or []):
        if not isinstance(raw, dict):
            continue
        result.append(
            Syllable(
                float(raw.get("start") or 0.0),
                max(float(raw.get("start") or 0.0), float(raw.get("end") or 0.0)),
                str(raw.get("text") or "?").strip() or "?",
                int(raw.get("word_index") or 0),
                int(raw.get("index", i)),
                max(0.0, min(1.0, float(raw.get("confidence") or 1.0))),
            )
        )
    return result


def _refresh_lines(song_map: dict[str, Any], notes: list[dict[str, Any]]) -> None:
    note_by_syllable: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for note in notes:
        indices = note.get("syllable_indices")
        if not isinstance(indices, list) or not indices:
            idx = note.get("syllable_index")
            indices = [] if idx is None else [idx]
        for idx in indices:
            try:
                note_by_syllable[int(idx)].append(note)
            except (TypeError, ValueError):
                continue

    syllable_lookup = {
        int(item.get("index", i)): dict(item)
        for i, item in enumerate(song_map.get("syllables") or [])
        if isinstance(item, dict)
    }
    words = [dict(item) for item in song_map.get("words") or [] if isinstance(item, dict)]
    word_lookup = {int(item.get("index", i)): item for i, item in enumerate(words)}
    for word in words:
        word["syllables"] = []

    for sid, syllable in syllable_lookup.items():
        linked = sorted(note_by_syllable.get(sid, []), key=lambda n: (n["start"], n["end"]))
        syllable["display_notes"] = [dict(n) for n in linked]
        if linked:
            syllable["start"] = min(n["start"] for n in linked)
            syllable["end"] = max(n["end"] for n in linked)
            syllable["timing_source"] = "editor_notes"
        raw_word_index = syllable.get("word_index")
        try:
            word_index = int(raw_word_index)
        except (TypeError, ValueError):
            word_index = -1
        word = word_lookup.get(word_index)
        if word is not None:
            word.setdefault("syllables", []).append(syllable)

    for word in words:
        linked = word.get("syllables") or []
        if linked:
            word["start"] = min(float(s["start"]) for s in linked)
            word["end"] = max(float(s["end"]) for s in linked)
            word["timing_source"] = "editor_syllables"

    song_map["syllables"] = [syllable_lookup[key] for key in sorted(syllable_lookup)]
    song_map["words"] = words

    updated_lines: list[dict[str, Any]] = []
    for line in song_map.get("lines") or []:
        if not isinstance(line, dict):
            continue
        clone = dict(line)
        line_words = []
        for old in line.get("words") or []:
            if not isinstance(old, dict):
                continue
            try:
                wi = int(old.get("index"))
            except (TypeError, ValueError):
                continue
            line_words.append(dict(word_lookup.get(wi, old)))
        clone["words"] = line_words
        if line_words:
            clone["start"] = min(float(w.get("start") or 0.0) for w in line_words)
            clone["end"] = max(float(w.get("end") or 0.0) for w in line_words)
        updated_lines.append(clone)
    song_map["lines"] = updated_lines


def load_editor(output_dir: Path) -> tuple[dict[str, Any], bool]:
    song_map = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict) or not isinstance(song_map.get("notes"), list):
        raise ValueError("songMap.json is not available")
    return song_map, (output_dir / "songMap.ai.json").exists()


def save_editor(output_dir: Path, raw_notes: list[dict[str, Any]]) -> dict[str, Any]:
    output_dir = Path(output_dir)
    song_map, _ = load_editor(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        shutil.copy2(output_dir / "songMap.json", backup)

    duration = float(song_map.get("duration") or 0.0)
    notes = [_normalize_note(item, duration) for item in raw_notes if isinstance(item, dict)]
    notes.sort(key=lambda n: (n["start"], n["end"], n["midi_note"]))
    song_map["notes"] = notes
    song_map["display_notes"] = [dict(note, display_source="editor") for note in notes]
    song_map["editor"] = {"edited": True, "source": "manual"}
    stats = dict(song_map.get("display_stats") or {})
    stats["game_note_count"] = len(notes)
    stats["display_note_count"] = len(notes)
    song_map["display_stats"] = stats
    _refresh_lines(song_map, notes)

    write_json(output_dir / "songMap.json", song_map)
    write_json(output_dir / "reference.json", {"notes": notes})

    midi_notes = [
        VocalNote(
            note["start"], note["end"], note["midi_note"], note["velocity"],
            note.get("word_index"), note.get("syllable_index"), ()
        )
        for note in notes
    ]
    if midi_notes:
        write_midi(
            output_dir / "game.mid",
            midi_notes,
            _words(song_map),
            _syllables(song_map),
            float(song_map.get("bpm") or 120.0),
            False,
        )

    manifest = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {"edited": True, "note_count": len(notes)}
        write_json(output_dir / "manifest.json", manifest)
    return song_map


def reset_editor(output_dir: Path) -> dict[str, Any]:
    output_dir = Path(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        raise ValueError("AI backup is not available")
    shutil.copy2(backup, output_dir / "songMap.json")
    song_map = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict):
        raise ValueError("AI backup is invalid")
    notes = song_map.get("notes") or []
    write_json(output_dir / "reference.json", {"notes": notes})
    midi_notes = [
        VocalNote(
            float(n["start"]), float(n["end"]), int(n.get("midi_note", n.get("midi"))),
            int(n.get("velocity") or 96), _int_or_none(n.get("word_index")),
            _int_or_none(n.get("syllable_index")), ()
        )
        for n in notes if isinstance(n, dict)
    ]
    if midi_notes:
        write_midi(output_dir / "game.mid", midi_notes, _words(song_map), _syllables(song_map), float(song_map.get("bpm") or 120.0), False)
    manifest = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {"edited": False, "restored_ai": True, "note_count": len(midi_notes)}
        write_json(output_dir / "manifest.json", manifest)
    return song_map
