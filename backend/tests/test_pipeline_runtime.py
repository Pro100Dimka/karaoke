import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import pipeline_service


def test_runtime_configuration_applies_device_threads_and_torch(monkeypatch):
    configure = Mock()
    monkeypatch.setattr(pipeline_service.config, "configure_ai_resource_environment", configure)
    monkeypatch.setattr(
        pipeline_service.app_settings_service,
        "read_settings",
        Mock(return_value={"compute_mode": "cpu", "thread_count": 3}),
    )
    torch = ModuleType("torch")
    torch.set_num_threads = Mock()
    monkeypatch.setitem(sys.modules, "torch", torch)
    assert pipeline_service._configure_ai_runtime().preference == "cpu"
    configure.assert_called_once_with(force=True)
    assert pipeline_service.os.environ["OMP_NUM_THREADS"] == "3"
    torch.set_num_threads.assert_called_once_with(3)



def test_runtime_test_override_wins_over_persisted_compute_mode(monkeypatch):
    monkeypatch.setattr(pipeline_service.config, "configure_ai_resource_environment", Mock())
    monkeypatch.setattr(
        pipeline_service.app_settings_service,
        "read_settings",
        Mock(return_value={"compute_mode": "auto", "thread_count": 2}),
    )
    monkeypatch.setenv("KARAOKE_AI_RUNTIME_OVERRIDE", "cpu")
    torch = ModuleType("torch")
    torch.set_num_threads = Mock()
    monkeypatch.setitem(sys.modules, "torch", torch)

    plan = pipeline_service._configure_ai_runtime()

    assert plan.preference == "cpu"
    assert pipeline_service.os.environ["SONGAPP_DEVICE"] == "cpu"


def test_audio_tags_and_source_metadata_fallbacks(monkeypatch):
    assert pipeline_service._first_audio_tag(object(), "title") is None
    assert pipeline_service._first_audio_tag({"title": [None, " Song "]}, "title") == "Song"
    assert pipeline_service._first_audio_tag({"title": None}, "title") is None
    current = SimpleNamespace(
        source_path="source.wav",
        original_filename="Artist - Filename.wav",
        title="Requested",
        artist=None,
        genre=None,
    )
    mutagen = ModuleType("mutagen")
    mutagen.File = Mock(
        return_value={"title": ["Tagged"], "artist": ["Artist Tagged"], "genre": ["Rock"]}
    )
    monkeypatch.setitem(sys.modules, "mutagen", mutagen)
    pipeline_service._apply_source_metadata(current)
    assert (current.title, current.artist, current.genre) == ("Tagged", "Artist", "Rock")
    mutagen.File.side_effect = RuntimeError("bad tags")
    current.title = ""
    current.artist = None
    current.genre = None
    pipeline_service._apply_source_metadata(current)
    assert (current.artist, current.title) == ("Artist", "Filename")
    current.original_filename = "Plain.wav"
    current.title = ""
    pipeline_service._apply_source_metadata(current)
    assert current.title == "Plain"


def test_progress_capture_writes_steps_details_flush_close_and_cancel(monkeypatch, tmp_path):
    update = Mock()
    runtime_step = Mock()
    runtime_detail = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    monkeypatch.setattr(pipeline_service, "_set_runtime_step", runtime_step)
    monkeypatch.setattr(pipeline_service, "_set_runtime_detail", runtime_detail)
    monkeypatch.setattr(pipeline_service, "_is_cancelled", Mock(return_value=False))
    capture = pipeline_service._ProgressCapture("song", tmp_path / "pipeline.log")
    assert capture.write("3.5/13 separation\n") == len("3.5/13 separation\n")
    runtime_step.assert_called_once()
    update.assert_called_once_with("song", step_label="3.5/13", percent=28.0)
    capture.write("detail\n")
    runtime_detail.assert_called_once()
    capture.flush()
    capture.close()
    capture.close()
    with pytest.raises(ValueError, match="closed"):
        capture.write("x")

    cancelled = pipeline_service._ProgressCapture("song", tmp_path / "cancelled.log")
    pipeline_service._is_cancelled.return_value = True
    with pytest.raises(pipeline_service.ProcessingCancelled):
        cancelled.write("x")
    cancelled.close()


def test_progress_math_and_runtime_stage_tracking(monkeypatch):
    assert pipeline_service._percent_from_step("1") == 0
    assert pipeline_service._percent_from_step("6.5") == 50
    assert pipeline_service._percent_from_step("bad") == 0
    times = iter([10.0, 12.0, 15.0, 20.0])
    monkeypatch.setattr(pipeline_service.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(pipeline_service, "_progress_runtime", {})
    pipeline_service._set_runtime_step("song", 1, "1/13 Decode")
    pipeline_service._set_runtime_step("song", 1, "1/13 Repeated")
    pipeline_service._set_runtime_step("song", 2, "2/13 Separate")
    runtime = pipeline_service._progress_runtime["song"]
    assert runtime["detail"] == "Separate"
    assert runtime["completed_step_seconds"][1.0] == 5

    pipeline_service._set_runtime_detail("missing", "detail")
    pipeline_service._set_runtime_detail("song", "warning internal")
    runtime["direct_percent"] = 2
    pipeline_service._set_runtime_detail("song", "visible")
    assert runtime["detail"] == "Separate"
    runtime.pop("direct_percent")
    pipeline_service._set_runtime_detail("song", "visible")
    assert runtime["detail"] == "visible"
    pipeline_service._begin_runtime_progress("other")
    assert "other" in pipeline_service._progress_runtime
    pipeline_service._end_runtime_progress("other")
    assert "other" not in pipeline_service._progress_runtime


def test_speed_eta_and_telemetry_legacy_and_semantic(monkeypatch):
    assert pipeline_service._runtime_speed_factor({}) == 1
    assert pipeline_service._runtime_speed_factor({3: 240}) == 2
    assert pipeline_service._runtime_speed_factor({3: 10000}) == 3
    assert pipeline_service._runtime_speed_factor({3: 1}) == 0.25
    assert pipeline_service._runtime_speed_factor({99: 5}) == 1
    assert pipeline_service._remaining_seconds(13, 5, 10, 1) == 1
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(return_value=20))
    monkeypatch.setattr(pipeline_service, "_progress_runtime", {})
    assert pipeline_service.get_processing_telemetry("missing") == {}
    pipeline_service._progress_runtime["zero"] = {"step": 0, "detail": "prepare"}
    assert pipeline_service.get_processing_telemetry("zero")["eta_seconds"] is None
    pipeline_service._progress_runtime["legacy"] = {
        "step": 3,
        "step_started_at": 10,
        "detail": "separate",
        "completed_step_seconds": {2: 12},
    }
    legacy = pipeline_service.get_processing_telemetry("legacy")
    assert legacy["step"] == 3 and legacy["eta_seconds"] > 0

    pipeline_service._progress_runtime["semantic"] = {
        "step": 4,
        "stage": "pitch",
        "direct_percent": 55,
        "stage_started_at": 10,
        "detail": "pitch",
        "completed_stage_seconds": {"decode": 10},
    }
    semantic = pipeline_service.get_processing_telemetry("semantic")
    assert semantic["semantic"] is True and 55 < semantic["progress_percent"] < 70
    pipeline_service._progress_runtime["unknown"] = {
        "stage": "other",
        "direct_percent": 99,
        "stage_started_at": 10,
        "detail": "other",
    }
    assert pipeline_service.get_processing_telemetry("unknown")["eta_seconds"] >= 1



def test_semantic_progress_keeps_advancing_for_long_separation(monkeypatch):
    monkeypatch.setattr(pipeline_service, "_progress_runtime", {})
    pipeline_service._progress_runtime["song"] = {
        "stage": "separation",
        "direct_percent": 8.0,
        "stage_started_at": 0.0,
        "detail": "separation",
        "completed_stage_seconds": {},
    }
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(return_value=140.0))
    at_140 = pipeline_service.get_processing_telemetry("song")["progress_percent"]
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(return_value=220.0))
    at_220 = pipeline_service.get_processing_telemetry("song")["progress_percent"]
    assert 8.0 < at_140 < 48.0
    assert at_140 < at_220 < 48.0

def test_update_progress_persists_fields_and_closes_database(monkeypatch):
    database = Mock()
    current = SimpleNamespace()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    monkeypatch.setattr(pipeline_service.repositories, "get_song", Mock(return_value=current))
    commit = Mock()
    monkeypatch.setattr(pipeline_service, "commit", commit)
    pipeline_service._update_progress("song", "step", 42, models.SongStatus.PROCESSING, "error")
    assert (
        current.progress_step,
        current.progress_percent,
        current.status,
        current.error_message,
    ) == (
        "step",
        42,
        models.SongStatus.PROCESSING,
        "error",
    )
    commit.assert_called_once_with(database)
    database.close.assert_called_once_with()
    pipeline_service.repositories.get_song.return_value = None
    pipeline_service._update_progress("missing")


def test_heartbeat_persists_semantic_and_legacy_and_survives_errors(monkeypatch):
    stop = Mock()
    stop.wait.side_effect = [False, False, False, True]
    telemetry = Mock(
        side_effect=[
            {"step": 2, "progress_detail": "detail", "progress_percent": 10},
            {"step": 3, "progress_detail": "semantic", "progress_percent": 20, "semantic": True},
            RuntimeError("db"),
        ]
    )
    update = Mock()
    monkeypatch.setattr(pipeline_service, "get_processing_telemetry", telemetry)
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    pipeline_service._progress_heartbeat("song", stop)
    assert update.call_args_list[0].kwargs["step_label"].startswith("2/13")
    assert update.call_args_list[1].kwargs["step_label"] == "semantic"


def test_job_registry_start_cancel_release_and_cleanup(monkeypatch):
    alive = Mock(is_alive=Mock(return_value=True))
    monkeypatch.setattr(pipeline_service, "_active_jobs", {"song": alive})
    monkeypatch.setattr(pipeline_service, "_cancelled_jobs", set())
    assert pipeline_service.is_processing("song") is True
    assert pipeline_service._start_background_job("song", Mock()) is False
    update = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    assert pipeline_service.cancel_processing("song") is True
    assert pipeline_service._is_cancelled("song") is True
    assert pipeline_service.cancel_processing("missing") is False

    thread = Mock()
    monkeypatch.setattr(pipeline_service.threading, "Thread", Mock(return_value=thread))
    pipeline_service._active_jobs = {}
    assert pipeline_service.start_processing("new") is True
    thread.start.assert_called_once()
    pipeline_service._active_jobs = {}
    assert pipeline_service.start_reprocessing("new") is True
    thread.start.side_effect = RuntimeError("cannot start")
    pipeline_service._active_jobs = {}
    with pytest.raises(RuntimeError):
        pipeline_service._start_background_job("bad", Mock())
    assert "bad" not in pipeline_service._active_jobs


def test_job_entrypoint_releases_runtime_and_cuda_cache(monkeypatch):
    target = Mock(side_effect=RuntimeError("worker failed"))
    current = Mock()
    monkeypatch.setattr(pipeline_service.threading, "current_thread", Mock(return_value=current))
    monkeypatch.setattr(pipeline_service, "_active_jobs", {"song": current, "other": Mock()})
    monkeypatch.setattr(pipeline_service, "_cancelled_jobs", {"song"})
    collect = Mock()
    monkeypatch.setattr(pipeline_service.gc, "collect", collect)
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock()))
    monkeypatch.setitem(sys.modules, "torch", torch)
    with pytest.raises(RuntimeError):
        pipeline_service._job_entrypoint("song", target)
    assert "song" not in pipeline_service._active_jobs
    assert "song" not in pipeline_service._cancelled_jobs
    collect.assert_called_once()
    torch.cuda.empty_cache.assert_called_once()
    pipeline_service._release_active_job("other")
    assert "other" in pipeline_service._active_jobs
