from pathlib import Path

from app.services import song_editor_service
from app.utils.json_files import write_json


def _song_map():
    return {
        "duration": 10.0,
        "bpm": 120.0,
        "words": [{"start": 1.0, "end": 2.0, "text": "Привет", "confidence": 1.0, "index": 0}],
        "syllables": [{"start": 1.0, "end": 2.0, "text": "При", "word_index": 0, "index": 0, "confidence": 1.0}],
        "notes": [{"start": 1.0, "end": 2.0, "midi_note": 60, "velocity": 96, "word_index": 0, "syllable_index": 0, "cents": []}],
        "display_notes": [{"start": 1.0, "end": 2.0, "midi_note": 60, "velocity": 96, "word_index": 0, "syllable_index": 0, "cents": []}],
        "lines": [{"index": 0, "text": "Привет", "start": 1.0, "end": 2.0, "words": [{"start": 1.0, "end": 2.0, "text": "Привет", "confidence": 1.0, "index": 0}]}],
    }


def test_editor_save_updates_runtime_and_keeps_ai_backup(tmp_path: Path):
    write_json(tmp_path / "songMap.json", _song_map())
    write_json(tmp_path / "manifest.json", {"version": "test", "outputs": {}})

    result = song_editor_service.save_editor(
        tmp_path,
        [{"start": 1.2, "end": 2.4, "midi_note": 64, "word_index": 0, "syllable_index": 0}],
    )

    assert result["notes"][0]["midi_note"] == 64
    assert result["lines"][0]["words"][0]["start"] == 1.2
    assert result["syllables"][0]["start"] == 1.2
    assert (tmp_path / "songMap.ai.json").exists()
    assert (tmp_path / "game.mid").exists()


def test_editor_reset_restores_ai_song_map(tmp_path: Path):
    write_json(tmp_path / "songMap.json", _song_map())
    write_json(tmp_path / "manifest.json", {"version": "test", "outputs": {}})
    song_editor_service.save_editor(
        tmp_path,
        [{"start": 1.2, "end": 2.4, "midi_note": 64, "word_index": 0, "syllable_index": 0}],
    )

    result = song_editor_service.reset_editor(tmp_path)

    assert result["notes"][0]["midi_note"] == 60
    assert result["notes"][0]["start"] == 1.0


def test_editor_save_preserves_manual_note_text(tmp_path: Path):
    write_json(tmp_path / "songMap.json", _song_map())
    write_json(tmp_path / "manifest.json", {"version": "test", "outputs": {}})

    result = song_editor_service.save_editor(
        tmp_path,
        [{
            "start": 1.0,
            "end": 2.0,
            "midi_note": 60,
            "word_index": 0,
            "syllable_index": 0,
            "editor_text": "большой",
            "syllable_indices": [0],
        }],
    )

    assert result["notes"][0]["editor_text"] == "большой"
    assert result["display_notes"][0]["editor_text"] == "большой"
    assert result["notes"][0]["syllable_indices"] == [0]
