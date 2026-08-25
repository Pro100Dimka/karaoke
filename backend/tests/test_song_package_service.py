import json
import zipfile
from datetime import UTC, datetime

import soundfile as sf
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from app.services import song_package_service
from database import Base
from tests._shared import make_song, patch_attrs


def write_audio(path, *, format="FLAC"):
    import numpy as np

    sf.write(path, np.zeros(800, dtype=np.float32), 8_000, format=format)


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
            # source_path already equals output/instrumental.flac (post-processing
            # state) — storing it a second time under source/ would just double
            # the archive size for a file import discards anyway.
            assert not {name for name in names if name.startswith("source/")}
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["content_revision"].startswith("sha256:")
    finally:
        package.unlink()


def test_package_preserves_a_source_distinct_from_the_instrumental(monkeypatch, tmp_path):
    output = tmp_path / "song"
    write_runtime(output)
    original = tmp_path / "song" / "source.wav"
    write_audio(original, format="WAV")
    patch_attrs(monkeypatch, song_package_service.config, CACHE_DIR=tmp_path, SONG_OUTPUT_DIR=tmp_path)

    current = song(output)
    current.source_path = str(original)
    package = song_package_service.build_package(current)
    try:
        with zipfile.ZipFile(package) as archive:
            names = set(archive.namelist())
            assert {name for name in names if name.startswith("source/")} == {"source/source.wav"}
    finally:
        package.unlink()


def test_package_export_import_round_trip_preserves_revision(monkeypatch, tmp_path):
    export_output = tmp_path / "exporter-library" / "song"
    write_runtime(export_output)
    patch_attrs(
        monkeypatch, song_package_service.config,
        CACHE_DIR=tmp_path, SONG_OUTPUT_DIR=export_output.parent, SONG_LIBRARY_ROOTS={export_output.parent},
    )
    exported_song = song(export_output)
    package_path = song_package_service.build_package(exported_song)
    exported_revision = song_package_service.compute_content_revision(exported_song)

    import_root = tmp_path / "importer-library"
    import_root.mkdir()
    patch_attrs(
        monkeypatch, song_package_service.config,
        SONG_OUTPUT_DIR=import_root, SONG_LIBRARY_ROOTS={import_root},
    )
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        imported = song_package_service.import_package(db, package_path)
        assert song_package_service.compute_content_revision(imported) == exported_revision
        # Import must materialize the instrumental exactly once (not a second
        # "source" copy) even though it aliases source_path to it.
        assert {path.name for path in (import_root / imported.slug).iterdir()} == {
            "instrumental.flac", "vocals.flac", "lyricsSync.json",
        }
    finally:
        db.close()
        engine.dispose()
        package_path.unlink(missing_ok=True)


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
