from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import models
import schemas
from app.api import dependencies
from tests._shared import raises


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("title", "  New title  ", "New title"),
        ("artist", "  Artist ", "Artist"),
        ("genre", None, None),
        ("key_override", " C#m ", "C#m"),
        ("difficulty_override", " hard ", "hard"),
        ("video_url", " https://example.test/video ", "https://example.test/video"),
    ],
)
def test_song_update_normalizes_optional_text(field, value, expected):
    assert getattr(schemas.SongUpdate(**{field: value}), field) == expected


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "   "},
        {"artist": ""},
        {"note_range_min": 72, "note_range_max": 60},
    ],
)
def test_song_update_rejects_invalid_semantics(payload):
    raises(ValidationError, lambda: schemas.SongUpdate(**payload))


def test_song_update_accepts_ordered_or_partial_note_ranges():
    assert (schemas.SongUpdate(note_range_min=48, note_range_max=72).note_range_max == 72) and (schemas.SongUpdate(note_range_min=48).note_range_min == 48)


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (schemas.LyricWord, {"word": "word", "start": 2, "end": 1}),
        (schemas.LyricLine, {"text": "line", "start": 2, "end": 1}),
    ],
)
def test_lyrics_reject_reversed_time_ranges(schema, payload):
    raises(ValidationError, lambda: schema(**payload))


def test_lyrics_accept_equal_boundaries_and_nested_words():
    word = schemas.LyricWord(word="word", start=1, end=1)
    line = schemas.LyricLine(text="word", start=1, end=1, words=[word])
    assert line.words == [word]


@pytest.mark.parametrize(
    ("dependency", "repository_name", "identifier_name", "detail_fragment"),
    [
        (dependencies.require_song, "get_song", "song_id", "Песня"),
        (dependencies.require_recording, "get_recording", "recording_id", "Запись"),
        (
            dependencies.require_analysis,
            "get_analysis_by_recording",
            "recording_id",
            "Анализ",
        ),
    ],
)
def test_entity_dependencies_return_found_or_stable_404(
    monkeypatch, dependency, repository_name, identifier_name, detail_fragment
):
    database, entity = Mock(), object()
    lookup = Mock(return_value=entity)
    monkeypatch.setattr(dependencies.repositories, repository_name, lookup)

    assert dependency(**{identifier_name: "id", "db": database}) is entity
    lookup.assert_called_once_with(database, "id")

    lookup.return_value = None
    with pytest.raises(HTTPException) as missing: dependency(**{identifier_name: "missing", "db": database})
    assert (missing.value.status_code == 404) and (detail_fragment in missing.value.detail)


def test_model_factories_generate_unique_ids_and_utc_timestamps():
    assert models._new_id() != models._new_id()
    timestamp = models._utc_now()
    assert (isinstance(timestamp, datetime)) and (timestamp.tzinfo is UTC)
