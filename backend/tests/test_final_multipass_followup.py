import asyncio
from pathlib import Path
from unittest.mock import Mock

from fastapi import UploadFile

from app.services import pipeline_service
from app.utils.uploads import save_upload_limited


def test_progress_capture_close_is_idempotent(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(pipeline_service, "_is_cancelled", lambda song_id: False)
    capture = pipeline_service._ProgressCapture("song", tmp_path / "pipeline.log")
    capture.write("hello")
    capture.close()
    capture.close()


def test_progress_heartbeat_survives_transient_database_error(monkeypatch):
    stop_event = Mock()
    stop_event.wait.side_effect = [False, False, True]
    monkeypatch.setattr(
        pipeline_service,
        "get_processing_telemetry",
        lambda song_id: {"step": 1.0, "progress_detail": "x", "progress_percent": 2.0},
    )
    update = Mock(side_effect=[RuntimeError("locked"), None])
    monkeypatch.setattr(pipeline_service, "_update_progress", update)

    pipeline_service._progress_heartbeat("song", stop_event)

    assert update.call_count == 2


def test_save_upload_limited_flushes_and_syncs(tmp_path: Path, monkeypatch):
    upload = UploadFile(filename="song.wav", file=__import__("io").BytesIO(b"abcd"))
    fsync = Mock()
    monkeypatch.setattr("app.utils.uploads.os.fsync", fsync)

    result = asyncio.run(
        save_upload_limited(upload, tmp_path / "song.tmp", limit=4, chunk_size=2)
    )

    assert result == 4
    fsync.assert_called_once()


def test_concurrent_settings_updates_do_not_lose_fields(tmp_path: Path, monkeypatch):
    import threading
    from app.services import app_settings_service

    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", tmp_path / "settings.json")
    barrier = threading.Barrier(3)
    errors = []

    def update(patch):
        try:
            barrier.wait()
            app_settings_service.update_settings(patch)
        except Exception as exc:  # pragma: no cover - assertion reports thread errors
            errors.append(exc)

    first = threading.Thread(target=update, args=({"theme": "light"},))
    second = threading.Thread(target=update, args=({"language": "uk"},))
    first.start()
    second.start()
    barrier.wait()
    first.join()
    second.join()

    assert not errors
    settings = app_settings_service.read_settings()
    assert settings["theme"] == "light"
    assert settings["language"] == "uk"
