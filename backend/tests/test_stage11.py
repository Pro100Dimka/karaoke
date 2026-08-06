from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import models
from app.routers import songs as songs_router
from app.services import song_service
from app.utils import quarantine


class FakeDb:
    def __init__(self, *, fail_commit_at: int | None = None):
        self.fail_commit_at = fail_commit_at
        self.commit_count = 0
        self.deleted = []
        self.rolled_back = False

    def delete(self, value):
        self.deleted.append(value)

    def commit(self):
        self.commit_count += 1
        if self.fail_commit_at == self.commit_count:
            raise RuntimeError("database locked")

    def rollback(self):
        self.rolled_back = True


def _song(source: Path, output: Path):
    return SimpleNamespace(
        id="song-1",
        source_path=str(source),
        output_dir=str(output),
        slug="song-1",
        status=models.SongStatus.PENDING,
        error_message="old error",
        progress_percent=42.0,
        progress_step="5/13",
    )


def test_delete_song_purges_files_only_after_commit(tmp_path, monkeypatch):
    source = tmp_path / "song.wav"
    output = tmp_path / "result"
    source.write_bytes(b"audio")
    output.mkdir()
    (output / "music.json").write_text("{}")
    song = _song(source, output)
    monkeypatch.setattr(song_service, "resolve_source_path", lambda value: source)
    monkeypatch.setattr(song_service, "resolve_output_dir", lambda value: output)
    db = FakeDb()

    song_service.delete_song(db, song)

    assert db.deleted == [song]
    assert db.commit_count == 1
    assert not source.exists()
    assert not output.exists()
    assert not list(tmp_path.glob(".*.delete-*"))


def test_delete_song_restores_source_and_output_when_commit_fails(tmp_path, monkeypatch):
    source = tmp_path / "song.wav"
    output = tmp_path / "result"
    source.write_bytes(b"audio")
    output.mkdir()
    generated = output / "music.json"
    generated.write_text('{"bpm": 120}')
    song = _song(source, output)
    monkeypatch.setattr(song_service, "resolve_source_path", lambda value: source)
    monkeypatch.setattr(song_service, "resolve_output_dir", lambda value: output)
    db = FakeDb(fail_commit_at=1)

    with pytest.raises(RuntimeError, match="database locked"):
        song_service.delete_song(db, song)

    assert db.rolled_back is True
    assert source.read_bytes() == b"audio"
    assert generated.read_text() == '{"bpm": 120}'
    assert not list(tmp_path.glob(".*.delete-*"))


def test_quarantine_handles_files_directories_and_duplicates(tmp_path):
    source = tmp_path / "song.wav"
    output = tmp_path / "result"
    source.write_bytes(b"audio")
    output.mkdir()
    (output / "data.txt").write_text("data")

    moved = quarantine.quarantine_paths((source, output, source))
    assert len(moved) == 2
    assert not source.exists()
    assert not output.exists()

    quarantine.restore_quarantined_paths(moved)
    assert source.read_bytes() == b"audio"
    assert (output / "data.txt").read_text() == "data"


def test_queue_song_job_restores_state_when_slot_is_lost():
    song = _song(Path("song.wav"), Path("result"))
    db = FakeDb()

    with pytest.raises(HTTPException) as exc_info:
        songs_router._queue_song_job(
            db,
            song,
            lambda song_id: False,
            status=models.SongStatus.QUEUED,
            error_message=None,
        )

    assert exc_info.value.status_code == 409
    assert song.status == models.SongStatus.PENDING
    assert song.error_message == "old error"
    assert db.commit_count == 2


def test_queue_song_job_restores_state_when_thread_start_raises():
    song = _song(Path("song.wav"), Path("result"))
    db = FakeDb()

    def fail(song_id: str) -> bool:
        raise RuntimeError("cannot start thread")

    with pytest.raises(RuntimeError, match="cannot start thread"):
        songs_router._queue_song_job(
            db,
            song,
            fail,
            status=models.SongStatus.QUEUED,
            error_message=None,
            progress_percent=0.0,
            progress_step="0/13",
        )

    assert song.status == models.SongStatus.PENDING
    assert song.error_message == "old error"
    assert song.progress_percent == 42.0
    assert song.progress_step == "5/13"
    assert db.commit_count == 2


def test_queue_song_job_keeps_queued_state_after_success():
    song = _song(Path("song.wav"), Path("result"))
    db = FakeDb()

    songs_router._queue_song_job(
        db,
        song,
        lambda song_id: True,
        status=models.SongStatus.QUEUED,
        error_message=None,
    )

    assert song.status == models.SongStatus.QUEUED
    assert song.error_message is None
    assert db.commit_count == 1


def test_queue_song_job_rolls_back_and_restores_state_when_initial_commit_fails():
    song = _song(Path("song.wav"), Path("result"))
    db = FakeDb(fail_commit_at=1)

    with pytest.raises(RuntimeError, match="database locked"):
        songs_router._queue_song_job(
            db,
            song,
            lambda song_id: True,
            status=models.SongStatus.QUEUED,
            error_message=None,
        )

    assert db.rolled_back is True
    assert song.status == models.SongStatus.PENDING
    assert song.error_message == "old error"
