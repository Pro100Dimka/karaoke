from unittest.mock import Mock

import database
from app.services import pipeline_service


def test_apply_additive_migrations_only_executes_missing_columns():
    connection = Mock()

    database._apply_additive_migrations(
        connection,
        {"already_there"},
        {"already_there": "SQL 1", "missing": "SQL 2"},
    )

    connection.execute.assert_called_once()
    assert str(connection.execute.call_args.args[0]) == "SQL 2"


def test_start_background_job_rejects_duplicate(monkeypatch):
    monkeypatch.setattr(pipeline_service, "is_processing", lambda _song_id: True)
    thread = Mock()
    monkeypatch.setattr(pipeline_service.threading, "Thread", thread)

    assert pipeline_service._start_background_job("song", lambda _song_id: None) is False
    thread.assert_not_called()


def test_start_background_job_registers_before_start(monkeypatch):
    pipeline_service._active_jobs.clear()
    monkeypatch.setattr(pipeline_service, "is_processing", lambda _song_id: False)
    worker = Mock()
    thread = Mock()
    thread.start.side_effect = lambda: assert_registered()

    def assert_registered():
        assert pipeline_service._active_jobs["song"] is thread

    monkeypatch.setattr(pipeline_service.threading, "Thread", Mock(return_value=thread))

    assert pipeline_service._start_background_job("song", worker) is True
    thread.start.assert_called_once_with()
    pipeline_service._active_jobs.clear()


def test_public_processing_starters_use_expected_workers(monkeypatch):
    starter = Mock(return_value=True)
    monkeypatch.setattr(pipeline_service, "_start_background_job", starter)

    assert pipeline_service.start_processing("a") is True
    starter.assert_called_once_with("a", pipeline_service._run_job)

    starter.reset_mock()
    assert pipeline_service.start_reprocessing("b") is True
    starter.assert_called_once_with("b", pipeline_service._run_reprocessing)


def test_start_background_job_releases_slot_when_thread_start_fails(monkeypatch):
    pipeline_service._active_jobs.clear()
    monkeypatch.setattr(pipeline_service, "is_processing", lambda _song_id: False)
    thread = Mock()
    thread.start.side_effect = RuntimeError("thread failed")
    monkeypatch.setattr(pipeline_service.threading, "Thread", Mock(return_value=thread))

    try:
        pipeline_service._start_background_job("song", Mock())
    except RuntimeError as exc:
        assert str(exc) == "thread failed"
    else:
        raise AssertionError("Expected thread startup failure")

    assert "song" not in pipeline_service._active_jobs
