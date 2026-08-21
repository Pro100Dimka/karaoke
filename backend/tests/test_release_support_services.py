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


def test_remote_name_send_and_background_dispatch(monkeypatch):
    response = Mock()
    opener = Mock(return_value=response)
    patch_attrs(monkeypatch, remote_log_service.urllib.request, urlopen=opener)
    remote_log_service._send("warning", "Singer")
    request = opener.call_args.args[0]
    assert request.full_url == remote_log_service._LOG_UPLOAD_URL
    assert request.method == "POST"
    assert b'"message": "warning"' in request.data
    response.close.assert_called_once()

    monkeypatch.setattr(remote_log_service.urllib.request, "urlopen", Mock(side_effect=OSError))
    remote_log_service._send("ignored failure", "Singer")

    thread = Mock()
    thread_class = Mock(return_value=thread)
    patch_attrs(
        monkeypatch,
        remote_log_service,
        _DISABLED=False,
        _current_online_name=lambda: "Singer",
    )
    monkeypatch.setattr(remote_log_service.threading, "Thread", thread_class)
    remote_log_service.send_diagnostic(" warning ")
    assert thread_class.call_args.kwargs["args"] == (" warning ", "Singer")
    assert thread_class.call_args.kwargs["daemon"] is True
    thread.start.assert_called_once()

    remote_log_service.send_diagnostic("   ")
    monkeypatch.setattr(remote_log_service, "_DISABLED", True)
    remote_log_service.send_diagnostic("disabled")
    assert thread_class.call_count == 1


def test_remote_name_fallback_and_log_handler(monkeypatch):
    from app.services import app_settings_service

    monkeypatch.setattr(app_settings_service, "read_settings", lambda: {"online_name": "  Singer  "})
    assert remote_log_service._current_online_name() == "Singer"
    monkeypatch.setattr(app_settings_service, "read_settings", Mock(side_effect=RuntimeError))
    monkeypatch.setattr(remote_log_service, "_persistent_device_id", lambda: "pc-fallback")
    assert remote_log_service._current_online_name() == "pc-fallback"

    sent = Mock()
    patch_attrs(monkeypatch, remote_log_service, _DISABLED=False, send_diagnostic=sent)
    handler = remote_log_service.RemoteErrorLogHandler()
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "boom", (), None))
    sent.assert_called_once_with("boom")

    monkeypatch.setattr(handler, "format", Mock(side_effect=ValueError))
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "bad", (), None))
    monkeypatch.setattr(remote_log_service, "_DISABLED", True)
    handler.emit(logging.LogRecord("test", logging.ERROR, __file__, 1, "off", (), None))
    assert sent.call_count == 1
