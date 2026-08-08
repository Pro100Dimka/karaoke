import io
import threading
import warnings
import zipfile

import pytest

import config
from app.services import song_package_service, song_service
from app.utils.atomic_files import atomic_write
from app.utils.json_files import read_json, write_json


class _EmptyQuery:
    def filter(self, *_args):
        return self

    def first(self):
        return None


class _SlugSession:
    def query(self, _model):
        return _EmptyQuery()


def _archive_with(entries: list[tuple[str, bytes]]) -> zipfile.ZipFile:
    buffer = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, payload in entries:
                archive.writestr(name, payload)
    buffer.seek(0)
    return zipfile.ZipFile(buffer)


def test_unique_slug_skips_orphaned_source_file(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", tmp_path / "songs")
    config.SONG_OUTPUT_DIR.mkdir()
    orphan = config.SONG_OUTPUT_DIR / "track"
    orphan.mkdir()
    (orphan / "source.wav").write_bytes(b"orphan")

    assert song_service.make_unique_slug(_SlugSession(), "track") == "track-2"


def test_unique_slug_skips_orphaned_output_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", tmp_path / "songs")
    config.SONG_OUTPUT_DIR.mkdir()
    (config.SONG_OUTPUT_DIR / "track").mkdir()

    assert song_service.make_unique_slug(_SlugSession(), "track") == "track-2"


def test_package_rejects_windows_style_paths():
    with (
        _archive_with([("manifest.json", b"{}"), ("output\\..\\escape.txt", b"x")]) as archive,
        pytest.raises(ValueError, match="unsafe path"),
    ):
        song_package_service._safe_members(archive)


def test_package_rejects_duplicate_paths():
    with (
        _archive_with([("manifest.json", b"{}"), ("manifest.json", b"{}")]) as archive,
        pytest.raises(ValueError, match="duplicate paths"),
    ):
        song_package_service._safe_members(archive)


def test_atomic_write_removes_unique_temp_on_failure(tmp_path):
    destination = tmp_path / "state.bin"

    def fail(stream):
        stream.write(b"partial")
        raise RuntimeError("write failed")

    with pytest.raises(RuntimeError, match="write failed"):
        atomic_write(destination, fail)

    assert not destination.exists()
    assert list(tmp_path.iterdir()) == []


def test_concurrent_json_writes_do_not_share_temp_file(tmp_path):
    destination = tmp_path / "settings.json"
    barrier = threading.Barrier(2)
    errors: list[Exception] = []

    def worker(value: int) -> None:
        try:
            barrier.wait(timeout=2)
            write_json(destination, {"value": value})
        except Exception as exc:  # pragma: no cover - assertion reports failures
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(value,)) for value in (1, 2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=3)

    assert errors == []
    assert read_json(destination) in ({"value": 1}, {"value": 2})
    assert not list(tmp_path.glob(".*.tmp"))


def test_package_rejects_windows_drive_components():
    with (
        _archive_with([("manifest.json", b"{}"), ("output/C:/escape.txt", b"x")]) as archive,
        pytest.raises(ValueError, match="unsafe path"),
    ):
        song_package_service._safe_members(archive)
