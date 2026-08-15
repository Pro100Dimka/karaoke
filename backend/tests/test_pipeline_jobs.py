from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import pipeline_service
from app.utils.json_files import write_json


def test_load_job_paths_handles_missing_default_and_persisted_output(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lookup)
    assert pipeline_service._load_job_paths("missing") is None
    database.close.assert_called_once_with()

    current = SimpleNamespace(source_path="source.wav", output_dir=None, slug="song")
    lookup.return_value = current
    monkeypatch.setattr(pipeline_service.config, "SONG_OUTPUT_DIR", tmp_path)
    assert pipeline_service._load_job_paths("song") == ("source.wav", tmp_path / "song")
    current.output_dir = str(tmp_path / "output")
    monkeypatch.setattr(
        pipeline_service.song_service,
        "resolve_output_dir",
        Mock(return_value=tmp_path / "resolved"),
    )
    assert pipeline_service._load_job_paths("song")[1] == tmp_path / "resolved"


def test_load_ai_inputs_respects_trusted_nonempty_text_and_edit_flags(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lookup)
    assert pipeline_service._load_ai_inputs("missing", tmp_path) == (None, None, None)
    current = SimpleNamespace(
        tempo_override=120,
        key_override=" C ",
        tempo_user_edited=True,
        key_user_edited=True,
    )
    lookup.return_value = current
    trusted = tmp_path / pipeline_service.config.TRUSTED_LYRICS_FILENAME
    trusted.write_text("lyrics", encoding="utf-8")
    assert pipeline_service._load_ai_inputs("song", tmp_path) == (trusted, 120.0, "C")
    trusted.write_text(" ", encoding="utf-8")
    current.tempo_user_edited = False
    current.key_user_edited = False
    assert pipeline_service._load_ai_inputs("song", tmp_path) == (None, None, None)


def test_load_searchable_title_prefers_artist_title_and_closes(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lookup)
    assert pipeline_service._load_searchable_title("missing") is None
    current = SimpleNamespace(source_path="x", original_filename="x.wav", title="Request")
    lookup.return_value = current
    identity = Mock(return_value=("Artist", "Title"))
    monkeypatch.setattr(pipeline_service.song_service, "_read_source_identity", identity)
    assert pipeline_service._load_searchable_title("song") == "Artist - Title"
    identity.return_value = (None, "Title")
    assert pipeline_service._load_searchable_title("song") == "Title"
    identity.return_value = (None, "")
    assert pipeline_service._load_searchable_title("song") is None


def test_heartbeat_capture_start_stop_and_error_helpers(monkeypatch, tmp_path):
    event = Mock()
    thread = Mock()
    monkeypatch.setattr(pipeline_service.threading, "Event", Mock(return_value=event))
    monkeypatch.setattr(pipeline_service.threading, "Thread", Mock(return_value=thread))
    assert pipeline_service._start_progress_heartbeat("song") == (event, thread)
    thread.start.assert_called_once_with()

    capture = pipeline_service._create_progress_capture("song", tmp_path)
    capture.close()
    assert (tmp_path / pipeline_service.config.LOGS_DIRNAME / "pipeline.log").exists()
    pipeline_service._stop_progress_heartbeat(None, thread)
    current = Mock()
    monkeypatch.setattr(pipeline_service.threading, "current_thread", Mock(return_value=current))
    pipeline_service._stop_progress_heartbeat(event, current)
    event.set.assert_called_once_with()
    pipeline_service._stop_progress_heartbeat(event, thread)
    thread.join.assert_called_once_with(timeout=2.0)

    assert pipeline_service._format_processing_error(ValueError("bad")) == "ValueError: bad"
    assert pipeline_service._format_processing_error(RuntimeError()) == "RuntimeError"
    logger = Mock()
    monkeypatch.setattr(pipeline_service, "logger", logger)
    pipeline_service._write_pipeline_error(None, RuntimeError("bad"))
    logger.exception.assert_called_once()
    writer = Mock()
    pipeline_service._write_pipeline_error(writer, RuntimeError("bad"))
    writer.write.assert_called_once()
    writer.write.side_effect = OSError("disk")
    pipeline_service._write_pipeline_error(writer, RuntimeError("bad"))


def test_ai_progress_callback_updates_semantic_runtime_and_cancels(monkeypatch):
    monkeypatch.setattr(pipeline_service, "_progress_runtime", {})
    pipeline_service._begin_runtime_progress("song")
    monkeypatch.setattr(pipeline_service, "_is_cancelled", Mock(return_value=False))
    monkeypatch.setattr(pipeline_service.time, "monotonic", Mock(side_effect=[10, 20]))
    update = Mock()
    capture = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    callback = pipeline_service._create_ai_progress_callback("song", capture)
    callback("decode", -10, "raw")
    callback("unknown", 200, "raw")
    runtime = pipeline_service._progress_runtime["song"]
    assert runtime["direct_percent"] == 99.7
    assert runtime["completed_stage_seconds"]["decode"] == 10
    assert capture.write.call_count == 2
    pipeline_service._is_cancelled.return_value = True
    with pytest.raises(pipeline_service.ProcessingCancelled):
        callback("pitch", 50, "raw")


def test_force_midi_rebuild_invalidates_cache_and_files(monkeypatch, tmp_path):
    cache = Mock()
    monkeypatch.setattr(pipeline_service, "StageCache", Mock(return_value=cache))
    for name in pipeline_service._MIDI_REBUILD_FILES:
        (tmp_path / name).write_text("x", encoding="utf-8")
    pipeline_service._force_midi_rebuild(tmp_path)
    cache.invalidate.assert_called_once_with("pitch", "derivation", "midi", "song-map")
    assert not any((tmp_path / name).exists() for name in pipeline_service._MIDI_REBUILD_FILES)


def test_reprocessing_validates_owned_direct_child_and_runs_job(monkeypatch, tmp_path):
    database = Mock()
    current = SimpleNamespace()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lookup)
    pipeline_service._run_reprocessing("missing")
    database.close.assert_called()

    lookup.return_value = current
    root = tmp_path / "library"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setattr(pipeline_service.config, "SONG_OUTPUT_DIR", root)
    resolve = Mock(return_value=outside)
    monkeypatch.setattr(pipeline_service.song_service, "resolve_output_dir", resolve)
    update = Mock()
    monkeypatch.setattr(pipeline_service, "_update_progress", update)
    pipeline_service._run_reprocessing("song")
    assert update.call_args.kwargs["status"] == models.SongStatus.ERROR

    target = root / "song"
    target.mkdir()
    resolve.return_value = target
    rebuild = Mock()
    run = Mock()
    monkeypatch.setattr(pipeline_service, "_force_midi_rebuild", rebuild)
    monkeypatch.setattr(pipeline_service, "_run_job", run)
    pipeline_service._run_reprocessing("song")
    rebuild.assert_called_once_with(target)
    run.assert_called_once_with("song")


def test_optional_json_and_generated_metadata_preserve_user_edits(monkeypatch, tmp_path):
    assert pipeline_service._read_optional_generated_json(tmp_path / "missing", {"d": 1}) == {
        "d": 1
    }
    monkeypatch.setattr(
        pipeline_service,
        "read_json",
        Mock(side_effect=ValueError("bad json")),
    )
    assert pipeline_service._read_optional_generated_json(tmp_path / "bad", []) == []

    write_json(tmp_path / "music.json", {"key": "C", "bpm": 120.4})
    write_json(
        tmp_path / "reference.json",
        {"notes": [None, {"midi_note": 50}, {"midi": "70"}]},
    )
    monkeypatch.setattr(
        pipeline_service,
        "read_json",
        __import__("app.utils.json_files", fromlist=["read_json"]).read_json,
    )
    current = SimpleNamespace(
        key_override=None,
        tempo_override=None,
        key_user_edited=False,
        tempo_user_edited=False,
        note_range_min=None,
        note_range_max=None,
    )
    pipeline_service._apply_generated_metadata(current, tmp_path)
    assert (current.key_override, current.tempo_override) == ("C", 120)
    assert (current.note_range_min, current.note_range_max) == (50, 70)

    current.key_override = "D"
    current.tempo_override = 100
    current.key_user_edited = True
    current.tempo_user_edited = True
    current.note_range_min = 40
    current.note_range_max = 80
    pipeline_service._apply_generated_metadata(current, tmp_path)
    assert (current.key_override, current.tempo_override, current.note_range_min) == ("D", 100, 40)

    write_json(tmp_path / "reference.json", {"notes": [{"midi": "bad"}]})
    pipeline_service._apply_generated_metadata(current, tmp_path)
    write_json(tmp_path / "reference.json", {"notes": []})
    pipeline_service._apply_generated_metadata(current, tmp_path)
    write_json(tmp_path / "reference.json", {"notes": "bad"})
    pipeline_service._apply_generated_metadata(current, tmp_path)


def test_finalize_success_commits_metadata_and_best_effort_optimization(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(pipeline_service, "SessionLocal", Mock(return_value=database))
    current = SimpleNamespace()
    lookup = Mock(return_value=current)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lookup)
    metadata = Mock()
    generated = Mock()
    commit = Mock()
    optimize = Mock(side_effect=RuntimeError("optional failure"))
    monkeypatch.setattr(pipeline_service, "_apply_source_metadata", metadata)
    monkeypatch.setattr(pipeline_service, "_apply_generated_metadata", generated)
    monkeypatch.setattr(pipeline_service, "commit", commit)
    monkeypatch.setattr(pipeline_service.cache_service, "optimize_song_files", optimize)
    pipeline_service._finalize_success("song", tmp_path)
    assert current.status == models.SongStatus.DONE and current.progress_percent == 100
    commit.assert_called_once_with(database)
    database.close.assert_called_once()
    lookup.return_value = None
    pipeline_service._finalize_success("missing", tmp_path)


def test_run_job_orchestrates_success_cancel_error_and_finalization(monkeypatch, tmp_path):
    monkeypatch.setattr(
        pipeline_service, "_load_job_paths", Mock(return_value=("source", tmp_path))
    )
    monkeypatch.setattr(pipeline_service, "_load_searchable_title", Mock(return_value="Title"))
    monkeypatch.setattr(pipeline_service, "_load_ai_inputs", Mock(return_value=(None, None, None)))
    monkeypatch.setattr(pipeline_service, "_is_cancelled", Mock(return_value=False))
    monkeypatch.setattr(pipeline_service, "_update_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_begin_runtime_progress", Mock())
    monkeypatch.setattr(
        pipeline_service,
        "_start_progress_heartbeat",
        Mock(return_value=(Mock(), Mock())),
    )
    capture = Mock()
    monkeypatch.setattr(pipeline_service, "_create_progress_capture", Mock(return_value=capture))
    monkeypatch.setattr(pipeline_service.model_install_service, "ensure_ready_sync", Mock())
    monkeypatch.setattr(pipeline_service, "_configure_ai_runtime", Mock(return_value="cpu"))
    monkeypatch.setattr(pipeline_service, "format_runtime_plan", Mock(return_value=("CPU",)))
    monkeypatch.setattr(pipeline_service, "_create_ai_progress_callback", Mock(return_value=Mock()))
    process = Mock()
    monkeypatch.setattr(pipeline_service.ai_bridge, "process_song", process)
    monkeypatch.setattr(pipeline_service, "_stop_progress_heartbeat", Mock())
    monkeypatch.setattr(pipeline_service, "_end_runtime_progress", Mock())
    finalize = Mock()
    monkeypatch.setattr(pipeline_service, "_finalize_success", finalize)
    pipeline_service._run_job("song")
    process.assert_called_once()
    finalize.assert_called_once_with("song", tmp_path)
    capture.close.assert_called_once()

    pipeline_service._load_job_paths.return_value = None
    pipeline_service._run_job("missing")
    pipeline_service._load_job_paths.return_value = ("source", tmp_path)
    pipeline_service._is_cancelled.return_value = True
    pipeline_service._run_job("cancel-before")

    pipeline_service._is_cancelled.return_value = False
    process.side_effect = pipeline_service.ProcessingCancelled()
    pipeline_service._run_job("cancel")
    assert (
        pipeline_service._update_progress.call_args.kwargs["status"] == models.SongStatus.CANCELLED
    )

    process.side_effect = RuntimeError("AI failed")
    writer = Mock()
    monkeypatch.setattr(pipeline_service, "_write_pipeline_error", writer)
    pipeline_service._run_job("error")
    assert pipeline_service._update_progress.call_args.kwargs["status"] == models.SongStatus.ERROR
    writer.assert_called()

    pipeline_service._is_cancelled.side_effect = [False, True]
    pipeline_service._run_job("cancel-error")
    assert (
        pipeline_service._update_progress.call_args.kwargs["status"] == models.SongStatus.CANCELLED
    )


def test_run_job_maps_finalization_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(
        pipeline_service, "_load_job_paths", Mock(return_value=("source", tmp_path))
    )
    monkeypatch.setattr(pipeline_service, "_load_searchable_title", Mock(return_value=None))
    monkeypatch.setattr(pipeline_service, "_load_ai_inputs", Mock(return_value=(None, None, None)))
    monkeypatch.setattr(pipeline_service, "_is_cancelled", Mock(return_value=False))
    monkeypatch.setattr(pipeline_service, "_update_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_begin_runtime_progress", Mock())
    monkeypatch.setattr(
        pipeline_service, "_start_progress_heartbeat", Mock(return_value=(None, None))
    )
    capture = Mock()
    monkeypatch.setattr(pipeline_service, "_create_progress_capture", Mock(return_value=capture))
    monkeypatch.setattr(pipeline_service.model_install_service, "ensure_ready_sync", Mock())
    monkeypatch.setattr(pipeline_service, "_configure_ai_runtime", Mock(return_value="cpu"))
    monkeypatch.setattr(pipeline_service, "format_runtime_plan", Mock(return_value=("CPU",)))
    monkeypatch.setattr(pipeline_service, "_create_ai_progress_callback", Mock(return_value=Mock()))
    monkeypatch.setattr(pipeline_service.ai_bridge, "process_song", Mock())
    monkeypatch.setattr(pipeline_service, "_stop_progress_heartbeat", Mock())
    monkeypatch.setattr(pipeline_service, "_end_runtime_progress", Mock())
    monkeypatch.setattr(
        pipeline_service,
        "_finalize_success",
        Mock(side_effect=RuntimeError("commit failed")),
    )
    pipeline_service._run_job("song")
    assert pipeline_service._update_progress.call_args.kwargs["status"] == models.SongStatus.ERROR
