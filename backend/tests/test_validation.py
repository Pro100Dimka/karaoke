from pathlib import Path

import pytest
from pydantic import ValidationError

import schemas
from app.services.song_service import slugify


def test_song_update_rejects_inverted_note_range() -> None:
    with pytest.raises(ValidationError):
        schemas.SongUpdate(note_range_min=80, note_range_max=40)


def test_song_update_strips_text() -> None:
    patch = schemas.SongUpdate(title="  Song  ", artist="  Artist  ")
    assert patch.title == "Song"
    assert patch.artist == "Artist"


def test_song_update_rejects_blank_title() -> None:
    with pytest.raises(ValidationError):
        schemas.SongUpdate(title="   ")


def test_slugify_never_returns_path_components() -> None:
    result = slugify("../../Моя песня", fallback="song")
    assert result == "song"
    assert Path(result).name == result
