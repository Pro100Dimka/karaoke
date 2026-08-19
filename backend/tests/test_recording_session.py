from tests._shared import mock_song_lookup, patch_attrs, make_song, raises, patch_many

import builtins
import importlib
from unittest.mock import MagicMock, Mock

import numpy as np
import pytest

import models
from app.services import recording_service


def make_session(monkeypatch, **overrides):
    stream = Mock(); monkeypatch.setattr(recording_service.sd, "InputStream", Mock(return_value=stream))
    options = {
        "session_id": "session",
        "song_id": "song",
        "device_id": 1,
        "output_device_id": 2,
        "sample_rate": 48_000,
        "channels": 1,
        "gain": 1.0,
        "monitoring_enabled": False,
    }
    options.update(overrides); return recording_service.RecordingSession(**options), stream


def test_session_initialization_clamps_levels_and_selects_stream(monkeypatch):
    session, stream = make_session(
        monkeypatch,
        gain=8,
        music_gain=-1,
        playback_offset_sec=-2,
        effects={"reverb": 3, "echo": -1, "delay": 0.5},
    )
    assert ((session.gain, session.music_gain, session.playback_offset_sec, session.effects) == (4, 0, 0, {'reverb': 1, 'echo': 0, 'delay': 0.5})) and (session._stream is stream)

    duplex = Mock(); patch_attrs(monkeypatch, recording_service.sd, query_devices=Mock(return_value={'max_output_channels': 2}), Stream=Mock(return_value=duplex)); monitored, _unused = make_session(monkeypatch, monitoring_enabled=True); assert monitored._stream is duplex

    recording_service.sd.query_devices.return_value = {"max_output_channels": 0}; raises(RuntimeError, lambda: make_session(monkeypatch, monitoring_enabled=True), match='No output')


def test_audio_callbacks_queue_clipped_copies(monkeypatch): session, _stream = make_session(monkeypatch, gain=2); input_data = np.array([[0.75], [-0.75]], dtype=np.float32); session._callback(input_data, 2, None, None); recorded = session._queue.get_nowait(); assert (recorded.shape == input_data.shape) and (np.max(np.abs(recorded)) <= 0.985) and (not np.allclose(recorded, input_data * 2)); output = np.empty((2, 2), dtype=np.float32); session._monitoring_enabled = True; session._monitoring_callback(input_data, output, 2, None, None); assert (np.max(np.abs(output)) <= 0.985) and (np.allclose(output[:, 0], output[:, 1])); session._monitoring_enabled = False; output.fill(9); session._monitoring_callback(input_data, output, 2, None, None); assert not output.any()


def test_writer_persists_chunks_and_reports_library_errors(monkeypatch, tmp_path): session, _stream = make_session(monkeypatch); session._temporary_path = tmp_path / "take.wav"; output = MagicMock(); output.__enter__.return_value = output; monkeypatch.setattr(recording_service.sf, "SoundFile", Mock(return_value=output)); session._queue.put(np.zeros((3, 1))); session._queue.put(session._WRITER_STOP); session._write_audio(); output.write.assert_called_once(); assert (session._frames_written == 3) and (session._writer_ready.is_set()); failed, _stream = make_session(monkeypatch); failed._temporary_path = tmp_path / "failed.wav"; patch_attrs(monkeypatch, recording_service.sf, SoundFile=Mock(side_effect=RuntimeError('disk full'))); failed._write_audio(); assert (str(failed._writer_error) == 'disk full') and (failed._writer_ready.is_set())


def test_start_writer_closes_descriptor_and_cleans_failed_file(monkeypatch, tmp_path):
    session, _stream = make_session(monkeypatch); temporary = tmp_path / "temporary.wav"; temporary.write_bytes(b"partial"); patch_attrs(monkeypatch, recording_service.tempfile, mkstemp=Mock(return_value=(7, str(temporary))))
    close = Mock(); monkeypatch.setattr(recording_service.os, "close", close)

    class ImmediateThread:
        def __init__(self, *, target, **_options): self.target = target

        def start(self): session._writer_ready.set()

    monkeypatch.setattr(recording_service.threading, "Thread", ImmediateThread); session._start_writer(); close.assert_called_once_with(7); assert session._temporary_path == temporary

    failed, _stream = make_session(monkeypatch); temporary.write_bytes(b"partial"); failed._writer_error = RuntimeError("cannot open")

    class FailedThread(ImmediateThread):
        def start(self): failed._writer_ready.set()

    monkeypatch.setattr(recording_service.threading, "Thread", FailedThread); raises(RuntimeError, lambda: failed._start_writer(), match='cannot open'); assert not temporary.exists()


def test_session_lifecycle_cleans_resources_on_errors(monkeypatch, tmp_path): session, stream = make_session(monkeypatch); start_writer, stop_writer, cleanup = Mock(), Mock(), Mock(); patch_attrs(monkeypatch, session, _start_writer=start_writer, _stop_writer=stop_writer, _cleanup_temporary_file=cleanup); stream.start.side_effect = RuntimeError("host error"); raises(RuntimeError, lambda: session.start(), match='host error'); stop_writer.assert_called_once_with(); cleanup.assert_called_once_with(); stream.start.side_effect = None; stream.start.reset_mock(); session.pause(); assert session._paused is True; stream.stop.assert_not_called(); session.resume(); assert session._paused is False; stream.stop.assert_not_called(); stream.start.assert_not_called(); session.close(); session.close(); stream.close.assert_called_once_with(); idle, _stream = make_session(monkeypatch); idle._stop_writer(); temporary = tmp_path / "cleanup.wav"; temporary.write_bytes(b"x"); idle._temporary_path = temporary; idle._cleanup_temporary_file(); assert idle._temporary_path is None and not temporary.exists()


def test_stop_writer_signals_live_thread(monkeypatch): session, _stream = make_session(monkeypatch); thread = Mock(); thread.is_alive.return_value = True; session._writer_thread = thread; session._stop_writer(); assert session._queue.get_nowait() is session._WRITER_STOP; thread.join.assert_called_once_with(); assert session._writer_thread is None


def test_stop_and_save_publishes_atomic_recording(monkeypatch, tmp_path): session, stream = make_session(monkeypatch, sample_rate=4); temporary, destination = tmp_path / 'temporary.wav', tmp_path / 'library' / 'take.wav'; temporary.write_bytes(b"audio"); session._temporary_path = temporary; session._frames_written = 8; session._writer_thread = Mock(is_alive=Mock(return_value=False)); duration, sample_rate = session.stop_and_save(destination); assert ((duration, sample_rate) == (2.0, 4)) and (destination.read_bytes() == b'audio') and (session._temporary_path is None); stream.stop.assert_called_once_with(); stream.close.assert_called_once_with(); raises(RuntimeError, lambda: session.stop_and_save(destination), match='already closed')


@pytest.mark.parametrize(("failure", "message"), [("stream", "stop"), ("writer", "write")])
def test_stop_and_save_reports_stream_or_writer_failure(monkeypatch, tmp_path, failure, message):
    session, stream = make_session(monkeypatch); temporary = tmp_path / "temporary.wav"; temporary.write_bytes(b"audio"); session._temporary_path = temporary
    if failure == "stream":
        stream.stop.side_effect = RuntimeError("device lost")
    else:
        session._writer_error = RuntimeError("disk full")

    raises(RuntimeError, lambda: session.stop_and_save(tmp_path / 'take.wav'), match=message); assert not temporary.exists()


def test_stop_and_save_requires_initialized_file(monkeypatch, tmp_path): session, _stream = make_session(monkeypatch); raises(RuntimeError, lambda: session.stop_and_save(tmp_path / 'take.wav'), match='not initialized')


def test_stop_recording_persists_take_and_always_closes_resources(monkeypatch, tmp_path):
    session = Mock(
        song_id="song",
        playback_offset_sec=1.5,
        music_gain=0.8,
        effects={"reverb": 0.2},
    )
    session.stop_and_save.return_value = (3.0, 48_000); monkeypatch.setattr(recording_service, "_sessions", {"session": session}); current_song = make_song(); database, _ = mock_song_lookup(monkeypatch, recording_service, current_song)
    patch_attrs(monkeypatch, recording_service.song_service, resolve_output_dir=Mock(return_value=tmp_path / 'song')); commit, mix = Mock(side_effect=lambda _db, item: item), Mock(); patch_attrs(monkeypatch, recording_service, commit_refresh=commit, _create_performance_mix_safely=mix)

    result = recording_service.stop_recording("session")

    assert result.song_id == "song" and result.duration_sec == 3; database.add.assert_called_once_with(result); mix.assert_called_once_with(result, current_song, 1.5, 0.8, {"reverb": 0.2}); session.close.assert_called_once_with()
    database.close.assert_called_once_with()


def test_stop_recording_handles_missing_session_song_and_save_failure(monkeypatch, tmp_path): monkeypatch.setattr(recording_service, "_sessions", {}); raises(KeyError, lambda: recording_service.stop_recording('missing')); session = Mock(song_id="missing"); monkeypatch.setattr(recording_service, "_sessions", {"missing-song": session}); database, _ = mock_song_lookup(monkeypatch, recording_service); raises(ValueError, lambda: recording_service.stop_recording('missing-song')); session.close.assert_called_once_with(); database.close.assert_called_once_with(); current_song, failed = make_song(), Mock(song_id='song'); failed.stop_and_save.side_effect = RuntimeError("disk full"); patch_many(monkeypatch, (recording_service, "_sessions", {"failed": failed}), (recording_service.repositories, "get_song", Mock(return_value=current_song))); patch_attrs(monkeypatch, recording_service.song_service, resolve_output_dir=Mock(return_value=tmp_path)); raises(RuntimeError, lambda: recording_service.stop_recording('failed'), match='disk full'); database.rollback.assert_called()


def test_create_performance_mix_runs_ffmpeg_and_cleans_failure(monkeypatch, tmp_path): executable = tmp_path / "ffmpeg.exe"; executable.write_bytes(b"binary"); song_dir = tmp_path / "song"; song_dir.mkdir(); instrumental = song_dir / "instrumental.mp3"; instrumental.write_bytes(b"music"); voice = song_dir / "take.wav"; voice.write_bytes(b"voice"); current, current_song = models.Recording(id='recording', song_id='song', filename='take.wav', path=str(voice), duration_sec=4, sample_rate=48000), make_song(output_dir=str(song_dir)); patch_attrs(monkeypatch, recording_service.config, FFMPEG_EXE=str(executable), SONG_OUTPUT_DIR=tmp_path); patch_attrs(monkeypatch, recording_service.song_service, resolve_output_dir=Mock(return_value=song_dir)); run = Mock(); monkeypatch.setattr(recording_service.subprocess, "run", run); recording_service._create_performance_mix(current, current_song, 0, 1); run.assert_called_once(); destination = song_dir / "take-performance.mp3"; destination.write_bytes(b"partial"); run.side_effect = OSError("ffmpeg crashed"); recording_service._create_performance_mix(current, current_song, 0, 1); assert not destination.exists(); current_song.output_dir = None; run.reset_mock(); recording_service._create_performance_mix(current, current_song, 0, 1); run.assert_not_called()


def test_create_performance_mix_skips_missing_instrumental(monkeypatch, tmp_path):
    executable = tmp_path / "ffmpeg.exe"; executable.write_bytes(b"binary"); current_song = make_song(output_dir=str(tmp_path)); monkeypatch.setattr(recording_service.config, "FFMPEG_EXE", str(executable))
    patch_attrs(monkeypatch, recording_service.song_service, resolve_output_dir=Mock(return_value=tmp_path)); run = Mock(); monkeypatch.setattr(recording_service.subprocess, "run", run)
    recording_service._create_performance_mix(
        models.Recording(
            id="recording",
            song_id="song",
            filename="take.wav",
            path=str(tmp_path / "take.wav"),
        ),
        current_song,
        0,
        1,
    )
    run.assert_not_called()


def test_audio_backend_import_failure_degrades_without_crashing(monkeypatch):
    original_import = builtins.__import__

    def blocked_import(name, *args, **kwargs):
        if name in {"sounddevice", "soundfile"}: raise ImportError("optional audio dependency missing")
        return original_import(name, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(builtins, "__import__", blocked_import); reloaded = importlib.reload(recording_service); assert reloaded.backend_available() == (False, "optional audio dependency missing")

    importlib.reload(recording_service)
