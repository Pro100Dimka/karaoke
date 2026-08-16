import asyncio
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks, HTTPException, Response, UploadFile

import models
import schemas
from app.routers import songs


def domain_song(**changes):
    values = {
        "id": "song",
        "title": "Song",
        "artist": None,
        "genre": None,
        "original_filename": "song.wav",
        "source_path": "song.wav",
        "slug": "song",
        "output_dir": "output",
        "status": models.SongStatus.DONE,
        "progress_step": "done",
        "progress_percent": 100.0,
        "error_message": None,
        "show_lyrics": True,
        "show_notes": True,
        "optimized": False,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
    }
    values.update(changes)
    return models.Song(**values)


def upload(payload=b"audio", filename="song.wav"):
    return UploadFile(filename=filename, file=BytesIO(payload))


def test_processing_status_uses_only_typed_live_telemetry():
    current = domain_song(status=models.SongStatus.PROCESSING, progress_percent=20)
    status = songs._processing_status(
        current,
        telemetry={"progress_percent": 55, "progress_detail": "pitch", "eta_seconds": 12},
    )
    assert (status.progress_percent, status.progress_detail, status.eta_seconds) == (
        55,
        "pitch",
        12,
    )
    fallback = songs._processing_status(
        current,
        telemetry={"progress_percent": "bad", "progress_detail": 1, "eta_seconds": 1.5},
    )
    assert (fallback.progress_percent, fallback.progress_detail, fallback.eta_seconds) == (
        20,
        None,
        None,
    )


def test_queue_song_job_commits_and_compensates_all_worker_failures():
    current = domain_song(status=models.SongStatus.PENDING)
    database = Mock()
    start = Mock(return_value=True)
    songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    assert current.status == models.SongStatus.QUEUED

    current.status = models.SongStatus.PENDING
    database.reset_mock()
    database.commit.side_effect = RuntimeError("commit failed")
    with pytest.raises(RuntimeError, match="commit failed"):
        songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    assert current.status == models.SongStatus.PENDING
    database.rollback.assert_called_once_with()

    database.reset_mock()
    database.commit.side_effect = None
    start.side_effect = RuntimeError("thread failed")
    with pytest.raises(RuntimeError, match="thread failed"):
        songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    assert current.status == models.SongStatus.PENDING

    start.side_effect = None
    start.return_value = False
    with pytest.raises(HTTPException) as duplicate:
        songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    assert duplicate.value.status_code == 409

    database.commit.side_effect = [None, RuntimeError("restore failed")]
    with pytest.raises(RuntimeError, match="restore failed"):
        songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    database.rollback.assert_called()


def test_add_song_streams_upload_maps_validation_and_cleans_temp(monkeypatch, tmp_path):
    monkeypatch.setattr(songs.config, "UPLOAD_TEMP_DIR", tmp_path)
    save = AsyncMock()
    monkeypatch.setattr(songs, "save_upload_limited", save)
    create = Mock(return_value="created")
    monkeypatch.setattr(songs.song_service, "create_song_from_path", create)
    assert asyncio.run(songs.add_song(upload(), "Title", Mock())) == "created"
    temporary = create.call_args.args[3]
    assert not temporary.exists()

    create.side_effect = ValueError("invalid audio")
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(songs.add_song(upload(filename=None), None, Mock()))
    assert invalid.value.status_code == 400

    save.side_effect = HTTPException(status_code=413, detail="large")
    with pytest.raises(HTTPException) as large:
        asyncio.run(songs.add_song(upload(), None, Mock()))
    assert large.value.status_code == 413


def test_listing_get_patch_remove_and_package(monkeypatch, tmp_path):
    database = Mock()
    current = domain_song()
    monkeypatch.setattr(songs.song_service, "list_songs", Mock(return_value=[current]))
    monkeypatch.setattr(songs.song_service, "update_song", Mock(return_value=current))
    monkeypatch.setattr(songs.song_service, "delete_song", Mock())
    monkeypatch.setattr(songs.pipeline_service, "is_processing", Mock(return_value=False))
    assert songs.get_songs(database) == [current]
    assert songs.get_song(current) is current
    assert songs.patch_song(current, schemas.SongUpdate(title="New"), database) is current
    songs.song_service.update_song.side_effect = ValueError("bad range")
    with pytest.raises(HTTPException) as invalid:
        songs.patch_song(current, schemas.SongUpdate(title="New"), database)
    assert invalid.value.status_code == 422

    songs.remove_song(current, database)
    songs.pipeline_service.is_processing.return_value = True
    with pytest.raises(HTTPException) as processing:
        songs.remove_song(current, database)
    assert processing.value.status_code == 409
    songs.pipeline_service.is_processing.return_value = False
    songs.song_service.delete_song.side_effect = OSError("locked")
    with pytest.raises(HTTPException) as locked:
        songs.remove_song(current, database)
    assert locked.value.status_code == 409

    monkeypatch.setattr(
        songs.song_package_service,
        "build_package_for_song",
        Mock(side_effect=ValueError("Song processing is not complete")),
    )
    with pytest.raises(HTTPException):
        songs.export_song_package(current.id, BackgroundTasks(), db=database)
    package = tmp_path / "song.zip"
    package.write_bytes(b"zip")
    songs.song_package_service.build_package_for_song.side_effect = None
    songs.song_package_service.build_package_for_song.return_value = (package, current.slug)
    response = songs.export_song_package(current.id, BackgroundTasks(), db=database)
    assert response.path == package
    songs.song_package_service.build_package_for_song.side_effect = ValueError("incomplete")
    with pytest.raises(HTTPException) as incomplete:
        songs.export_song_package(current.id, BackgroundTasks(), db=database)
    assert incomplete.value.status_code == 409


def test_import_package_streams_and_maps_archive_errors(monkeypatch, tmp_path):
    monkeypatch.setattr(songs.config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(songs.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(songs, "save_upload_limited", AsyncMock())
    monkeypatch.setattr(songs.song_package_service, "import_package", Mock(return_value="song"))
    assert asyncio.run(songs.import_song_package(upload(filename="song.zip"), Mock())) == "song"
    songs.song_package_service.import_package.side_effect = ValueError("bad package")
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(songs.import_song_package(upload(filename="song.zip"), Mock()))
    assert invalid.value.status_code == 400
    songs.save_upload_limited.side_effect = HTTPException(status_code=413)
    with pytest.raises(HTTPException) as large:
        asyncio.run(songs.import_song_package(upload(filename="song.zip"), Mock()))
    assert large.value.status_code == 413


def test_process_reprocess_status_and_cancel(monkeypatch):
    database = Mock()
    current = domain_song(status=models.SongStatus.PENDING, output_dir=None)
    monkeypatch.setattr(songs.pipeline_service, "is_processing", Mock(return_value=True))
    with pytest.raises(HTTPException):
        songs.process_song(current, database)
    songs.pipeline_service.is_processing.return_value = False
    queue = Mock()
    monkeypatch.setattr(songs, "_queue_song_job", queue)
    assert songs.process_song(current, database).song_id == "song"

    with pytest.raises(HTTPException):
        songs.reprocess_melody(current, database)
    current.output_dir = "output"
    current.status = models.SongStatus.DONE
    songs.pipeline_service.is_processing.return_value = True
    with pytest.raises(HTTPException):
        songs.reprocess_melody(current, database)
    songs.pipeline_service.is_processing.return_value = False
    assert songs.reprocess_melody(current, database).song_id == "song"

    monkeypatch.setattr(
        songs.pipeline_service,
        "get_processing_telemetry",
        Mock(return_value={"progress_percent": 42}),
    )
    assert songs.get_status(current).progress_percent == 42
    monkeypatch.setattr(songs.pipeline_service, "cancel_processing", Mock(return_value=False))
    with pytest.raises(HTTPException):
        songs.cancel_processing(current, database)
    songs.pipeline_service.cancel_processing.return_value = True
    assert songs.cancel_processing(current, database).song_id == "song"


def test_logs_and_audio_track_resolution(monkeypatch, tmp_path):
    current = domain_song()
    monkeypatch.setattr(songs.song_service, "resolve_output_dir", Mock(return_value=tmp_path))
    assert songs.get_processing_log(current) == {"lines": []}
    log = tmp_path / songs.config.LOGS_DIRNAME / "pipeline.log"
    log.parent.mkdir()
    log.write_text("one\ntwo", encoding="utf-8")
    assert songs.get_processing_log(current) == {"lines": ["one", "two"]}
    with pytest.raises(HTTPException):
        songs.get_audio_track("unknown", current)
    with pytest.raises(HTTPException):
        songs.get_audio_track("vocals", current)
    separated = tmp_path / "separated"
    separated.mkdir()
    vocals = separated / "vocals.flac"
    vocals.write_bytes(b"audio")
    assert songs.get_audio_track("vocals", current).media_type == "audio/flac"
    diagnostic = tmp_path / "diagnostic.mp3"
    diagnostic.write_bytes(b"audio")
    assert songs.get_audio_track("diagnostic", current).media_type == "audio/mpeg"


def test_editor_endpoints_validate_state_save_and_reset(monkeypatch):
    database = Mock()
    current = domain_song(status=models.SongStatus.PENDING)
    for action in (
        lambda: songs.get_song_editor(current),
        lambda: songs.save_song_editor(schemas.SongEditorUpdate(notes=[]), current, database),
        lambda: songs.reset_song_editor(current, database),
    ):
        with pytest.raises(HTTPException):
            action()
    current.status = models.SongStatus.DONE
    monkeypatch.setattr(
        songs.song_service, "resolve_output_dir", Mock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr(
        songs.song_editor_service, "load_editor", Mock(return_value=({"notes": []}, True))
    )
    assert songs.get_song_editor(current).ai_backup_exists is True
    songs.song_editor_service.load_editor.side_effect = ValueError("missing")
    with pytest.raises(HTTPException):
        songs.get_song_editor(current)

    monkeypatch.setattr(songs.song_editor_service, "save_editor", Mock(return_value={"notes": []}))
    assert songs.save_song_editor(
        schemas.SongEditorUpdate(notes=[]), current, database
    ).ai_backup_exists
    songs.song_editor_service.save_editor.side_effect = ValueError("bad")
    with pytest.raises(HTTPException) as bad:
        songs.save_song_editor(schemas.SongEditorUpdate(notes=[]), current, database)
    assert bad.value.status_code == 400

    monkeypatch.setattr(songs.song_editor_service, "reset_editor", Mock(return_value={"notes": []}))
    assert songs.reset_song_editor(current, database).ai_backup_exists
    songs.song_editor_service.reset_editor.side_effect = ValueError("backup missing")
    with pytest.raises(HTTPException):
        songs.reset_song_editor(current, database)


def test_result_and_lyrics_contracts(monkeypatch, tmp_path):
    current = domain_song(status=models.SongStatus.PENDING, output_dir=None)
    with pytest.raises(HTTPException):
        songs.get_result(current, Response())
    with pytest.raises(HTTPException):
        songs.update_lyrics(schemas.LyricsUpdate(lyrics=[]), current)
    current.status = models.SongStatus.DONE
    current.output_dir = str(tmp_path)
    monkeypatch.setattr(songs.song_service, "resolve_output_dir", Mock(return_value=tmp_path))
    monkeypatch.setattr(songs, "read_json", Mock(return_value={}))
    for name in (
        "get_reference_notes",
        "get_game_notes",
        "get_syllables",
        "get_karaoke_lyrics",
    ):
        monkeypatch.setattr(songs.ai_bridge, name, Mock(return_value=[]))
    monkeypatch.setattr(songs.ai_bridge, "get_karaoke_timeline", Mock(return_value={}))
    response = Response()
    assert songs.get_result(current, response).song.id == "song"
    assert response.headers["Cache-Control"].startswith("no-store")

    reconcile = Mock(return_value=[{"text": " Hello "}, {"text": "World"}])
    monkeypatch.setattr(songs.ai_bridge, "get_reconcile_lyric_words", Mock(return_value=reconcile))
    body = schemas.LyricsUpdate(lyrics=[schemas.LyricLine(text="Hello", start=0, end=1, words=[])])
    assert songs.update_lyrics(body, current) == {"status": "saved"}
    assert (tmp_path / songs.config.TRUSTED_LYRICS_FILENAME).read_text(encoding="utf-8") == (
        "Hello\nWorld\n"
    )
    reconcile.return_value = [{"text": " "}]
    assert songs.update_lyrics(body, current) == {"status": "saved"}
    reconcile.side_effect = ValueError("bad lyrics")
    with pytest.raises(HTTPException) as invalid:
        songs.update_lyrics(body, current)
    assert invalid.value.status_code == 400


def test_song_mutations_are_blocked_while_recording_is_active(monkeypatch):
    database = Mock()
    pending = domain_song(status=models.SongStatus.PENDING, output_dir=None)
    done = domain_song(status=models.SongStatus.DONE, output_dir="output")
    monkeypatch.setattr(songs.recording_service, "has_active_recording", Mock(return_value=True))
    monkeypatch.setattr(songs.pipeline_service, "is_processing", Mock(return_value=False))

    for action, song in (
        (songs.remove_song, done),
        (songs.process_song, pending),
        (songs.reprocess_melody, done),
    ):
        with pytest.raises(HTTPException) as blocked:
            action(song, database)
        assert blocked.value.status_code == 409
