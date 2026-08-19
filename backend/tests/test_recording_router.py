from tests._shared import patch_attrs, assert_http_status, raises, patch_many

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

import models
import schemas
from app.routers import recording


def audio_settings(**changes):
    values = {
        "input_device_id": 1,
        "output_device_id": 2,
        "volume": 1.0,
        "audio_driver": "auto",
        "asio_driver_name": None,
        "buffer_size": 64,
        "monitoring_enabled": False,
        "reverb": 0.1,
        "echo": 0.2,
        "delay": 0.3,
    }
    values.update(changes); return SimpleNamespace(**values)


def start_body(): return schemas.RecordingStartRequest(song_id='song', position_sec=2, music_volume=0.8, microphone_volume=1.5, reverb=0.4, echo=0.5, delay=0.6)


def test_session_state_and_monitor_restore_translate_failures(monkeypatch): action = Mock(); assert recording._change_session_state("session", action, "paused") == {"status": "paused"}; action.side_effect = KeyError("missing"); assert_http_status(404, lambda: recording._change_session_state("session", action, "paused")); database, current = Mock(), audio_settings(); monkeypatch.setattr(recording.audio_service, "get_settings", Mock(return_value=current)); configure, stop = Mock(), Mock(); patch_attrs(monkeypatch, recording.audio_service, configure_monitoring=configure, stop_monitoring=stop); recording._restore_monitoring(database); configure.assert_called_once_with(current); configure.side_effect = RuntimeError("device unavailable"); recording._restore_monitoring(database); stop.assert_called_once_with()


def test_recording_monitor_configuration_handles_auto_and_temporary_asio(monkeypatch): stop, configure = Mock(), Mock(); patch_attrs(monkeypatch, recording.audio_service, stop_monitoring=stop, configure_monitoring=configure); body = start_body(); assert (recording._configure_recording_monitor(audio_settings(), body) is False) and (recording._configure_recording_monitor(audio_settings(audio_driver='asio', monitoring_enabled=False), body) is True); current = audio_settings(audio_driver="asio", monitoring_enabled=True); original = vars(current).copy(); assert recording._configure_recording_monitor(current, body) is True; configure.assert_called_once_with(current); assert vars(current) == original; configure.side_effect = RuntimeError("ASIO failed"); raises(RuntimeError, lambda: recording._configure_recording_monitor(current, body), match='ASIO failed'); assert vars(current) == original


def test_start_recording_builds_device_specific_session(monkeypatch):
    database, body, song, settings = Mock(), start_body(), SimpleNamespace(id='song'), audio_settings(monitoring_enabled=True); patch_many(monkeypatch, (recording.repositories, "get_song", Mock(return_value=song)), (recording.audio_service, "get_settings", Mock(return_value=settings)), (recording, "_configure_recording_monitor", Mock(return_value=False))); patch_attrs(monkeypatch, recording.audio_service, preferred_input_device=Mock(return_value=3), preferred_output_device=Mock(return_value=4), preferred_sample_rate=Mock(return_value=48000)); start = Mock(return_value="session")
    monkeypatch.setattr(recording.recording_service, "start_recording", start)

    result = recording.start_recording(body, database)

    assert result.recording_session_id == "session"
    start.assert_called_once_with(
        song_id="song",
        device_id=3,
        output_device_id=4,
        sample_rate=48_000,
        gain=1.5,
        monitoring_enabled=True,
        playback_offset_sec=2,
        blocksize=64,
        music_gain=0.8,
        effects={"reverb": 0.4, "echo": 0.5, "delay": 0.6},
    )


def test_start_recording_translates_missing_song_and_audio_failure(monkeypatch): database, body = Mock(), start_body(); monkeypatch.setattr(recording.repositories, "get_song", Mock(return_value=None)); assert_http_status(404, lambda: recording.start_recording(body, database)); recording.repositories.get_song.return_value = SimpleNamespace(id="song"); patch_attrs(monkeypatch, recording.audio_service, get_settings=Mock(return_value=audio_settings())); patch_attrs(monkeypatch, recording, _configure_recording_monitor=Mock(side_effect=RuntimeError('device busy'))); restore = Mock(); monkeypatch.setattr(recording, "_restore_monitoring", restore); assert_http_status(503, lambda: recording.start_recording(body, database)); restore.assert_called_once_with(database)


def test_recording_actions_and_stop_error_mapping(monkeypatch):
    patch_attrs(monkeypatch, recording.recording_service, pause_recording=Mock(), resume_recording=Mock()); assert (recording.pause_recording('session') == {'status': 'paused'}) and (recording.resume_recording('session') == {'status': 'recording'})

    database, saved = Mock(), object(); stop = Mock(return_value=saved); monkeypatch.setattr(recording.recording_service, "stop_recording", stop); restore = Mock()
    monkeypatch.setattr(recording, "_restore_monitoring", restore); assert recording.stop_recording("session", database) is saved; restore.assert_called_once_with(database)
    for error, status in (
        (KeyError("missing"), 404),
        (ValueError("bad"), 400),
        (OSError("disk"), 500),
    ):
        stop.side_effect = error
        with pytest.raises(HTTPException) as mapped: recording.stop_recording("session", database)
        assert mapped.value.status_code == status


def persisted_recording(path): return models.Recording(id='recording', song_id='song', filename='take.wav', path=str(path), duration_sec=2, sample_rate=48000, created_at=datetime(2026, 1, 1, tzinfo=UTC))


def test_recording_queries_files_and_deletion(monkeypatch, tmp_path): database, song, voice = Mock(), SimpleNamespace(id='song'), tmp_path / 'take.wav'; voice.write_bytes(b"voice"); current = persisted_recording(voice); patch_attrs(monkeypatch, recording.repositories, list_recordings_for_song=Mock(return_value=[current]), list_recording_library=Mock(return_value=[(current, 'Song')])); assert (recording.get_recording_settings(database) is not None) and (recording.list_recordings_for_song(song, database) == [current]) and (recording.list_recording_library(database)[0]['song_title'] == 'Song') and (recording.get_recording(current) is current); patch_attrs(monkeypatch, recording.recording_service, resolve_recording_path=Mock(return_value=voice)); assert recording.get_recording_file(current).path == voice; voice.unlink(); assert_http_status(404, lambda: recording.get_recording_file(current)); delete = Mock(); monkeypatch.setattr(recording.recording_service, "delete_recording", delete); recording.delete_recording(current, database); delete.assert_called_once_with(database, current)


def test_performance_file_prefers_mp3_then_wav_then_voice(monkeypatch, tmp_path): voice = tmp_path / "take.wav"; voice.write_bytes(b"voice"); current, mp3, wav = persisted_recording(voice), tmp_path / 'mix.mp3', tmp_path / 'mix.wav'; patch_attrs(monkeypatch, recording.recording_service, performance_mix_paths=Mock(return_value=(mp3, wav)), resolve_recording_path=Mock(return_value=voice)); mp3.write_bytes(b"mix"); assert recording.get_performance_file(current).media_type == "audio/mpeg"; mp3.unlink(); wav.write_bytes(b"mix"); assert recording.get_performance_file(current).media_type == "audio/wav"; wav.unlink(); assert recording.get_performance_file(current).path == voice; voice.unlink(); assert_http_status(404, lambda: recording.get_performance_file(current))


def test_recording_start_is_blocked_while_song_is_processing(monkeypatch):
    database, body = Mock(), start_body(); patch_many(monkeypatch, (recording.repositories, "get_song", Mock(return_value=SimpleNamespace(id="song"))), (recording.pipeline_service, "is_processing", Mock(return_value=True)))

    with pytest.raises(HTTPException) as blocked: recording.start_recording(body, database)

    assert blocked.value.status_code == 409
