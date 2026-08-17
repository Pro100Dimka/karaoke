from __future__ import annotations

import os
import shutil
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from AI.midi import write_midi
from AI.models import Syllable, VocalNote, Word
from app.services.artifact_integrity import refresh_manifest_integrity
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


def _project_notes_by_syllable(notes: list[JsonObject], syllables: list[JsonObject]) -> dict[int, list[JsonObject]]:
    """Project one acoustic/game note into non-overlapping display windows per linked syllable."""
    note_by_syllable: dict[int, list[JsonObject]] = defaultdict(list)
    for note in notes:
        indices = note.get("syllable_indices")
        if not isinstance(indices, list) or not indices:
            idx = note.get("syllable_index")
            indices = [] if idx is None else [idx]
        normalized = sorted({_safe_int(idx, -1) for idx in indices if _safe_int(idx, -1) >= 0})
        if not normalized:
            continue
        start, end = float(note["start"]), float(note["end"])
        cursor = start
        span = (end - start) / len(normalized)
        for pos, idx in enumerate(normalized):
            projected = dict(note)
            projected_end = end if pos == len(normalized) - 1 else start + span * (pos + 1)
            projected["start"] = round(cursor, 6)
            projected["end"] = round(max(cursor, projected_end), 6)
            projected["syllable_index"] = idx
            projected["syllable_indices"] = [idx]
            note_by_syllable[idx].append(projected)
            cursor = projected_end
    return note_by_syllable

def _refresh_lines(song_map: JsonObject, notes: list[JsonObject]) -> None:
    raw_syllables = [item for item in song_map.get("syllables") or [] if isinstance(item, dict)]
    note_by_syllable = _project_notes_by_syllable(notes, raw_syllables)

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
        if (linked_word := word_lookup.get(word_index)) is not None:
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


def _refresh_generated_note_associations(song_map: JsonObject) -> None:
    syllables = [item for item in song_map.get("syllables") or [] if isinstance(item, dict)]
    for field in ("notes", "display_notes"):
        for note in song_map.get(field) or []:
            if not isinstance(note, dict):
                continue
            start = float(note.get("start") or 0.0)
            end = float(note.get("end") or start)
            overlaps = [
                (
                    syllable,
                    min(end, float(syllable.get("end") or 0.0))
                    - max(start, float(syllable.get("start") or 0.0)),
                )
                for syllable in syllables
                if min(end, float(syllable.get("end") or 0.0))
                - max(start, float(syllable.get("start") or 0.0))
                > 1e-9
            ]
            overlap_by_word: dict[int, float] = defaultdict(float)
            for syllable, overlap in overlaps:
                overlap_by_word[_safe_int(syllable.get("word_index"), -1)] += overlap
            owner_word = max(overlap_by_word, key=lambda word: overlap_by_word[word]) if overlaps else None
            note["syllable_indices"] = [
                _safe_int(syllable.get("index"), index)
                for index, (syllable, _overlap) in enumerate(overlaps)
            ]
            note["syllable_index"] = (
                note["syllable_indices"][0] if note["syllable_indices"] else None
            )
            note["word_index"] = owner_word


def load_editor(output_dir: Path) -> tuple[JsonObject, bool]:
    song_map: Any = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict) or not isinstance(song_map.get("notes"), list):
        raise ValueError("songMap.json is not available")
    if isinstance(song_map.get("editor"), dict):
        _refresh_lines(song_map, list(song_map["notes"]))
    else:
        _refresh_generated_note_associations(song_map)
    return song_map, (output_dir / "songMap.ai.json").exists()


def normalize_editor_timeline(song_map: JsonObject) -> JsonObject:
    """Repair presentation timing in an edited SongMap without writing it."""
    if isinstance(song_map.get("editor"), dict) and isinstance(song_map.get("notes"), list):
        _refresh_lines(song_map, list(song_map["notes"]))
    else:
        _refresh_generated_note_associations(song_map)
    return song_map


def _write_editor_generation(staging: Path, song_map: JsonObject, notes: list[JsonObject], manifest: Any) -> None:
    write_json(staging / "songMap.json", song_map)
    write_json(staging / "reference.json", {"notes": notes})
    midi_notes = [
        VocalNote(float(note["start"]), float(note["end"]), _safe_int(note.get("midi_note", note.get("midi")), -1), _safe_int(note.get("velocity"), 96), _int_or_none(note.get("word_index")), _int_or_none(note.get("syllable_index")), ())
        for note in notes if isinstance(note, dict)
    ]
    if midi_notes:
        midi_path = staging / "game.mid"
        write_midi(midi_path, midi_notes, _words(song_map), _syllables(song_map), float(song_map.get("bpm") or 120.0), False)
        if not midi_path.is_file():
            raise OSError("MIDI writer did not produce game.mid")
    if isinstance(manifest, dict):
        refresh_manifest_integrity(
            staging, manifest, {"songMap.json", "reference.json", "game.mid"}, remove_missing=True
        )
        write_json(staging / "manifest.json", manifest)


def _publish_editor_generation(output_dir: Path, staging: Path, *, has_midi: bool, has_manifest: bool) -> None:
    names = ["songMap.json", "reference.json"] + (["game.mid"] if has_midi else []) + (["manifest.json"] if has_manifest else [])
    delete_names = [] if has_midi else ["game.mid"]
    rollback = Path(tempfile.mkdtemp(prefix="editor-rollback-", dir=output_dir))
    existed: dict[str, bool] = {}
    try:
        for name in names + delete_names:
            target = output_dir / name
            existed[name] = target.exists()
            if target.exists():
                shutil.copy2(target, rollback / name)
        for name in names:
            os.replace(staging / name, output_dir / name)
        for name in delete_names:
            (output_dir / name).unlink(missing_ok=True)
    except Exception:
        for name in names + delete_names:
            target = output_dir / name
            if existed.get(name):
                os.replace(rollback / name, target)
            else:
                target.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(rollback, ignore_errors=True)


def _stage_and_publish(
    output_dir: Path, song_map: JsonObject, notes: list[JsonObject], manifest: Any
) -> JsonObject:
    """Write a new editor generation to a scratch dir, then publish it atomically."""
    staging = Path(tempfile.mkdtemp(prefix="editor-stage-", dir=output_dir))
    try:
        _write_editor_generation(staging, song_map, notes, manifest)
        _publish_editor_generation(
            output_dir, staging, has_midi=bool(notes), has_manifest=isinstance(manifest, dict)
        )
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return song_map


def save_editor(output_dir: Path, raw_notes: list[JsonObject]) -> JsonObject:
    output_dir = Path(output_dir)
    song_map, _ = load_editor(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        shutil.copy2(output_dir / "songMap.json", backup)
    duration = float(song_map.get("duration") or 0.0)
    notes = sorted((_normalize_note(item, duration) for item in raw_notes), key=lambda n: (n["start"], n["end"], n["midi_note"]))
    song_map["notes"] = notes
    song_map["display_notes"] = [dict(note, display_source="editor") for note in notes]
    song_map["editor"] = {"edited": True, "source": "manual"}
    stats = dict(song_map.get("display_stats") or {})
    stats.update(game_note_count=len(notes), display_note_count=len(notes))
    song_map["display_stats"] = stats
    _refresh_lines(song_map, notes)
    manifest: Any = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {"edited": True, "note_count": len(notes)}
    return _stage_and_publish(output_dir, song_map, notes, manifest)


def reset_editor(output_dir: Path) -> JsonObject:
    output_dir = Path(output_dir)
    backup = output_dir / "songMap.ai.json"
    if not backup.exists():
        raise ValueError("AI backup is not available")
    song_map: Any = read_json(backup, default={})
    if not isinstance(song_map, dict):
        raise ValueError("AI backup is invalid")
    notes = song_map.get("notes") or []
    if not isinstance(notes, list):
        raise ValueError("AI backup notes are invalid")
    manifest: Any = read_json(output_dir / "manifest.json", default={})
    if isinstance(manifest, dict):
        manifest["manual_editor"] = {"edited": False, "restored_ai": True, "note_count": len(notes)}
    return _stage_and_publish(output_dir, song_map, notes, manifest)

