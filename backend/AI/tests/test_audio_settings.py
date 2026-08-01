import models
from app.services import audio_service


class _Session:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, _value) -> None:
        pass


def test_audio_settings_can_reset_the_output_device(monkeypatch):
    settings = models.AudioSettings(audio_driver="auto", output_device_id=12)
    session = _Session()
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)

    updated = audio_service.update_settings(session, {"output_device_id": None})

    assert updated.output_device_id is None
    assert session.commits == 1


def test_unchanged_audio_value_does_not_restart_active_monitor(monkeypatch):
    settings = models.AudioSettings(
        audio_driver="auto",
        volume=1.0,
        monitoring_enabled=True,
    )
    session = _Session()
    restarted = []
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)
    monkeypatch.setattr(
        audio_service, "configure_monitoring", lambda _settings: restarted.append(True)
    )

    audio_service.update_settings(session, {"volume": 1.0})

    assert restarted == []
    assert session.commits == 1
