from pathlib import Path
from unittest.mock import Mock

import models
from app.services import pipeline_service


def _prepare_worker(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        pipeline_service,
        "_load_job_paths",
        lambda song_id: (str(tmp_path / "song.mp3"), tmp_path / "output"),
    )
    monkeypatch.setattr(pipeline_service, "_is_cancelled", lambda song_id: False)
    monkeypatch.setattr(pipeline_service, "_begin_runtime_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_end_runtime_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_release_active_job", Mock())
    update = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    return update


def test_run_job_cleans_up_when_log_creation_fails(monkeypatch, tmp_path: Path):
    update = _prepare_worker(monkeypatch, tmp_path)
    stop_event = Mock()
    heartbeat = Mock()
    monkeypatch.setattr(
        pipeline_service,
        "_start_progress_heartbeat",
        lambda song_id: (stop_event, heartbeat),
    )
    monkeypatch.setattr(
        pipeline_service,
        "_create_progress_capture",
        Mock(side_effect=OSError("disk full")),
    )

    pipeline_service._run_job("song")

    stop_event.set.assert_called_once_with()
    heartbeat.join.assert_called_once_with(timeout=2.0)
    pipeline_service._end_runtime_progress.assert_called_once_with("song")
    pipeline_service._release_active_job.assert_not_called()
    assert update.call_args_list[-1].kwargs == {
        "status": models.SongStatus.ERROR,
        "error_message": "disk full",
    }


def test_stop_progress_heartbeat_accepts_partial_setup():
    pipeline_service._stop_progress_heartbeat(None, None)


def test_write_pipeline_error_is_safe_without_capture():
    pipeline_service._write_pipeline_error(None, RuntimeError("boom"))


def test_stop_progress_heartbeat_sets_event_and_joins():
    stop_event = Mock()
    thread = Mock()

    pipeline_service._stop_progress_heartbeat(stop_event, thread)

    stop_event.set.assert_called_once_with()
    thread.join.assert_called_once_with(timeout=2.0)
