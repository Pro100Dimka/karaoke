from types import SimpleNamespace

import pytest

from app.routers import analysis as analysis_router
from app.services import audio_service


class FakeDb:
    def __init__(self, *, commit_error=None):
        self.commit_error = commit_error
        self.commits = 0
        self.rollbacks = 0
        self.refreshes = 0

    def commit(self):
        self.commits += 1
        if self.commit_error:
            raise self.commit_error

    def rollback(self):
        self.rollbacks += 1

    def refresh(self, _instance):
        self.refreshes += 1


def test_set_monitoring_enabled_restores_runtime_when_commit_fails(monkeypatch):
    settings = SimpleNamespace(monitoring_enabled=False)
    db = FakeDb(commit_error=RuntimeError("locked"))
    configured = []
    monkeypatch.setattr(audio_service, "get_settings", lambda _db: settings)
    monkeypatch.setattr(
        audio_service,
        "configure_monitoring",
        lambda current: configured.append(current.monitoring_enabled),
    )

    with pytest.raises(RuntimeError, match="locked"):
        audio_service.set_monitoring_enabled(db, True)

    assert settings.monitoring_enabled is False
    assert configured == [True, False]
    assert db.rollbacks >= 1


def test_set_monitoring_enabled_does_not_commit_unchanged_state(monkeypatch):
    settings = SimpleNamespace(monitoring_enabled=False)
    db = FakeDb()
    stopped = []
    monkeypatch.setattr(audio_service, "get_settings", lambda _db: settings)
    monkeypatch.setattr(audio_service, "stop_monitoring", lambda: stopped.append(True))

    assert audio_service.set_monitoring_enabled(db, False) is settings
    assert stopped == [True]
    assert db.commits == 0


def test_analysis_rolls_back_on_non_integrity_commit_error(monkeypatch):
    recording = SimpleNamespace(id="rec", song_id="song")
    song = SimpleNamespace(id="song")
    db = FakeDb(commit_error=RuntimeError("disk full"))
    db.add = lambda _value: None
    monkeypatch.setattr(analysis_router.repositories, "get_song", lambda *_: song)
    monkeypatch.setattr(analysis_router.repositories, "get_analysis_by_recording", lambda *_: None)
    monkeypatch.setattr(
        analysis_router.analysis_service,
        "analyze_recording",
        lambda *_: {
            "pitch_accuracy_percent": 90.0,
            "mean_deviation_semitones": 0.2,
            "sections": [],
        },
    )

    with pytest.raises(RuntimeError, match="disk full"):
        analysis_router.run_analysis(recording, db)

    assert db.rollbacks == 1
