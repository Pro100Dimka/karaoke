import json

import pytest

from app.services import song_editor_service


def lyrics(notes=None):
    return {
        "bpm": 120,
        "key": "C",
        "words": [
            {
                "text": "hello",
                "start": 1.0,
                "end": 2.0,
                "notes": notes or [{"note": 60, "start": 1.0, "end": 2.0}],
            }
        ],
    }


def write_document(path, payload=None):
    path.joinpath("lyricsSync.json").write_text(
        json.dumps(payload or lyrics()), encoding="utf-8"
    )


def test_editor_loads_and_projects_notes(tmp_path):
    write_document(tmp_path)
    payload, backup = song_editor_service.load_editor(tmp_path)

    assert backup is False
    assert song_editor_service.editor_notes(payload) == [
        {"note": 60, "start": 1.0, "end": 2.0, "word_index": 0}
    ]


def test_editor_save_and_reset_use_embedded_backup(tmp_path):
    write_document(tmp_path)
    saved = song_editor_service.save_editor(
        tmp_path,
        [{"note": 64, "start": 1.2, "end": 1.8, "word_index": 0}],
    )
    assert saved["words"][0]["notes"][0]["note"] == 64
    assert saved["editor"]["edited"] is True

    restored = song_editor_service.reset_editor(tmp_path)
    assert restored["words"][0]["notes"][0]["note"] == 60
    assert restored["editor"] == {"edited": False, "source": "ai"}


@pytest.mark.parametrize(
    "note",
    [
        {"note": 60, "start": 0.9, "end": 1.2, "word_index": 0},
        {"note": 60, "start": 1.8, "end": 2.1, "word_index": 0},
        {"note": 60, "start": 1.5, "end": 1.5, "word_index": 0},
    ],
)
def test_editor_rejects_notes_outside_word(note, tmp_path):
    write_document(tmp_path)
    with pytest.raises(ValueError):
        song_editor_service.save_editor(tmp_path, [note])


def test_reset_requires_backup(tmp_path):
    write_document(tmp_path)
    with pytest.raises(ValueError, match="backup"):
        song_editor_service.reset_editor(tmp_path)
