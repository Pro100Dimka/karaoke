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


def two_word_document():
    return {
        "bpm": 120,
        "key": "C",
        "words": [
            {"text": "one", "start": 1.0, "end": 2.0, "notes": [{"note": 60, "start": 1.0, "end": 2.0}]},
            {"text": "two", "start": 2.0, "end": 3.0, "notes": [{"note": 62, "start": 2.0, "end": 3.0}]},
        ],
    }


def test_save_editor_applies_word_texts_without_touching_notes(tmp_path):
    write_document(tmp_path, two_word_document())
    saved = song_editor_service.save_editor(
        tmp_path,
        [
            {"note": 60, "start": 1.0, "end": 2.0, "word_index": 0},
            {"note": 62, "start": 2.0, "end": 3.0, "word_index": 1},
        ],
        word_texts=["two", "one"],
    )
    assert [word["text"] for word in saved["words"]] == ["two", "one"]
    assert [word["start"] for word in saved["words"]] == [1.0, 2.0]
    assert saved["words"][0]["notes"][0]["note"] == 60


def test_save_editor_rejects_mismatched_word_texts_length(tmp_path):
    write_document(tmp_path, two_word_document())
    with pytest.raises(ValueError, match="word_texts"):
        song_editor_service.save_editor(
            tmp_path,
            [
                {"note": 60, "start": 1.0, "end": 2.0, "word_index": 0},
                {"note": 62, "start": 2.0, "end": 3.0, "word_index": 1},
            ],
            word_texts=["only-one"],
        )


def test_save_editor_without_word_texts_leaves_text_unchanged(tmp_path):
    write_document(tmp_path, two_word_document())
    saved = song_editor_service.save_editor(
        tmp_path,
        [
            {"note": 60, "start": 1.0, "end": 2.0, "word_index": 0},
            {"note": 62, "start": 2.0, "end": 3.0, "word_index": 1},
        ],
    )
    assert [word["text"] for word in saved["words"]] == ["one", "two"]


def test_save_editor_applies_word_bounds_and_reclips_notes_to_them(tmp_path):
    write_document(tmp_path, two_word_document())
    saved = song_editor_service.save_editor(
        tmp_path,
        [
            {"note": 60, "start": 1.0, "end": 1.5, "word_index": 0},
            {"note": 62, "start": 1.5, "end": 3.0, "word_index": 1},
        ],
        word_bounds=[{"start": 1.0, "end": 1.5}, {"start": 1.5, "end": 3.0}],
    )
    assert [(word["start"], word["end"]) for word in saved["words"]] == [(1.0, 1.5), (1.5, 3.0)]
    assert saved["words"][0]["notes"][0]["end"] == 1.5
    assert saved["words"][1]["notes"][0]["start"] == 1.5


def test_save_editor_rejects_mismatched_word_bounds_length(tmp_path):
    write_document(tmp_path, two_word_document())
    with pytest.raises(ValueError, match="word_bounds"):
        song_editor_service.save_editor(
            tmp_path,
            [{"note": 60, "start": 1.0, "end": 2.0, "word_index": 0}],
            word_bounds=[{"start": 1.0, "end": 2.0}],
        )
