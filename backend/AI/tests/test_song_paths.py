from pathlib import Path

import pytest

import config
import models
from app.services.song_service import resolve_output_dir, resolve_source_path


def _song() -> models.Song:
    return models.Song(
        title="Test song",
        original_filename="test.wav",
        source_path=str(config.FULL_SONGS_DIR / "test.wav"),
        slug="test-song",
        output_dir=str(config.SONG_OUTPUT_DIR / "test-song"),
    )


def test_song_paths_resolve_inside_owned_library():
    song = _song()

    assert resolve_source_path(song) == (config.FULL_SONGS_DIR / "test.wav").resolve()
    assert resolve_output_dir(song) == (config.SONG_OUTPUT_DIR / "test-song").resolve()


@pytest.mark.parametrize("field", ["source_path", "output_dir"])
def test_song_paths_reject_locations_outside_owned_library(field: str):
    song = _song()
    setattr(song, field, str(Path(config.BASE_DIR).parent / "outside-library"))

    resolver = resolve_source_path if field == "source_path" else resolve_output_dir
    with pytest.raises(ValueError, match="outside the application library"):
        resolver(song)
