from __future__ import annotations

import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from AI.midi import write_midi
from AI.models import Syllable, VocalNote, Word
from app.utils.json_files import read_json, write_json

JsonObject = dict[str, Any]


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


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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
    velocity = int(round(_number(raw.get("velocity") or 96, "note.velocity")))
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


def _words(song_map: JsonObject) -> list[Word]:
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
                _safe_int(raw.get("index"), i),
            )
        )
    return result


def _syllables(song_map: JsonObject) -> list[Syllable]:
    result: list[Syllable] = []
    for i, raw in enumerate(song_map.get("syllables") or []):
        if not isinstance(raw, dict):
            continue
        result.append(
            Syllable(
                float(raw.get("start") or 0.0),
                max(float(raw.get("start") or 0.0), float(raw.get("end") or 0.0)),
                str(raw.get("text") or "?").strip() or "?",
                _safe_int(raw.get("word_index"), 0),
                _safe_int(raw.get("index"), i),
                max(0.0, min(1.0, float(raw.get("confidence") or 1.0))),
            )
        )
    return result


def _project_notes_by_syllable(
    notes: list[JsonObject],
) -> dict[int, list[JsonObject]]:
    note_by_syllable: dict[int, list[JsonObject]] = defaultdict(list)
    for note in notes:
        indices = note.get("syllable_indices")
        if not isinstance(indices, list) or not indices:
            idx = note.get("syllable_index")
            indices = [] if idx is None else [idx]
        normalized_indices = []
        for idx in indices:
            try:
                normalized_indices.append(int(idx))
            except (TypeError, ValueError):
                continue
        normalized_indices = sorted(set(normalized_indices))
        count = len(normalized_indices)
        for position, idx in enumerate(normalized_indices):
            projected = dict(note)
            if count > 1:
                start = float(note["start"])
                step = (float(note["end"]) - start) / count
                projected["start"] = round(start + position * step, 6)
                projected["end"] = round(start + (position + 1) * step, 6)
            projected["syllable_index"] = idx
            projected["syllable_indices"] = [idx]
            note_by_syllable[idx].append(projected)
    return note_by_syllable


def _refresh_lines(song_map: JsonObject, notes: list[JsonObject]) -> None:
    note_by_syllable = _project_notes_by_syllable(notes)

    syllable_lookup: dict[int, JsonObject] = {
        _safe_int(item.get("index"), i): dict(item)
        for i, item in enumerate(song_map.get("syllables") or [])
        if isinstance(item, dict)
    }
    words: list[JsonObject] = [
        dict(item) for item in song_map.get("words") or [] if isinstance(item, dict)
    ]
    word_lookup = {_safe_int(item.get("index"), i): item for i, item in enumerate(words)}
    for word_payload in words:
        word_payload["syllables"] = []

    for sid, syllable in syllable_lookup.items():
        linked = sorted(note_by_syllable.get(sid, []), key=lambda n: (n["start"], n["end"]))
        syllable["display_notes"] = [dict(n) for n in linked]
        syllable["timing_source"] = "syllable_alignment"
        word_index = _safe_int(syllable.get("word_index"), -1)
        linked_word = word_lookup.get(word_index)
        if linked_word is not None:
            linked_word.setdefault("syllables", []).append(syllable)

    for word_payload in words:
        word_payload["timing_source"] = "word_alignment"

    song_map["syllables"] = [syllable_lookup[key] for key in sorted(syllable_lookup)]
    song_map["words"] = words

    updated_lines: list[JsonObject] = []
    for line in song_map.get("lines") or []:
        if not isinstance(line, dict):
            continue
        clone = dict(line)
        line_words = []
        for old in line.get("words") or []:
            if not isinstance(old, dict):
                continue
            wi = _safe_int(old.get("index"), -1)
            if wi < 0:
                continue
            line_words.append(dict(word_lookup.get(wi, old)))
        clone["words"] = line_words
        if line_words:
            clone["start"] = min(float(w.get("start") or 0.0) for w in line_words)
            clone["end"] = max(float(w.get("end") or 0.0) for w in line_words)
        updated_lines.append(clone)
    song_map["lines"] = updated_lines


def load_editor(output_dir: Path) -> tuple[JsonObject, bool]:
    song_map: Any = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict) or not isinstance(song_map.get("notes"), list):
        raise ValueError("songMap.json is not available")
    if isinstance(song_map.get("editor"), dict):
        _refresh_lines(song_map, list(song_map["notes"]))
    return song_map, (output_dir / "songMap.ai.json").exists()


def normalize_editor_timeline(song_map: JsonObject) -> JsonObject:
    """Repair presentation timing in an edited SongMap without writing it."""
    if isinstance(song_map.get("editor"), dict) and isinstance(song_map.get("notes"), list):
        _refresh_lines(song_map, list(song_map["notes"]))
    return song_map


def save_editor(output_dir: Path, raw_notes: list[JsonObject]) -> JsonObject:
    output_dir = Path(output_dir)
    song_map, _ = load_editor(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        shutil.copy2(output_dir / "songMap.json", backup)

    duration = float(song_map.get("duration") or 0.0)
    notes: list[JsonObject] = [_normalize_note(item, duration) for item in raw_notes]
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
            note["start"],
            note["end"],
            note["midi_note"],
            note["velocity"],
            note.get("word_index"),
            note.get("syllable_index"),
            (),
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
    else:
        (output_dir / "game.mid").unlink(missing_ok=True)

    manifest: Any = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {"edited": True, "note_count": len(notes)}
        write_json(output_dir / "manifest.json", manifest)
    return song_map


def reset_editor(output_dir: Path) -> JsonObject:
    output_dir = Path(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        raise ValueError("AI backup is not available")
    shutil.copy2(backup, output_dir / "songMap.json")
    song_map: Any = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict):
        raise ValueError("AI backup is invalid")
    notes = song_map.get("notes") or []
    if not isinstance(notes, list):
        raise ValueError("AI backup notes are invalid")
    write_json(output_dir / "reference.json", {"notes": notes})
    midi_notes = [
        VocalNote(
            float(n["start"]),
            float(n["end"]),
            _safe_int(n.get("midi_note", n.get("midi")), -1),
            _safe_int(n.get("velocity"), 96),
            _int_or_none(n.get("word_index")),
            _int_or_none(n.get("syllable_index")),
            (),
        )
        for n in notes
        if isinstance(n, dict)
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
    else:
        (output_dir / "game.mid").unlink(missing_ok=True)
    manifest: Any = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {
            "edited": False,
            "restored_ai": True,
            "note_count": len(midi_notes),
        }
        write_json(output_dir / "manifest.json", manifest)
    return song_map
