import json
import zipfile
from datetime import UTC, datetime

import soundfile as sf

import models
from app.services import song_package_service
from tests._shared import make_song, patch_attrs


def write_audio(path):
    import numpy as np

    sf.write(path, np.zeros(800, dtype=np.float32), 8_000, format="FLAC")


def write_runtime(output):
    output.mkdir(parents=True, exist_ok=True)
    write_audio(output / "instrumental.flac")
    write_audio(output / "vocals.flac")
    (output / "lyricsSync.json").write_text(
        json.dumps(
            {
                "bpm": 120,
                "key": "Am",
                "words": [
                    {
                        "text": "la",
                        "start": 0.0,
                        "end": 0.1,
                        "notes": [{"note": 60, "start": 0.0, "end": 0.1}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def song(output):
    return make_song(
        id="song-id",
        artist="Artist",
        source_path=str(output / "instrumental.flac"),
        output_dir=str(output),
        status=models.SongStatus.DONE,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def test_package_contains_only_strict_runtime_files(monkeypatch, tmp_path):
    output = tmp_path / "song"
    write_runtime(output)
    (output / "private.json").write_text("{}", encoding="utf-8")
    patch_attrs(monkeypatch, song_package_service.config, CACHE_DIR=tmp_path, SONG_OUTPUT_DIR=tmp_path)

    package = song_package_service.build_package(song(output))
    try:
        with zipfile.ZipFile(package) as archive:
            names = set(archive.namelist())
            assert {name for name in names if name.startswith("output/")} == {
                "output/instrumental.flac",
                "output/vocals.flac",
                "output/lyricsSync.json",
            }
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["content_revision"].startswith("sha256:")
    finally:
        package.unlink()


def test_package_rejects_missing_runtime_file(monkeypatch, tmp_path):
    output = tmp_path / "song"
    write_runtime(output)
    (output / "vocals.flac").unlink()
    patch_attrs(monkeypatch, song_package_service.config, CACHE_DIR=tmp_path, SONG_OUTPUT_DIR=tmp_path)

    try:
        song_package_service.build_package(song(output))
    except ValueError:
        pass
    else:
        raise AssertionError("incomplete runtime package must be rejected")


def test_member_path_rejects_traversal():
    member = zipfile.ZipInfo("../escape")
    try:
        song_package_service._member_path(member)
    except ValueError:
        pass
    else:
        raise AssertionError("unsafe archive path must be rejected")
