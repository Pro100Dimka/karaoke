import pytest

import config
from app.services import song_service


class _Query:
    def filter(self, *_args):
        return self

    def first(self):
        return None


class _FailingSession:
    def __init__(self) -> None:
        self.rolled_back = False

    def query(self, _model):
        return _Query()

    def add(self, _song) -> None:
        pass

    def commit(self) -> None:
        raise RuntimeError("database unavailable")

    def rollback(self) -> None:
        self.rolled_back = True


def test_failed_song_creation_removes_the_uploaded_original(tmp_path, monkeypatch):
    session = _FailingSession()
    monkeypatch.setattr(config, "FULL_SONGS_DIR", tmp_path)

    with pytest.raises(RuntimeError, match="database unavailable"):
        song_service.create_song(session, "Test", "test.wav", b"audio")

    assert list(tmp_path.iterdir()) == []
    assert session.rolled_back is True
