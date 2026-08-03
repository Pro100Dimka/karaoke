import zipfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import config
import models
from app.services import song_package_service
from database import Base


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_song_package_round_trip(tmp_path, monkeypatch):
    source_root = tmp_path / "source"
    output_root = tmp_path / "output"
    data_root = tmp_path / "data"
    for directory in (source_root, output_root, data_root):
        directory.mkdir()
    monkeypatch.setattr(config, "FULL_SONGS_DIR", source_root)
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", output_root)
    monkeypatch.setattr(config, "DATA_DIR", data_root)

    source = source_root / "demo.mp3"
    source.write_bytes(b"source-audio")
    processed = output_root / "demo"
    processed.mkdir()
    (processed / "instrumental.mp3").write_bytes(b"instrumental")
    (processed / "vocals.mp3").write_bytes(b"vocals")
    (processed / "lyrics.json").write_text("[]", encoding="utf-8")
    (processed / "logs").mkdir()
    (processed / "logs" / "pipeline.log").write_text("private log", encoding="utf-8")

    export_db = _session()
    song = models.Song(
        id="shared-song-id",
        title="Shared song",
        original_filename="demo.mp3",
        source_path=str(source),
        slug="demo",
        output_dir=str(processed),
        status=models.SongStatus.DONE,
        progress_percent=100,
    )
    export_db.add(song)
    export_db.commit()

    package = song_package_service.build_package(song)
    with zipfile.ZipFile(package) as archive:
        assert "source/demo.mp3" in archive.namelist()
        assert "output/instrumental.mp3" in archive.namelist()
        assert "output/logs/pipeline.log" not in archive.namelist()

    # Import into a different local library, as happens on another computer.
    imported_source = tmp_path / "imported-source"
    imported_output = tmp_path / "imported-output"
    imported_source.mkdir()
    imported_output.mkdir()
    monkeypatch.setattr(config, "FULL_SONGS_DIR", imported_source)
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", imported_output)
    import_db = _session()
    imported = song_package_service.import_package(import_db, package)

    assert imported.id == song.id
    assert imported.title == song.title
    assert (imported_source / "demo.mp3").read_bytes() == b"source-audio"
    assert (imported_output / "demo" / "vocals.mp3").read_bytes() == b"vocals"


def test_song_package_rejects_parent_paths(tmp_path):
    package = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr("../outside.txt", "unsafe")
    with zipfile.ZipFile(package) as archive:
        with pytest.raises(ValueError, match="unsafe path"):
            song_package_service._safe_members(archive)
