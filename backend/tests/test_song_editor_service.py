import json
from unittest.mock import Mock

import pytest

from app.services import song_editor_service
from app.utils.json_files import write_json


@pytest.mark.parametrize("value", [None, "bad"])
def test_number_rejects_non_numeric(value):
    with pytest.raises(ValueError, match="number"):
        song_editor_service._number(value, "value")


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_number_rejects_non_finite(value):
    with pytest.raises(ValueError, match="finite"):
        song_editor_service._number(value, "value")


def test_integer_and_index_helpers_are_stable():
    assert song_editor_service._number("1.5", "value") == 1.5
    assert song_editor_service._int_or_none(None) is None
    assert song_editor_service._int_or_none("") is None
    assert song_editor_service._int_or_none("2") == 2
    with pytest.raises(ValueError, match="index"):
        song_editor_service._int_or_none("bad")
    assert song_editor_service._safe_int("bad", 4) == 4
    assert song_editor_service._indices([2, "1", 2, None]) == [1, 2]
    assert song_editor_service._indices(None, "3") == [3]
    assert song_editor_service._indices(None) == []


def test_note_normalization_clamps_velocity_and_links_indices():
    note = song_editor_service._normalize_note(
        {
            "start": "1",
            "end": 2,
            "midi": 60.6,
            "velocity": 999,
            "word_index": "4",
            "syllable_index": "2",
            "syllable_indices": [3, 2],
            "editor_text": "la",
        },
        3,
    )
    assert note | {"midi_note": 61, "velocity": 127} == note
    assert note["syllable_indices"] == [2, 3]
    assert note["cents"] == [] and note["edited"] is True

    invalid = [
        ({"start": -1, "end": 1, "midi": 60}, "start"),
        ({"start": 1, "end": 1, "midi": 60}, "start"),
        ({"start": 0, "end": 4, "midi": 60}, "outside"),
        ({"start": 0, "end": 1, "midi": 128}, "MIDI"),
    ]
    for payload, message in invalid:
        with pytest.raises(ValueError, match=message):
            song_editor_service._normalize_note(payload, 3)


def test_words_and_syllables_filter_invalid_items_and_clamp_values():
    payload = {
        "words": [
            None,
            {"start": 2, "end": 1, "text": " ", "confidence": 2, "index": "bad"},
        ],
        "syllables": [
            "bad",
            {
                "start": 2,
                "end": 1,
                "text": " ",
                "confidence": -1,
                "word_index": "bad",
                "index": "bad",
            },
        ],
    }
    words = song_editor_service._words(payload)
    syllables = song_editor_service._syllables(payload)
    assert len(words) == len(syllables) == 1
    assert words[0].text == "?" and words[0].end == 2 and words[0].confidence == 1
    assert syllables[0].text == "?" and syllables[0].end == 2 and syllables[0].confidence == 0


def test_refresh_lines_ignores_invalid_links_and_line_entries():
    song_map = {
        "syllables": [
            None,
            {"index": 0, "word_index": 0, "start": 0, "end": 1, "text": "a"},
            {"index": 1, "word_index": 99, "start": 0.5, "end": 1.5, "text": "b"},
        ],
        "words": [None, {"index": 0, "start": 0, "end": 1, "text": "ab"}],
        "lines": [
            None,
            {"words": [None, {"index": -1}, {"index": 0}]},
            {"words": []},
        ],
    }
    notes = [
        {"start": 0, "end": 1, "syllable_indices": "bad", "syllable_index": "bad"},
        {"start": 0, "end": 1.5, "syllable_indices": [0, "bad", 1]},
    ]
    song_editor_service._refresh_lines(song_map, notes)
    assert len(song_map["syllables"]) == 2
    assert song_map["words"][0]["syllables"]
    assert len(song_map["lines"]) == 2
    assert song_map["lines"][0]["words"][0]["index"] == 0


def base_song_map():
    return {
        "duration": 5,
        "bpm": 120,
        "notes": [],
        "words": [{"index": 0, "start": 0, "end": 1, "text": "la"}],
        "syllables": [{"index": 0, "word_index": 0, "start": 0, "end": 1, "text": "la"}],
        "lines": [{"words": [{"index": 0}]}],
        "display_stats": {"old": True},
    }


def test_load_and_normalize_editor_validate_contract(tmp_path):
    with pytest.raises(ValueError, match="not available"):
        song_editor_service.load_editor(tmp_path)
    write_json(tmp_path / "songMap.json", [])
    with pytest.raises(ValueError, match="not available"):
        song_editor_service.load_editor(tmp_path)
    payload = base_song_map()
    payload["editor"] = {"edited": True}
    write_json(tmp_path / "songMap.json", payload)
    loaded, backup = song_editor_service.load_editor(tmp_path)
    assert loaded["notes"] == [] and backup is False
    untouched = {"notes": []}
    assert song_editor_service.normalize_editor_timeline(untouched) is untouched


def test_save_editor_creates_backup_json_midi_manifest_and_empty_cleanup(monkeypatch, tmp_path):
    write_json(tmp_path / "songMap.json", base_song_map())
    write_json(tmp_path / "manifest.json", {"existing": True})
    midi = Mock()
    monkeypatch.setattr(song_editor_service, "write_midi", midi)
    notes = [
        {
            "start": 1,
            "end": 2,
            "midi_note": 62,
            "word_index": 0,
            "syllable_index": 0,
        },
        {
            "start": 0,
            "end": 1,
            "midi_note": 60,
            "word_index": 0,
            "syllable_index": 0,
        },
    ]
    saved = song_editor_service.save_editor(tmp_path, notes)
    assert [note["midi_note"] for note in saved["notes"]] == [60, 62]
    assert (tmp_path / "songMap.ai.json").exists()
    assert json.loads((tmp_path / "reference.json").read_text(encoding="utf-8"))["notes"]
    assert (
        json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))["manual_editor"][
            "note_count"
        ]
        == 2
    )
    midi.assert_called_once()

    (tmp_path / "game.mid").write_bytes(b"old")
    write_json(tmp_path / "manifest.json", [])
    song_editor_service.save_editor(tmp_path, [])
    assert not (tmp_path / "game.mid").exists()


def test_reset_editor_validates_backup_and_rebuilds_outputs(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="not available"):
        song_editor_service.reset_editor(tmp_path)
    backup = tmp_path / "songMap.ai.json"
    write_json(backup, [])
    with pytest.raises(ValueError, match="invalid"):
        song_editor_service.reset_editor(tmp_path)
    write_json(backup, {"notes": "bad"})
    with pytest.raises(ValueError, match="notes"):
        song_editor_service.reset_editor(tmp_path)

    payload = base_song_map()
    payload["notes"] = [
        {
            "start": 0,
            "end": 1,
            "midi_note": 60,
            "velocity": 90,
            "word_index": 0,
            "syllable_index": 0,
        },
        "ignored",
    ]
    write_json(backup, payload)
    write_json(tmp_path / "manifest.json", {})
    midi = Mock()
    monkeypatch.setattr(song_editor_service, "write_midi", midi)
    restored = song_editor_service.reset_editor(tmp_path)
    assert restored["notes"] == payload["notes"]
    midi.assert_called_once()
    assert (
        json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))["manual_editor"][
            "restored_ai"
        ]
        is True
    )

    payload["notes"] = []
    write_json(backup, payload)
    (tmp_path / "game.mid").write_bytes(b"old")
    write_json(tmp_path / "manifest.json", [])
    song_editor_service.reset_editor(tmp_path)
    assert not (tmp_path / "game.mid").exists()
