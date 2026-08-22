import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI.models import PitchFrame
from app.services import ai_bridge as bridge


def dump_json(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_process_song_forwards_the_request(monkeypatch, tmp_path):
    service = Mock()
    service.process_song.return_value = "result"
    monkeypatch.setattr(bridge, "get_ai_service", lambda: service)
    assert bridge.process_song(
        "source",
        tmp_path,
        language="ru",
        title="Song",
        bpm_override=120,
        key_override="C",
        processing_mode="fast",
    ) == "result"
    assert service.process_song.call_args.kwargs["source_path"] == "source"
    assert service.process_song.call_args.kwargs["processing_mode"] == "fast"


def test_reprocess_song_uses_existing_vocals(monkeypatch, tmp_path):
    service = Mock()
    service.reprocess_song.return_value = "result"
    monkeypatch.setattr(bridge, "get_ai_service", lambda: service)
    assert bridge.reprocess_song(tmp_path, language="uk") == "result"
    service.reprocess_song.assert_called_once_with(tmp_path, language="uk")


@pytest.mark.parametrize(
    "frame,expected",
    [
        (PitchFrame(0, 440, 0.8, True, 0.1), 69),
        (PitchFrame(0, 0, 0, False, 0), None),
    ],
)
def test_pitch_analysis_uses_the_analyzed_audio(monkeypatch, frame, expected):
    monkeypatch.setattr(
        bridge, "get_ai_service", lambda: SimpleNamespace(analyze_pitch=lambda _path: [frame])
    )
    assert bridge.analyze_vocal("vocals.flac")[0]["midi"] == expected


def test_reconcile_lyrics_preserves_the_supplied_order_and_values():
    lines = [
        {"text": "second", "start": 2.123456789, "end": 3.987654321, "words": []},
        {"text": "first", "start": 0.25, "end": 1.75, "words": []},
    ]
    result = bridge.reconcile_lyric_words(lines)
    assert result == lines and result is not lines


def test_karaoke_readers_return_only_canonical_artifacts(tmp_path):
    notes = [{"start": 64.77, "end": 65.03, "note": 64}]
    words = [{"index": 0, "text": "Пять", "start": 64.77, "end": 65.03, "notes": notes}]
    dump_json(tmp_path / "lyricsSync.json", {"bpm": 120, "key": "Am", "duration": 100, "words": words})

    assert bridge.get_karaoke_lyrics(tmp_path)["words"] == words
    projected = [{**notes[0], "word_index": 0}]
    assert bridge.get_vocal_notes(tmp_path) == projected
    assert bridge.get_game_notes(tmp_path) == projected
    assert bridge.get_reference_notes(tmp_path) == projected
    assert bridge.get_syllables(tmp_path) == []
    assert bridge.get_karaoke_timeline(tmp_path) == {
        "duration": 100,
        "words": words,
        "notes": projected,
    }


def test_karaoke_readers_reject_noncanonical_shapes(tmp_path):
    dump_json(tmp_path / "lyricsSync.json", [])
    assert bridge.get_karaoke_lyrics(tmp_path) == {}
    assert bridge.get_vocal_notes(tmp_path) == []
