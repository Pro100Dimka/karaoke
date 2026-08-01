"""Optional high-accuracy singing melody extraction via the GAME ONNX engine."""

from __future__ import annotations

import json
import os
from pathlib import Path

from src.analyze.game_onnx import extract
from src.common.model_paths import game_model_dir
from src.common.notes import midi_to_note, note_to_midi


def _backend_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _model_dir() -> Path:
    return game_model_dir()


def _merge_sustained_notes(notes: list[dict]) -> list[dict]:
    """Collapse model-internal frames while preserving real pitch changes."""
    if not notes:
        return notes
    merged = [dict(notes[0])]
    for note in notes[1:]:
        previous = merged[-1]
        if note["note"] == previous["note"] and note["start"] - previous["end"] <= 0.04:
            previous["end"] = note["end"]
            previous["duration"] = round(previous["end"] - previous["start"], 3)
        else:
            merged.append(dict(note))
    return merged


def _remove_transient_outliers(notes: list[dict]) -> list[dict]:
    """Remove a very short pitch glitch only when both neighbours agree."""
    result = [dict(note) for note in notes]
    changed = True
    while changed:
        changed = False
        for index in range(1, len(result) - 1):
            left, current, right = result[index - 1:index + 2]
            if current["duration"] > 0.24:
                continue
            left_pitch = note_to_midi(left["note"])
            current_pitch = note_to_midi(current["note"])
            right_pitch = note_to_midi(right["note"])
            if (
                abs(left_pitch - right_pitch) <= 1
                and abs(current_pitch - left_pitch) >= 3
                and abs(current_pitch - right_pitch) >= 3
            ):
                left["end"] = current["end"]
                left["duration"] = round(left["end"] - left["start"], 3)
                del result[index]
                changed = True
                break
    return _merge_sustained_notes(result)


def extract_game_reference(
    vocals_path: str,
    output_dir: str | Path,
    language: str | None = None,
) -> list[dict] | None:
    """Return GAME notes or ``None`` when the optional engine cannot run.

    ``SONGAPP_MIDI_ENGINE=pyin`` disables GAME explicitly. ``auto`` uses the
    bundled engine whenever its model is present.
    """
    engine = os.getenv("SONGAPP_MIDI_ENGINE", "auto").strip().lower()
    if engine == "pyin":
        return None

    model_dir = _model_dir()
    if not (model_dir / "config.json").exists():
        if engine == "game":
            print("GAME requested but its local model is not installed; using pYIN.")
        return None

    raw_path = Path(output_dir) / "game_notes.json"
    if not raw_path.exists():
        try:
            payload = extract(vocals_path, model_dir, language)
            raw_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            print(f"GAME melody extraction: {len(payload['notes'])} notes")
        except Exception as exc:
            print(f"GAME melody extraction failed; using pYIN. {exc}")
            return None

    try:
        payload = json.loads(raw_path.read_text(encoding="utf-8"))
        raw_notes = payload["notes"]
        notes = [
            {
                "note": midi_to_note(int(item["note"])),
                "start": round(float(item["start"]), 3),
                "end": round(float(item["end"]), 3),
                "duration": round(float(item["end"]) - float(item["start"]), 3),
                "confidence": 1.0,
            }
            for item in raw_notes
            if float(item["end"]) > float(item["start"])
        ]
        notes = _remove_transient_outliers(_merge_sustained_notes(notes))
        if not notes:
            raise ValueError("the engine returned no voiced notes")
        print(f"GAME melody accepted: {len(notes)} notes ({payload.get('provider', 'unknown')}).")
        return notes
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Invalid GAME result; using pYIN. {exc}")
        return None
