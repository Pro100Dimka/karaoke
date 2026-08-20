import json

import pytest

from app.services import song_editor_service
from app.utils.json_files import write_json
from tests._shared import raises


@pytest.mark.parametrize("value", [None, "bad"])
def test_number_rejects_non_numeric(value):
    raises(ValueError, lambda: song_editor_service._number(value, 'value'), match='number')


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_number_rejects_non_finite(value):
    raises(ValueError, lambda: song_editor_service._number(value, 'value'), match='finite')


def test_integer_and_index_helpers_are_stable():
    assert (song_editor_service._number('1.5', 'value') == 1.5) and (song_editor_service._int_or_none(None) is None) and (song_editor_service._int_or_none('') is None) and (song_editor_service._int_or_none('2') == 2)
    raises(ValueError, lambda: song_editor_service._int_or_none('bad'), match='index')
    assert (song_editor_service._safe_int('bad', 4) == 4) and (song_editor_service._indices([2, '1', 2, None]) == [1, 2]) and (song_editor_service._indices(None, '3') == [3]) and (song_editor_service._indices(None) == [])


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
    assert ((note | {'midi_note': 61, 'velocity': 127}, note['syllable_indices']) == (note, [2, 3])) and (note['cents'] == [] and note['edited'] is True)

    invalid = [
        ({"start": -1, "end": 1, "midi": 60}, "start"),
        ({"start": 1, "end": 1, "midi": 60}, "start"),
        ({"start": 0, "end": 4, "midi": 60}, "outside"),
        ({"start": 0, "end": 1, "midi": 128}, "MIDI"),
    ]
    for payload, message in invalid: raises(ValueError, lambda payload=payload: song_editor_service._normalize_note(payload, 3), match=message)


def test_refresh_lines_ignores_invalid_links_and_line_entries():
    song_map, notes = {'syllables': [None, {'index': 0, 'word_index': 0, 'start': 0, 'end': 1, 'text': 'a'}, {'index': 1, 'word_index': 99, 'start': 0.5, 'end': 1.5, 'text': 'b'}], 'words': [None, {'index': 0, 'start': 0, 'end': 1, 'text': 'ab'}], 'lines': [None, {'words': [None, {'index': -1}, {'index': 0}]}, {'words': []}]}, [{'start': 0, 'end': 1, 'syllable_indices': 'bad', 'syllable_index': 'bad'}, {'start': 0, 'end': 1.5, 'syllable_indices': [0, 'bad', 1]}]
    song_editor_service._refresh_lines(song_map, notes)
    assert (len(song_map['syllables']) == 2) and (song_map['words'][0]['syllables']) and (len(song_map['lines']) == 2) and (song_map['lines'][0]['words'][0]['index'] == 0)


def test_refresh_lines_projects_merged_note_into_disjoint_syllable_windows():
    song_map, source = {'syllables': [{'index': 0, 'word_index': 0, 'start': 0, 'end': 0.5, 'text': 'a'}, {'index': 1, 'word_index': 0, 'start': 0.5, 'end': 1, 'text': 'b'}], 'words': [{'index': 0, 'start': 0, 'end': 1, 'text': 'ab'}], 'lines': [{'words': [{'index': 0}]}]}, {'start': 0, 'end': 1, 'midi_note': 60, 'syllable_indices': [0, 1]}

    song_editor_service._refresh_lines(song_map, [source])

    projected = song_map["words"][0]["syllables"]
    assert ([item['display_notes'][0]['syllable_index'] for item in projected], [(item['display_notes'][0]['start'], item['display_notes'][0]['end']) for item in projected], [item['display_notes'][0]['syllable_indices'] for item in projected]) == ([0, 1], [(0, 0.5), (0.5, 1)], [[0], [1]])


def test_load_editor_repairs_generated_boundary_syllable_associations(tmp_path):
    payload = base_song_map()
    payload["notes"] = [
        {
            "start": 7.12,
            "end": 7.52,
            "midi_note": 55,
            "syllable_index": 6,
            "syllable_indices": [3, 4, 5, 6],
        }
    ]
    payload["display_notes"] = [dict(payload["notes"][0])]
    payload["syllables"] = [
        {"index": 2, "word_index": 1, "start": 7.048, "end": 7.12, "text": "ши"},
        {"index": 3, "word_index": 1, "start": 7.12, "end": 7.16, "text": "ро"},
    ]
    write_json(tmp_path / "songMap.json", payload)

    song_map, _ = song_editor_service.load_editor(tmp_path)

    assert (song_map['notes'][0]['syllable_indices'], song_map['display_notes'][0]['syllable_indices']) == ([3], [3])

    normalized = song_editor_service.normalize_editor_timeline(payload)
    assert normalized["notes"][0]["syllable_indices"] == [3]


def test_generated_association_keeps_all_cross_word_overlaps():
    song_map = {
        "syllables": [
            {"index": 0, "word_index": 0, "start": 0, "end": 0.6},
            {"index": 1, "word_index": 1, "start": 0.6, "end": 1},
        ],
        "notes": [{"start": 0.2, "end": 0.9}],
        "display_notes": [{"start": 0.2, "end": 0.9}],
    }

    song_editor_service._refresh_generated_note_associations(song_map)

    assert (song_map['notes'][0]['syllable_indices'], song_map['display_notes'][0]['syllable_indices']) == ([0, 1], [0, 1])


def base_song_map(): return {'duration': 5, 'bpm': 120, 'notes': [], 'words': [{'index': 0, 'start': 0, 'end': 1, 'text': 'la'}], 'syllables': [{'index': 0, 'word_index': 0, 'start': 0, 'end': 1, 'text': 'la'}], 'lines': [{'words': [{'index': 0}]}], 'display_stats': {'old': True}}


def test_load_and_normalize_editor_validate_contract(tmp_path):
    raises(ValueError, lambda: song_editor_service.load_editor(tmp_path), match='not available')
    write_json(tmp_path / "songMap.json", [])
    raises(ValueError, lambda: song_editor_service.load_editor(tmp_path), match='not available')
    payload = base_song_map()
    payload["editor"] = {"edited": True}
    write_json(tmp_path / "songMap.json", payload)
    loaded, backup = song_editor_service.load_editor(tmp_path)
    assert loaded["notes"] == [] and backup is False
    untouched = {"notes": []}
    assert song_editor_service.normalize_editor_timeline(untouched) is untouched


def test_save_editor_creates_backup_json_manifest_and_removes_legacy_midi(tmp_path):
    write_json(tmp_path / "songMap.json", base_song_map())
    write_json(tmp_path / "manifest.json", {"existing": True})
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
    assert ([note['midi_note'] for note in saved['notes']] == [60, 62]) and ((tmp_path / 'songMap.ai.json').exists()) and (json.loads((tmp_path / 'reference.json').read_text(encoding='utf-8'))['notes']) and (json.loads((tmp_path / 'manifest.json').read_text(encoding='utf-8'))['manual_editor']['note_count'] == 2)
    assert not (tmp_path / "game.mid").exists()

    (tmp_path / "game.mid").write_bytes(b"old")
    write_json(tmp_path / "manifest.json", [])
    song_editor_service.save_editor(tmp_path, [])
    assert not (tmp_path / "game.mid").exists()


def test_reset_editor_validates_backup_and_rebuilds_outputs(tmp_path):
    raises(ValueError, lambda: song_editor_service.reset_editor(tmp_path), match='not available')
    backup = tmp_path / "songMap.ai.json"
    write_json(backup, [])
    raises(ValueError, lambda: song_editor_service.reset_editor(tmp_path), match='invalid')
    write_json(backup, {"notes": "bad"})
    raises(ValueError, lambda: song_editor_service.reset_editor(tmp_path), match='notes')

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
    restored = song_editor_service.reset_editor(tmp_path)
    assert restored["notes"] == payload["notes"]
    assert not (tmp_path / "game.mid").exists()
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
