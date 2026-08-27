import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import models
from app.services import pipeline_service
from tests._shared import mock_song_lookup, patch_attrs, patch_many, raises


def test_runtime_configuration_applies_device_threads_and_torch(monkeypatch):
    configure = Mock()
    monkeypatch.setattr(pipeline_service.config, "configure_ai_resource_environment", configure)
    patch_attrs(monkeypatch, pipeline_service.app_settings_service, read_settings=Mock(return_value={'compute_mode': 'cpu', 'thread_count': 3}))
    torch = ModuleType("torch")
    torch.set_num_threads = Mock()
    monkeypatch.setitem(sys.modules, "torch", torch)
    assert pipeline_service._configure_ai_runtime().preference == "cpu"
    configure.assert_called_once_with(force=True)
    assert pipeline_service.os.environ["OMP_NUM_THREADS"] == "3"
    torch.set_num_threads.assert_called_once_with(3)



def test_runtime_test_override_wins_over_persisted_compute_mode(monkeypatch):
    monkeypatch.setattr(pipeline_service.config, "configure_ai_resource_environment", Mock())
    patch_attrs(monkeypatch, pipeline_service.app_settings_service, read_settings=Mock(return_value={'compute_mode': 'auto', 'thread_count': 2}))
    monkeypatch.setenv("KARAOKE_AI_RUNTIME_OVERRIDE", "cpu")
    torch = ModuleType("torch")
    torch.set_num_threads = Mock()
    monkeypatch.setitem(sys.modules, "torch", torch)

    plan = pipeline_service._configure_ai_runtime()

    assert (plan.preference, pipeline_service.os.environ['SONGAPP_DEVICE']) == ('cpu', 'cpu')


def test_audio_tags_and_source_metadata_fallbacks(monkeypatch):
    assert (pipeline_service._first_audio_tag(object(), 'title') is None) and (pipeline_service._first_audio_tag({'title': [None, ' Song ']}, 'title') == 'Song') and (pipeline_service._first_audio_tag({'title': None}, 'title') is None)
    current, mutagen = SimpleNamespace(source_path='source.wav', original_filename='Artist - Filename.wav', title='Requested', artist=None, genre=None), ModuleType('mutagen')
    mutagen.File = Mock(
        return_value={"title": ["Tagged"], "artist": ["Artist Tagged"], "genre": ["Rock"]}
    )
    monkeypatch.setitem(sys.modules, "mutagen", mutagen)
    pipeline_service._apply_source_metadata(current)
    assert (current.title, current.artist, current.genre) == ("Requested", None, "Rock")
    mutagen.File.side_effect = RuntimeError("bad tags")
    current.genre = None
    pipeline_service._apply_source_metadata(current)
    assert (current.title, current.artist, current.genre) == ("Requested", None, None)


def test_progress_capture_writes_steps_details_flush_close_and_cancel(monkeypatch, tmp_path):
    update, runtime_step, runtime_detail = Mock(), Mock(), Mock()
    patch_attrs(monkeypatch, pipeline_service, _update_progress=update, _set_runtime_step=runtime_step, _set_runtime_detail=runtime_detail, _is_cancelled=Mock(return_value=False))
    capture = pipeline_service._ProgressCapture("song", tmp_path / "pipeline.log")
    assert capture.write("3.5/13 separation\n") == len("3.5/13 separation\n")
    runtime_step.assert_called_once()
    update.assert_called_once_with("song", step_label="3.5/13", percent=28.0)
    capture.write("detail\n")
    runtime_detail.assert_called_once()
    capture.flush()
    capture.close()
    capture.close()
    raises(ValueError, lambda: capture.write('x'), match='closed')

    cancelled = pipeline_service._ProgressCapture("song", tmp_path / "cancelled.log")
    pipeline_service._is_cancelled.return_value = True
    raises(pipeline_service.ProcessingCancelled, lambda: cancelled.write('x'))
    cancelled.close()


def test_progress_math_and_runtime_stage_tracking(monkeypatch):
    assert (pipeline_service._percent_from_step('1') == 0) and (pipeline_service._percent_from_step('6.5') == 50) and (pipeline_service._percent_from_step('bad') == 0)
    times = iter([10.0, 12.0, 15.0, 20.0])
    patch_many(monkeypatch, (pipeline_service.time, "monotonic", lambda: next(times)), (pipeline_service, "_progress_runtime", {}))
    pipeline_service._set_runtime_step("song", 1, "1/13 Decode")
    pipeline_service._set_runtime_step("song", 1, "1/13 Repeated")
    pipeline_service._set_runtime_step("song", 2, "2/13 Separate")
    runtime = pipeline_service._progress_runtime["song"]
    assert (runtime['detail'], runtime['completed_step_seconds'][1.0]) == ('Separate', 5)

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
    assert (pipeline_service._runtime_speed_factor({}) == 1) and (pipeline_service._runtime_speed_factor({3: 240}) == 2) and (pipeline_service._runtime_speed_factor({3: 10000}) == 3) and (pipeline_service._runtime_speed_factor({3: 1}) == 0.25) and (pipeline_service._runtime_speed_factor({99: 5}) == 1) and (pipeline_service._remaining_seconds(13, 5, 10, 1) == 1)
    patch_many(monkeypatch, (pipeline_service.time, "monotonic", Mock(return_value=20)), (pipeline_service, "_progress_runtime", {}))
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
        "stage": "analysis",
        "direct_percent": 48,
        "stage_started_at": 10,
        "detail": "pitch",
        "completed_stage_seconds": {"decode": 10},
    }
    semantic = pipeline_service.get_processing_telemetry("semantic")
    assert semantic["semantic"] is True and 48 < semantic["progress_percent"] < 70
    pipeline_service._progress_runtime["semantic"]["completed_stage_seconds"] = {
        "decode": 300,
        "separate": 300,
    }
    # A slow GPU separation must not multiply the estimates for unrelated
    # CPU-bound lyrics/notes stages and make the displayed ETA jump upward.
    assert pipeline_service.get_processing_telemetry("semantic")["eta_seconds"] == semantic["eta_seconds"]
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
        "stage": "separate",
        "direct_percent": 10.0,
        "stage_started_at": 0.0,
        "detail": "separation",
        "completed_stage_seconds": {},
    }
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(return_value=20.0))
    at_20 = pipeline_service.get_processing_telemetry("song")["progress_percent"]
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(return_value=40.0))
    at_40 = pipeline_service.get_processing_telemetry("song")["progress_percent"]
    assert (10.0 < at_20 < 42.0) and (at_20 < at_40 < 42.0)

def test_update_progress_logs_but_still_applies_an_unexpected_transition(monkeypatch, caplog):
    current = SimpleNamespace(status=models.SongStatus.DONE)
    mock_song_lookup(monkeypatch, pipeline_service, current)
    monkeypatch.setattr(pipeline_service, "commit", Mock())
    with caplog.at_level("WARNING"):
        pipeline_service._update_progress("song", status=models.SongStatus.ERROR)
    assert current.status == models.SongStatus.ERROR  # applied despite DONE -> ERROR being invalid
    assert any(
        "song_id=song" in record.getMessage() and "done -> error" in record.getMessage()
        for record in caplog.records
    )


def test_update_progress_persists_fields_and_closes_database(monkeypatch):
    current = SimpleNamespace()
    database, _ = mock_song_lookup(monkeypatch, pipeline_service, current)
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
    telemetry, update = Mock(side_effect=[{'step': 2, 'progress_detail': 'detail', 'progress_percent': 10}, {'step': 3, 'progress_detail': 'semantic', 'progress_percent': 20, 'semantic': True}, RuntimeError('db')]), Mock()
    patch_attrs(monkeypatch, pipeline_service, get_processing_telemetry=telemetry, _update_progress=update)
    pipeline_service._progress_heartbeat("song", stop)
    assert (update.call_args_list[0].kwargs['step_label'].startswith('2/13')) and (update.call_args_list[1].kwargs['step_label'] == 'semantic')


def test_job_registry_start_cancel_release_and_cleanup(monkeypatch):
    alive = Mock(is_alive=Mock(return_value=True))
    patch_attrs(monkeypatch, pipeline_service, _active_jobs={'song': alive}, _cancelled_jobs=set())
    assert (pipeline_service.is_processing('song') is True) and (pipeline_service._start_background_job('song', Mock()) is False)
    update = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    assert (pipeline_service.cancel_processing('song') is True) and (pipeline_service._is_cancelled('song') is True) and (pipeline_service.cancel_processing('missing') is False)

    thread = Mock()
    monkeypatch.setattr(pipeline_service.threading, "Thread", Mock(return_value=thread))
    pipeline_service._active_jobs = {}
    assert pipeline_service.start_processing("new") is True
    thread.start.assert_called_once()
    pipeline_service._active_jobs = {}
    assert pipeline_service.start_reprocessing("new") is True
    thread.start.side_effect = RuntimeError("cannot start")
    pipeline_service._active_jobs = {}
    raises(RuntimeError, lambda: pipeline_service._start_background_job('bad', Mock()))
    assert "bad" not in pipeline_service._active_jobs


def test_cancel_all_active_processing_cancels_only_alive_jobs(monkeypatch):
    alive_a, alive_b = Mock(is_alive=Mock(return_value=True)), Mock(is_alive=Mock(return_value=True))
    dead = Mock(is_alive=Mock(return_value=False))
    patch_attrs(
        monkeypatch, pipeline_service,
        _active_jobs={"a": alive_a, "b": alive_b, "gone": dead}, _cancelled_jobs=set(),
    )
    update = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)

    assert pipeline_service.cancel_all_active_processing() == 2
    assert pipeline_service._cancelled_jobs == {"a", "b"}


def test_job_entrypoint_releases_runtime_and_cuda_cache(monkeypatch):
    target, current = Mock(side_effect=RuntimeError('worker failed')), Mock()
    monkeypatch.setattr(pipeline_service.threading, "current_thread", Mock(return_value=current))
    patch_attrs(monkeypatch, pipeline_service, _active_jobs={'song': current, 'other': Mock()}, _cancelled_jobs={'song'})
    collect = Mock()
    monkeypatch.setattr(pipeline_service.gc, "collect", collect)
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock()))
    monkeypatch.setitem(sys.modules, "torch", torch)
    raises(RuntimeError, lambda: pipeline_service._job_entrypoint('song', target))
    assert ('song' not in pipeline_service._active_jobs) and ('song' not in pipeline_service._cancelled_jobs)
    # Stage-specific model cleanup may release CUDA more than once before the
    # final worker-boundary sweep; both operations must happen at least once.
    assert collect.call_count >= 1
    assert torch.cuda.empty_cache.call_count >= 1
    pipeline_service._release_active_job("other")
    assert "other" in pipeline_service._active_jobs
