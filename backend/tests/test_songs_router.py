import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import BackgroundTasks, HTTPException, Response

import models
import schemas
from app.routers import songs
from tests._shared import (
    assert_http_status,
    make_song,
    patch_attrs,
    patch_many,
    raises,
    upload_file,
)


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
    return make_song(**values)



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
    current, database, start = domain_song(status=models.SongStatus.PENDING), Mock(), Mock(return_value=True)
    songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED)
    assert current.status == models.SongStatus.QUEUED

    current.status = models.SongStatus.PENDING
    database.reset_mock()
    database.commit.side_effect = RuntimeError("commit failed")
    raises(RuntimeError, lambda: songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED), match='commit failed')
    assert current.status == models.SongStatus.PENDING
    database.rollback.assert_called_once_with()

    database.reset_mock()
    database.commit.side_effect = None
    start.side_effect = RuntimeError("thread failed")
    raises(RuntimeError, lambda: songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED), match='thread failed')
    assert current.status == models.SongStatus.PENDING

    start.side_effect = None
    start.return_value = False
    assert_http_status(409, lambda: songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED))

    database.commit.side_effect = [None, RuntimeError("restore failed")]
    raises(RuntimeError, lambda: songs._queue_song_job(database, current, start, status=models.SongStatus.QUEUED), match='restore failed')
    database.rollback.assert_called()


def test_add_song_streams_upload_maps_validation_and_cleans_temp(monkeypatch, tmp_path):
    monkeypatch.setattr(songs.config, "UPLOAD_TEMP_DIR", tmp_path)
    save = AsyncMock()
    monkeypatch.setattr(songs, "save_upload_limited", save)
    create = Mock(return_value="created")
    monkeypatch.setattr(songs.song_service, "create_song_from_path", create)
    assert asyncio.run(songs.add_song(upload_file(), "Title", Mock())) == "created"
    temporary = create.call_args.args[3]
    assert not temporary.exists()

    create.side_effect = ValueError("invalid audio")
    assert_http_status(400, lambda: asyncio.run(songs.add_song(upload_file(filename=None), None, Mock())))

    create.side_effect = songs.song_service.SongAlreadyExistsError("Такая песня уже существует")
    assert_http_status(409, lambda: asyncio.run(songs.add_song(upload_file(), None, Mock())))

    save.side_effect = HTTPException(status_code=413, detail="large")
    assert_http_status(413, lambda: asyncio.run(songs.add_song(upload_file(), None, Mock())))


def test_song_identity_preview_uses_the_same_metadata_parser_as_database(monkeypatch, tmp_path):
    monkeypatch.setattr(songs.config, "UPLOAD_TEMP_DIR", tmp_path)
    monkeypatch.setattr(songs, "save_upload_limited", AsyncMock())
    detect = Mock(return_value=("Artist", "Tagged title"))
    monkeypatch.setattr(songs.song_service, "_read_source_identity", detect)
    monkeypatch.setattr(
        songs.song_service,
        "read_embedded_cover",
        Mock(return_value=(b"\x89PNG\r\n\x1a\ncover", ".png")),
    )

    result = asyncio.run(songs.inspect_song_identity(upload_file(filename="fallback - name.mp3")))

    assert result == schemas.SongIdentityOut(
        title="Tagged title",
        artist="Artist",
        cover_data_url="data:image/png;base64,iVBORw0KGgpjb3Zlcg==",
    )
    assert detect.call_args.args[1:] == ("fallback - name.mp3", "")
    assert not detect.call_args.args[0].exists()


def test_listing_get_patch_remove_and_package(monkeypatch, tmp_path):
    database, current = Mock(), domain_song()
    patch_attrs(monkeypatch, songs.song_service, list_songs=Mock(return_value=[current]), update_song=Mock(return_value=current), delete_song=Mock())
    monkeypatch.setattr(songs.pipeline_service, "is_processing", Mock(return_value=False))
    assert (songs.get_songs(database) == [current]) and (songs.get_song(current) is current) and (songs.patch_song(current, schemas.SongUpdate(title='New'), database) is current)
    songs.song_service.update_song.side_effect = ValueError("bad range")
    assert_http_status(422, lambda: songs.patch_song(current, schemas.SongUpdate(title="New"), database))

    songs.remove_song(current, database)
    songs.pipeline_service.is_processing.return_value = True
    assert_http_status(409, lambda: songs.remove_song(current, database))
    songs.pipeline_service.is_processing.return_value = False
    songs.song_service.delete_song.side_effect = OSError("locked")
    assert_http_status(409, lambda: songs.remove_song(current, database))

    patch_attrs(monkeypatch, songs.song_package_service, build_package_for_song=Mock(side_effect=ValueError('Song processing is not complete')))
    raises(HTTPException, lambda: songs.export_song_package(current.id, BackgroundTasks(), db=database))
    package = tmp_path / "song.zip"
    package.write_bytes(b"zip")
    songs.song_package_service.build_package_for_song.side_effect = None
    songs.song_package_service.build_package_for_song.return_value = (package, current.slug)
    response = songs.export_song_package(current.id, BackgroundTasks(), db=database)
    assert response.path == package
    songs.song_package_service.build_package_for_song.side_effect = ValueError("incomplete")
    assert_http_status(409, lambda: songs.export_song_package(current.id, BackgroundTasks(), db=database))


def test_import_package_streams_and_maps_archive_errors(monkeypatch, tmp_path):
    patch_attrs(monkeypatch, songs.config, DATA_DIR=tmp_path / 'data', CACHE_DIR=tmp_path)
    patch_many(monkeypatch, (songs, "save_upload_limited", AsyncMock()), (songs.song_package_service, "import_package", Mock(return_value="song")))
    assert asyncio.run(songs.import_song_package(upload_file(filename="song.zip"), Mock())) == "song"
    songs.song_package_service.import_package.side_effect = ValueError("bad package")
    assert_http_status(400, lambda: asyncio.run(songs.import_song_package(upload_file(filename="song.zip"), Mock())))
    songs.save_upload_limited.side_effect = HTTPException(status_code=413)
    assert_http_status(413, lambda: asyncio.run(songs.import_song_package(upload_file(filename="song.zip"), Mock())))


def test_process_reprocess_status_and_cancel(monkeypatch):
    database, current = Mock(), domain_song(status=models.SongStatus.PENDING, output_dir=None)
    monkeypatch.setattr(songs.pipeline_service, "is_processing", Mock(return_value=True))
    raises(HTTPException, lambda: songs.process_song(current, database))
    songs.pipeline_service.is_processing.return_value = False
    queue = Mock()
    monkeypatch.setattr(songs, "_queue_song_job", queue)
    assert songs.process_song(
        current, database, schemas.ProcessingRequest(mode="fast")
    ).song_id == "song"
    start_job = queue.call_args.args[2]
    start_processing = Mock(return_value=True)
    monkeypatch.setattr(songs.pipeline_service, "start_processing", start_processing)
    assert start_job("song") is True
    start_processing.assert_called_once_with("song", "fast")

    raises(HTTPException, lambda: songs.reprocess_melody(current, database))
    current.output_dir = "output"
    current.status = models.SongStatus.DONE
    songs.pipeline_service.is_processing.return_value = True
    raises(HTTPException, lambda: songs.reprocess_melody(current, database))
    songs.pipeline_service.is_processing.return_value = False
    assert songs.reprocess_melody(current, database).song_id == "song"

    patch_attrs(monkeypatch, songs.pipeline_service, get_processing_telemetry=Mock(return_value={'progress_percent': 42}))
    assert songs.get_status(current).progress_percent == 42
    monkeypatch.setattr(songs.pipeline_service, "cancel_processing", Mock(return_value=False))
    raises(HTTPException, lambda: songs.cancel_processing(current, database))
    songs.pipeline_service.cancel_processing.return_value = True
    assert songs.cancel_processing(current, database).song_id == "song"


def test_logs_and_audio_track_resolution(monkeypatch, tmp_path):
    current = domain_song()
    monkeypatch.setattr(songs.song_service, "resolve_output_dir", Mock(return_value=tmp_path))
    monkeypatch.setattr(songs.config, "APP_LOG_DIR", tmp_path)
    assert songs.get_processing_log(current) == {"lines": []}
    log = tmp_path / "application.log"
    log.write_text("ignored\n[song:song] one\n[song:song] two", encoding="utf-8")
    assert songs.get_processing_log(current) == {"lines": ["[song:song] one", "[song:song] two"]}
    raises(HTTPException, lambda: songs.get_audio_track('unknown', current))
    raises(HTTPException, lambda: songs.get_audio_track('vocals', current))
    vocals = tmp_path / "vocals.flac"
    vocals.write_bytes(b"audio")
    assert songs.get_audio_track("vocals", current).media_type == "audio/flac"
    diagnostic = tmp_path / "diagnostic.mp3"
    diagnostic.write_bytes(b"audio")
    raises(HTTPException, lambda: songs.get_audio_track("diagnostic", current))


def test_editor_endpoints_validate_state_save_and_reset(monkeypatch):
    database, current = Mock(), domain_song(status=models.SongStatus.PENDING)
    for action in (
        lambda: songs.get_song_editor(current),
        lambda: songs.save_song_editor(schemas.SongEditorUpdate(notes=[]), current, database),
        lambda: songs.reset_song_editor(current, database),
    ):
        raises(HTTPException, action)
    current.status = models.SongStatus.DONE
    patch_attrs(monkeypatch, songs.song_service, resolve_output_dir=Mock(return_value=SimpleNamespace()))
    patch_attrs(monkeypatch, songs.song_editor_service, load_editor=Mock(return_value=({'notes': []}, True)))
    assert songs.get_song_editor(current).ai_backup_exists is True
    songs.song_editor_service.load_editor.side_effect = ValueError("missing")
    raises(HTTPException, lambda: songs.get_song_editor(current))

    monkeypatch.setattr(songs.song_editor_service, "save_editor", Mock(return_value={"notes": []}))
    assert songs.save_song_editor(
        schemas.SongEditorUpdate(notes=[]), current, database
    ).ai_backup_exists
    songs.song_editor_service.save_editor.side_effect = ValueError("bad")
    assert_http_status(400, lambda: songs.save_song_editor(schemas.SongEditorUpdate(notes=[]), current, database))

    monkeypatch.setattr(songs.song_editor_service, "reset_editor", Mock(return_value={"notes": []}))
    assert not songs.reset_song_editor(current, database).ai_backup_exists
    songs.song_editor_service.reset_editor.side_effect = ValueError("backup missing")
    raises(HTTPException, lambda: songs.reset_song_editor(current, database))


def test_result_and_lyrics_contracts(monkeypatch, tmp_path):
    current = domain_song(status=models.SongStatus.PENDING, output_dir=None)
    raises(HTTPException, lambda: songs.get_result(current, Response()))
    raises(HTTPException, lambda: songs.update_lyrics(schemas.LyricsUpdate(lyrics=[]), current))
    current.status = models.SongStatus.DONE
    current.output_dir = str(tmp_path)
    note = {"start": 1.25, "end": 1.75, "note": 64}
    lyrics_sync = {
        "bpm": 120,
        "key": "C",
        "words": [{"text": "la", "start": 1.25, "end": 1.75, "notes": [note]}],
    }

    def generated(path, *args, **kwargs):
        del args, kwargs
        return lyrics_sync if path.name == "lyricsSync.json" else {}

    patch_many(monkeypatch, (songs.song_service, "resolve_output_dir", Mock(return_value=tmp_path)), (songs, "read_json", Mock(side_effect=generated)))
    for name in ("get_reference_notes", "get_game_notes", "get_syllables"):
        monkeypatch.setattr(songs.ai_bridge, name, Mock(return_value=[]))
    monkeypatch.setattr(songs.ai_bridge, "get_karaoke_lyrics", Mock(return_value=lyrics_sync))
    monkeypatch.setattr(songs.ai_bridge, "get_karaoke_timeline", Mock(return_value={}))
    response = Response()
    result = songs.get_result(current, response)
    assert result.song.id == 'song' and result.lyrics_sync == lyrics_sync
    assert response.headers['Cache-Control'].startswith('no-store')

    reconcile = Mock(return_value=[{"text": " Hello "}, {"text": "World"}])
    monkeypatch.setattr(songs.ai_bridge, "reconcile_lyric_words", reconcile)
    body = schemas.LyricsUpdate(lyrics=[schemas.LyricLine(text="Hello", start=0, end=1, words=[])])
    assert songs.update_lyrics(body, current) == {'status': 'saved'}
    saved = json.loads((tmp_path / "lyricsSync.json").read_text(encoding="utf-8"))
    assert saved["text"] == "Hello\nWorld" and saved["edited"] is True
    reconcile.return_value = [{"text": " "}]
    assert songs.update_lyrics(body, current) == {"status": "saved"}
    reconcile.side_effect = ValueError("bad lyrics")
    assert_http_status(400, lambda: songs.update_lyrics(body, current))


def test_song_processing_is_blocked_but_explicit_delete_closes_active_recording(monkeypatch):
    database, pending, done = Mock(), domain_song(status=models.SongStatus.PENDING, output_dir=None), domain_song(status=models.SongStatus.DONE, output_dir='output')
    close = Mock()
    delete = Mock()
    patch_many(monkeypatch, (songs.recording_service, "has_active_recording", Mock(return_value=True)), (songs.recording_service, "close_sessions_for_song", close), (songs.pipeline_service, "is_processing", Mock(return_value=False)), (songs.song_service, "delete_song", delete))

    songs.remove_song(done, database)
    close.assert_called_once_with(done.id)
    delete.assert_called_once_with(database, done)
    for action, song in (
        (songs.process_song, pending),
        (songs.reprocess_melody, done),
    ):
        assert_http_status(409, lambda action=action, song=song: action(song, database))
