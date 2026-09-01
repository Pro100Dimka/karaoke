from contextlib import suppress
from types import SimpleNamespace
from unittest.mock import Mock, call

from app.services import startup_service


def test_startup_runs_ordered_steps_and_only_then_opens_processing(monkeypatch):
    calls: list[str] = []
    runtime = SimpleNamespace(
        hardware=SimpleNamespace(
            cpu="cpu",
            logical_cores=4,
            ram_bytes=8,
            gpus=[],
            torch_available=False,
            cuda_available=False,
            cuda_version=None,
        ),
        selected={},
    )
    monkeypatch.setattr(startup_service.storage_migration, "migrate_legacy_song_storage", lambda: calls.append("migration"))
    monkeypatch.setattr(startup_service.resource_deletion, "recover_deferred_cleanup", lambda: calls.append("cleanup"))
    monkeypatch.setattr(startup_service.song_package_service, "recover_import_transactions", lambda: calls.append("package"))
    monkeypatch.setattr(startup_service.metadata_enrichment_service, "enqueue_missing", lambda: calls.append("metadata"))
    monkeypatch.setattr(startup_service.pipeline_service, "_configure_ai_runtime", lambda: calls.append("hardware") or runtime)
    monkeypatch.setattr(startup_service.pipeline_service, "format_runtime_plan", Mock(return_value=[]))
    stop, start = Mock(side_effect=lambda: calls.append("stop")), Mock(side_effect=lambda: calls.append("accept"))
    monkeypatch.setattr(startup_service.pipeline_service, "stop_accepting_jobs", stop)
    monkeypatch.setattr(startup_service.pipeline_service, "start_accepting_jobs", start)
    monkeypatch.setattr(startup_service, "_queue_hardware_snapshot", lambda _runtime: calls.append("snapshot"))

    def run_task(name, target):
        assert name == "backend-startup"
        target()
        return True

    monkeypatch.setattr(startup_service.background_task_supervisor, "start_task", run_task)

    assert startup_service.start() is True
    assert calls == ["stop", "cleanup", "migration", "package", "metadata", "hardware", "snapshot", "accept"]
    status = startup_service.snapshot()
    assert status["ready"] is True
    assert status["status"] == "ready"
    assert status["progress"] == 100
    assert list(status["steps"]) == [
        "file_cleanup_recovery", "storage_migration", "package_recovery", "metadata_scan",
        "hardware_detection", "diagnostics_snapshot",
    ]


def test_startup_failure_stays_closed_and_is_reported(monkeypatch):
    stop = Mock()
    monkeypatch.setattr(startup_service.pipeline_service, "stop_accepting_jobs", stop)
    monkeypatch.setattr(
        startup_service.storage_migration,
        "migrate_legacy_song_storage",
        Mock(side_effect=RuntimeError("disk failed")),
    )

    def run_task(_name, target):
        with suppress(RuntimeError):
            target()
        return True

    monkeypatch.setattr(startup_service.background_task_supervisor, "start_task", run_task)

    assert startup_service.start() is True
    assert stop.call_args_list == [call(), call()]
    status = startup_service.snapshot()
    assert status["ready"] is False
    assert status["status"] == "degraded"
    assert status["phase"] == "failed"
    assert status["error"] == "RuntimeError: disk failed"


def test_startup_budget_is_visible_without_claiming_readiness(monkeypatch):
    monkeypatch.setattr(startup_service, "_started_at", 10.0)
    monkeypatch.setattr(
        startup_service,
        "_state",
        {"phase": "storage_migration", "progress": 20, "ready": False, "error": None, "steps": {}},
    )
    monkeypatch.setattr(startup_service.time, "monotonic", Mock(return_value=50.0))
    monkeypatch.setattr(startup_service, "_budget_seconds", Mock(return_value=30.0))

    status = startup_service.snapshot()
    assert status["budget_exceeded"] is True
    assert status["status"] == "degraded"
    assert status["elapsed_ms"] == 40000.0


def test_parallel_start_does_not_reset_running_progress(monkeypatch):
    monkeypatch.setattr(startup_service, "_started_at", 10.0)
    monkeypatch.setattr(
        startup_service,
        "_state",
        {"phase": "package_recovery", "progress": 40, "ready": False, "error": None, "steps": {}},
    )
    start_task = Mock()
    monkeypatch.setattr(startup_service.background_task_supervisor, "start_task", start_task)

    assert startup_service.start() is False
    assert startup_service.snapshot()["phase"] == "package_recovery"
    start_task.assert_not_called()
