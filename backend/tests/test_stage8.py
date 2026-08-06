from pathlib import Path
from unittest.mock import Mock

from app.services import pipeline_service


def test_runtime_speed_factor_uses_completed_weighted_stages():
    assert pipeline_service._runtime_speed_factor({3.0: 240}) == 2.0


def test_runtime_speed_factor_keeps_default_without_enough_history():
    assert pipeline_service._runtime_speed_factor({1.0: 1}) == 1.0
    assert pipeline_service._runtime_speed_factor({999.0: 10}) == 1.0


def test_runtime_speed_factor_is_bounded():
    assert pipeline_service._runtime_speed_factor({3.0: 1}) == 0.25
    assert pipeline_service._runtime_speed_factor({3.0: 1000}) == 3.0


def test_remaining_seconds_never_returns_zero():
    assert pipeline_service._remaining_seconds(13.0, 1, 99, 1.0) == 1


def test_load_job_paths_closes_session(monkeypatch, tmp_path: Path):
    session = Mock()
    song = Mock(source_path="input.mp3", slug="slug")
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=session))
    monkeypatch.setattr(pipeline_service.repositories, "get_song", Mock(return_value=song))
    monkeypatch.setattr(pipeline_service.config, "SONG_OUTPUT_DIR", tmp_path)

    assert pipeline_service._load_job_paths("song") == ("input.mp3", tmp_path / "slug")
    session.close.assert_called_once_with()


def test_create_progress_capture_creates_log_directory(monkeypatch, tmp_path: Path):
    capture_type = Mock()
    monkeypatch.setattr(pipeline_service, "_ProgressCapture", capture_type)
    monkeypatch.setattr(pipeline_service.config, "LOGS_DIRNAME", "logs")

    pipeline_service._create_progress_capture("song", tmp_path)

    capture_type.assert_called_once_with("song", tmp_path / "logs" / "pipeline.log")
    assert (tmp_path / "logs").is_dir()
