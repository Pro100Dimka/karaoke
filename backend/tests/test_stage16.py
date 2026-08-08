from unittest.mock import Mock

from app.services import pipeline_service


def test_job_entrypoint_clears_cancel_marker(monkeypatch):
    current = Mock()
    pipeline_service._active_jobs.clear()
    pipeline_service._cancelled_jobs.clear()
    pipeline_service._active_jobs["song"] = current
    pipeline_service._cancelled_jobs.add("song")
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: current)

    pipeline_service._job_entrypoint("song", Mock())

    assert "song" not in pipeline_service._active_jobs
    assert "song" not in pipeline_service._cancelled_jobs


def test_run_job_does_not_release_slot_before_caller_finishes(monkeypatch, tmp_path):
    current = Mock()
    pipeline_service._active_jobs.clear()
    pipeline_service._active_jobs["song"] = current
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: current)
    monkeypatch.setattr(
        pipeline_service,
        "_load_job_paths",
        lambda _song_id: ("source.wav", tmp_path),
    )
    monkeypatch.setattr(pipeline_service, "_is_cancelled", lambda _song_id: False)
    monkeypatch.setattr(pipeline_service, "_update_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_begin_runtime_progress", Mock())
    monkeypatch.setattr(pipeline_service, "_end_runtime_progress", Mock())
    monkeypatch.setattr(
        pipeline_service,
        "_start_progress_heartbeat",
        lambda _song_id: (Mock(), Mock()),
    )
    monkeypatch.setattr(pipeline_service, "_stop_progress_heartbeat", Mock())
    capture = Mock()
    monkeypatch.setattr(pipeline_service, "_create_progress_capture", lambda *_args: capture)
    monkeypatch.setattr(pipeline_service, "_configure_ai_runtime", lambda: "cpu")
    monkeypatch.setattr(
        pipeline_service.ai_bridge,
        "get_run_all_pipeline",
        lambda: lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        pipeline_service.app_settings_service,
        "read_settings",
        lambda: {"whisper_model": "tiny"},
    )
    monkeypatch.setattr(pipeline_service, "_finalize_success", Mock())

    pipeline_service._run_job("song")

    assert pipeline_service._active_jobs["song"] is current
    pipeline_service._active_jobs.clear()


def test_reprocessing_keeps_slot_until_recordings_are_restored(monkeypatch, tmp_path):
    current = Mock()
    output_root = tmp_path / "Song"
    target = output_root / "demo"
    recordings = target / "recordings"
    recordings.mkdir(parents=True)
    (recordings / "take.wav").write_bytes(b"take")
    stems = target / "separated"
    stems.mkdir()
    (stems / "vocals.flac").write_bytes(b"cached-vocals")

    pipeline_service._active_jobs.clear()
    pipeline_service._active_jobs["song"] = current
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: current)
    monkeypatch.setattr(pipeline_service.config, "SONG_OUTPUT_DIR", output_root)
    monkeypatch.setattr(pipeline_service, "SessionLocal", lambda: Mock(close=Mock()))
    source = target / "source.wav"
    source.write_bytes(b"audio")
    monkeypatch.setattr(
        pipeline_service.repositories,
        "get_song",
        lambda _db, _song_id: Mock(slug="demo", source_path=str(source)),
    )
    monkeypatch.setattr(pipeline_service.song_service, "resolve_output_dir", lambda _song: target)
    monkeypatch.setattr(pipeline_service, "_is_cancelled", lambda _song_id: False)

    observed = {}

    def fake_run_job(_song_id):
        observed["reserved_during_run"] = "song" in pipeline_service._active_jobs
        target.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(pipeline_service, "_run_job", fake_run_job)

    pipeline_service._run_reprocessing("song")

    assert observed["reserved_during_run"] is True
    assert (target / "recordings" / "take.wav").read_bytes() == b"take"
    assert (target / "separated" / "vocals.flac").read_bytes() == b"cached-vocals"
    assert pipeline_service._active_jobs["song"] is current
    pipeline_service._active_jobs.clear()
