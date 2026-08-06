from types import SimpleNamespace

import pytest

from app.services import recording_service


class _FakeDb:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def test_stop_recording_closes_claimed_session_when_song_is_missing(monkeypatch):
    session = SimpleNamespace(song_id="missing", close_calls=0)
    session.close = lambda: setattr(session, "close_calls", session.close_calls + 1)
    recording_service._sessions["session"] = session
    db = _FakeDb()
    monkeypatch.setattr(recording_service, "SessionLocal", lambda: db)
    monkeypatch.setattr(recording_service.repositories, "get_song", lambda *_args: None)

    with pytest.raises(ValueError, match="не найдена"):
        recording_service.stop_recording("session")

    assert session.close_calls == 1
    assert db.closed is True
    assert "session" not in recording_service._sessions


def test_performance_mix_failure_does_not_invalidate_saved_recording(monkeypatch):
    recording = SimpleNamespace(id="recording-id")
    song = SimpleNamespace(id="song-id")
    monkeypatch.setattr(
        recording_service,
        "_create_performance_mix",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("ffmpeg failed")),
    )

    recording_service._create_performance_mix_safely(recording, song, 0.0, 1.0, {})


def test_close_all_sessions_clears_registry_and_closes_every_session():
    first = SimpleNamespace(close_calls=0)
    second = SimpleNamespace(close_calls=0)
    first.close = lambda: setattr(first, "close_calls", first.close_calls + 1)
    second.close = lambda: setattr(second, "close_calls", second.close_calls + 1)
    recording_service._sessions.update({"one": first, "two": second})

    recording_service.close_all_sessions()

    assert recording_service._sessions == {}
    assert first.close_calls == 1
    assert second.close_calls == 1
