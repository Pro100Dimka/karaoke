import json
import logging
from types import SimpleNamespace
from unittest.mock import Mock

from app.services import artifact_integrity, remote_log_service
from tests._shared import patch_attrs


def test_manifest_integrity_refreshes_and_removes_missing_outputs(tmp_path):
    artifact = tmp_path / "lyricsSync.json"
    artifact.write_text("{}", encoding="utf-8")
    manifest = {
        "outputs": {
            "lyrics": "lyricsSync.json",
            "missing": "missing.json",
            "ignored": "other.json",
            "invalid": None,
        },
        "integrity": None,
    }

    artifact_integrity.refresh_manifest_integrity(
        tmp_path,
        manifest,
        ["lyricsSync.json", "missing.json"],
        remove_missing=True,
    )

    assert manifest["outputs"] == {
        "lyrics": "lyricsSync.json",
        "ignored": "other.json",
        "invalid": None,
    }
    assert manifest["integrity"]["lyrics"]["size"] == 2
    assert len(manifest["integrity"]["lyrics"]["sha256"]) == 64

    untouched = {"outputs": None}
    artifact_integrity.refresh_manifest_integrity(tmp_path, untouched, [])
    assert untouched == {"outputs": None}


def test_remote_device_identity_is_persistent_and_failure_safe(monkeypatch, tmp_path):
    patch_attrs(monkeypatch, remote_log_service, _IDENTITY_LOCK=MockLock())
    monkeypatch.setattr("config.DATA_DIR", tmp_path)
    (tmp_path / "device-id").write_text("named-pc\n", encoding="utf-8")
    assert remote_log_service._persistent_device_id() == "named-pc"

    (tmp_path / "device-id").unlink()
    monkeypatch.setattr(remote_log_service.uuid, "uuid4", lambda: SimpleNamespace(hex="abcdef1234567890"))
    assert remote_log_service._persistent_device_id() == "pc-abcdef123456"
    assert (tmp_path / "device-id").read_text(encoding="utf-8") == "pc-abcdef123456"


class MockLock:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_remote_batch_transport_uses_structured_device_payload(monkeypatch):
    response = Mock()
    opener = Mock(return_value=response)
    patch_attrs(monkeypatch, remote_log_service.urllib.request, urlopen=opener)
    payload = {"device_id": "pc-one", "events": [{"level": "WARNING", "message": "warning"}]}
    assert remote_log_service._send(payload) is True
    request = opener.call_args.args[0]
    assert request.full_url == remote_log_service._LOG_UPLOAD_URL
    assert request.method == "POST"
    assert request.headers["User-agent"] == remote_log_service._CLIENT_USER_AGENT
    assert json.loads(request.data)["device_id"] == "pc-one"
    response.close.assert_called_once()

    monkeypatch.setattr(remote_log_service.urllib.request, "urlopen", Mock(side_effect=OSError))
    assert remote_log_service._send(payload) is False


def test_remote_logs_batch_after_silence_and_ignore_info(monkeypatch):
    schedule, sent = Mock(), Mock(return_value=True)
    patch_attrs(
        monkeypatch,
        remote_log_service,
        _DISABLED=False,
        _PENDING_EVENTS=[],
        _PENDING_HARDWARE=None,
        _FLUSH_TIMER=None,
        _schedule_flush_locked=schedule,
        _persistent_device_id=lambda: "pc-stable",
        _current_online_name=lambda: "Singer",
        _send=sent,
    )
    remote_log_service.queue_log(logging.INFO, "noise")
    remote_log_service.queue_log(logging.WARNING, "first")
    remote_log_service.queue_log(logging.ERROR, "second")
    remote_log_service.queue_hardware_snapshot({"cpu": "Test", "settings": {"threads": 4}})
    assert schedule.call_count == 3

    remote_log_service.flush_pending()

    payload = sent.call_args.args[0]
    assert payload["device_id"] == "pc-stable"
    assert [event["level"] for event in payload["events"]] == ["WARNING", "ERROR"]
    assert payload["hardware"]["cpu"] == "Test"
    assert remote_log_service._PENDING_EVENTS == []


def test_remote_failed_batch_is_retained_with_exponential_retry(monkeypatch):
    schedule = Mock()
    patch_attrs(
        monkeypatch,
        remote_log_service,
        _DISABLED=False,
        _PENDING_EVENTS=[],
        _PENDING_HARDWARE=None,
        _FLUSH_TIMER=None,
        _RETRY_DELAY_SECONDS=60.0,
        _schedule_flush_locked=schedule,
        _persistent_device_id=lambda: "pc-stable",
        _current_online_name=lambda: "Singer",
        _send=Mock(return_value=False),
    )
    remote_log_service.queue_log(logging.ERROR, "keep me")
    remote_log_service.flush_pending()

    assert remote_log_service._PENDING_EVENTS[0]["message"] == "keep me"
    assert schedule.call_args.args == (60.0,)
    assert remote_log_service._RETRY_DELAY_SECONDS == 120.0


def test_remote_name_fallback_and_log_handler(monkeypatch):
    from app.services import app_settings_service

    monkeypatch.setattr(app_settings_service, "read_settings", lambda: {"online_name": "  Singer  "})
    assert remote_log_service._current_online_name() == "Singer"
    monkeypatch.setattr(app_settings_service, "read_settings", lambda: {"online_name": "\ufffd"})
    assert remote_log_service._current_online_name() == ""
    monkeypatch.setattr(app_settings_service, "read_settings", Mock(side_effect=RuntimeError))
    assert remote_log_service._current_online_name() == ""

    sent = Mock()
    patch_attrs(monkeypatch, remote_log_service, _DISABLED=False, queue_log=sent)
    handler = remote_log_service.RemoteErrorLogHandler()
    handler.emit(logging.LogRecord("test", logging.INFO, __file__, 1, "noise", (), None))
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "boom", (), None))
    sent.assert_called_once_with(logging.ERROR, "boom")

    monkeypatch.setattr(handler, "format", Mock(side_effect=ValueError))
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "bad", (), None))
    monkeypatch.setattr(remote_log_service, "_DISABLED", True)
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "off", (), None))
    assert sent.call_count == 1
