from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
import schemas
from app.services import pipeline_service, recording_service, song_service
from app.services.db_utils import commit


class FailingDb:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.refreshed = False

    def commit(self):
        self.committed = True
        raise RuntimeError("database locked")

    def rollback(self):
        self.rolled_back = True

    def refresh(self, _instance):
        self.refreshed = True


def test_commit_rolls_back_failed_transaction():
    db = FailingDb()

    with pytest.raises(RuntimeError, match="database locked"):
        commit(db)

    assert db.committed is True
    assert db.rolled_back is True


def test_update_song_restores_object_when_commit_fails():
    db = FailingDb()
    song = SimpleNamespace(title="Old", artist="Artist")
    patch = schemas.SongUpdate(title="New")

    with pytest.raises(RuntimeError, match="database locked"):
        song_service.update_song(db, song, patch)

    assert song.title == "Old"
    assert song.artist == "Artist"
    assert db.rolled_back is True
    assert db.refreshed is False


def test_recording_start_generates_session_id(monkeypatch):
    created = SimpleNamespace(start=Mock())
    constructor = Mock(return_value=created)
    monkeypatch.setattr(recording_service, "_AUDIO_BACKEND_AVAILABLE", True)
    monkeypatch.setattr(recording_service, "RecordingSession", constructor)
    monkeypatch.setattr(recording_service.uuid, "uuid4", lambda: SimpleNamespace(hex="session-id"))
    recording_service._sessions.clear()

    session_id = recording_service.start_recording("song-id")

    assert session_id == "session-id"
    assert recording_service._sessions[session_id] is created
    constructor.assert_called_once()
    created.start.assert_called_once_with()
    recording_service._sessions.clear()


def test_job_entrypoint_releases_slot_after_early_return(monkeypatch):
    current = Mock()
    worker = Mock()
    pipeline_service._active_jobs.clear()
    pipeline_service._active_jobs["song"] = current
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: current)

    pipeline_service._job_entrypoint("song", worker)

    worker.assert_called_once_with("song")
    assert "song" not in pipeline_service._active_jobs


def test_job_entrypoint_releases_slot_after_worker_error(monkeypatch):
    current = Mock()
    pipeline_service._active_jobs.clear()
    pipeline_service._active_jobs["song"] = current
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: current)

    with pytest.raises(RuntimeError, match="worker failed"):
        pipeline_service._job_entrypoint(
            "song", lambda _song_id: (_ for _ in ()).throw(RuntimeError("worker failed"))
        )

    assert "song" not in pipeline_service._active_jobs


def test_background_thread_uses_guarded_entrypoint(monkeypatch):
    pipeline_service._active_jobs.clear()
    thread = Mock()
    thread.is_alive.return_value = False
    thread_factory = Mock(return_value=thread)
    worker = Mock()
    monkeypatch.setattr(pipeline_service.threading, "Thread", thread_factory)

    assert pipeline_service._start_background_job("song", worker) is True

    _, kwargs = thread_factory.call_args
    assert kwargs["target"] is pipeline_service._job_entrypoint
    assert kwargs["args"] == ("song", worker)
    thread.start.assert_called_once_with()
    pipeline_service._active_jobs.clear()
