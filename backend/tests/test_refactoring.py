from pathlib import Path

import pytest

import config
import models
from app.services.analysis_service import ReferenceIndex, _sections_breakdown, _to_midi
from app.services.recording_service import resolve_recording_path


def test_reference_index_finds_active_note_and_gaps():
    index = ReferenceIndex.build([
        {"start": 2.0, "end": 3.0, "midi": 64},
        {"start": 0.0, "end": 1.0, "midi": 60},
    ])
    assert index.note_at(0.5) == 60
    assert index.note_at(1.5) is None
    assert index.note_at(2.5) == 64
    assert index.note_at(3.0) is None


def test_note_parser_handles_accidentals_and_invalid_values():
    assert _to_midi("C4") == 60
    assert _to_midi("C#4") == 61
    assert _to_midi("Db4") == 61
    assert _to_midi("invalid") is None


def test_sections_breakdown_uses_section_boundaries():
    result = _sections_breakdown(
        [{"name": "verse", "start": 0.0, "end": 2.0}],
        [
            {"time": 0.5, "deviation_semitones": 0.0},
            {"time": 1.5, "deviation_semitones": 1.0},
            {"time": 2.0, "deviation_semitones": 0.0},
        ],
    )
    assert result[0]["accuracy_percent"] == 50.0
    assert result[0]["mean_deviation_semitones"] == 0.5


def test_recording_path_cannot_escape_song_library(tmp_path, monkeypatch):
    library = tmp_path / "Song"
    library.mkdir()
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", library)
    recording = models.Recording(song_id="song", filename="take.wav", path=str(tmp_path / "x.wav"))
    with pytest.raises(ValueError, match="outside"):
        resolve_recording_path(recording)
