from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest
import soundfile

import config
from AI import pipeline
from AI.audio import PREDECODED_MIX_NAME
from app.services import song_service
from tests._shared import patch_attrs

CASES = (
    ("unicode-моно-かわいそう.wav", 8_000, 1, []),
    ("stereo.flac", 44_100, 2, []),
    ("vbr.mp3", 48_000, 2, ["-q:a", "4"]),
    ("aac.m4a", 32_000, 1, ["-c:a", "aac"]),
    ("unusual.ogg", 22_050, 2, ["-c:a", "libvorbis"]),
)


def _ffmpeg(*arguments: str) -> None:
    result = subprocess.run(
        [config.FFMPEG_EXE, "-hide_banner", "-loglevel", "error", "-y", *arguments],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(("filename", "rate", "channels", "codec"), CASES)
def test_real_media_corpus_imports_and_normalizes(
    monkeypatch, tmp_path, filename, rate, channels, codec
):
    source = tmp_path / filename
    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.25",
        "-ar",
        str(rate),
        "-ac",
        str(channels),
        "-metadata",
        "title=Привіт かわいそう",
        *codec,
        str(source),
    )
    library = tmp_path / "library"
    database = Mock()
    database.scalars.return_value = []
    patch_attrs(
        monkeypatch,
        song_service.config,
        SONG_OUTPUT_DIR=library,
        SONG_LIBRARY_ROOTS={library},
    )
    monkeypatch.setattr(
        song_service,
        "commit_refresh",
        Mock(side_effect=lambda _db, song: song),
    )
    monkeypatch.setattr(song_service, "_slug_exists", Mock(return_value=False))
    monkeypatch.setenv("FFMPEG_BINARY", config.FFMPEG_EXE)
    song = song_service.create_song_from_path(database, filename, filename, source)
    stored = Path(song.source_path)
    normalized = stored.with_name(PREDECODED_MIX_NAME)
    info = soundfile.info(normalized)
    assert info.samplerate == 44_100 and info.channels == 2 and info.frames > 0


def test_corrupted_audio_is_rejected_before_song_or_partial_is_created(monkeypatch, tmp_path):
    source, library = tmp_path / "broken.mp3", tmp_path / "library"
    source.write_bytes(b"ID3\x04\x00\x00\xff\xfftruncated")
    database = Mock()
    patch_attrs(
        monkeypatch,
        song_service.config,
        SONG_OUTPUT_DIR=library,
        SONG_LIBRARY_ROOTS={library},
    )
    monkeypatch.setenv("FFMPEG_BINARY", config.FFMPEG_EXE)
    with pytest.raises(song_service.InvalidAudioError, match="errors.audioFile"):
        song_service.create_song_from_path(database, "Broken", source.name, source)
    database.add.assert_not_called()
    assert not library.exists() or not any(library.rglob("*"))


def test_pipeline_consumes_upload_decode_without_decoding_source_again(monkeypatch, tmp_path):
    source, output, mix = tmp_path / "source.mp3", tmp_path / "song", tmp_path / "work" / "mix.wav"
    output.mkdir()
    mix.parent.mkdir()
    source.write_bytes(b"original")
    validated = output / PREDECODED_MIX_NAME
    validated.write_bytes(b"already decoded")
    decode = Mock(side_effect=AssertionError("source was decoded twice"))
    monkeypatch.setattr(pipeline, "decode_audio", decode)

    assert pipeline._prepare_mix(source, output, mix, 44_100) == "ffmpeg-validated-upload"
    assert mix.read_bytes() == b"already decoded"
    assert not validated.exists()
    decode.assert_not_called()
