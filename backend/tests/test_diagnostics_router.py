from unittest.mock import Mock

from app.routers import diagnostics


def test_shutdown_waits_for_active_processing_and_reports_lingering_jobs(monkeypatch):
    pipeline_result = {"requested": 2, "finished": 2, "lingering": []}
    background_result = {"requested": 1, "finished": 1, "lingering": []}
    pipeline_shutdown = Mock(return_value=pipeline_result)
    background_shutdown = Mock(return_value=background_result)
    stop = Mock()
    monkeypatch.setattr(diagnostics.pipeline_service, "shutdown_active_processing", pipeline_shutdown)
    monkeypatch.setattr(diagnostics.background_task_supervisor, "stop_accepting", stop)
    monkeypatch.setattr(diagnostics.background_task_supervisor, "shutdown", background_shutdown)
    assert diagnostics.shutdown() == {
        "pipeline": pipeline_result,
        "background": background_result,
    }
    stop.assert_called_once_with()
    pipeline_shutdown.assert_called_once_with(timeout=10.0)
    background_shutdown.assert_called_once_with(timeout=10.0)
