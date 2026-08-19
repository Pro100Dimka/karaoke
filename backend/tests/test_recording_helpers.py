from tests._shared import patch_attrs, make_song, raises, patch_many

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import recording_service


def recording(path, *, duration=12.5): return models.Recording(id='recording', song_id='song', filename='take.wav', path=str(path), duration_sec=duration, sample_rate=48000)


def test_capture_attempts_are_unique_and_survive_device_errors(monkeypatch):
    patch_attrs(monkeypatch, recording_service.sd, query_devices=Mock(side_effect=RuntimeError('device unavailable'))); attempts = recording_service._capture_attempts(None, None, 44_100, 0, False)
    assert attempts == [
        (None, None, 44_100, 0, False, "low"),
        (None, None, 44_100, 0, False, "high"),
    ]


def test_backend_status_and_session_controls(monkeypatch): patch_attrs(monkeypatch, recording_service, _AUDIO_BACKEND_AVAILABLE=False, _AUDIO_BACKEND_ERROR='PortAudio missing'); assert recording_service.backend_available() == (False, "PortAudio missing"); session = Mock(); monkeypatch.setattr(recording_service, "_sessions", {"active": session}); recording_service.pause_recording("active"); recording_service.resume_recording("active"); session.pause.assert_called_once_with(); session.resume.assert_called_once_with(); raises(KeyError, lambda: recording_service.pause_recording('missing'), match='missing'); recording_service.close_all_sessions(); session.close.assert_called_once_with(); assert recording_service._sessions == {}


def test_start_recording_uses_compatibility_fallback(monkeypatch): patch_many(monkeypatch, (recording_service, "_AUDIO_BACKEND_AVAILABLE", True), (recording_service.uuid, "uuid4", lambda: SimpleNamespace(hex="session"))); patch_attrs(monkeypatch, recording_service, _capture_attempts=lambda *_args: [(1, 2, 48000, 64, True, 'low'), (1, None, 48000, 0, False, 'high')]); failed = Mock(); failed.start.side_effect = RuntimeError("WDM host error"); fallback = Mock(); factory = Mock(side_effect=[failed, fallback]); patch_attrs(monkeypatch, recording_service, RecordingSession=factory, _sessions={}); assert recording_service.start_recording("song") == "session"; failed.close.assert_called_once_with(); fallback.start.assert_called_once_with(); assert recording_service._sessions == {"session": fallback}


def test_start_recording_reports_backend_and_final_driver_errors(monkeypatch): patch_attrs(monkeypatch, recording_service, _AUDIO_BACKEND_AVAILABLE=False, _AUDIO_BACKEND_ERROR='missing'); raises(RuntimeError, lambda: recording_service.start_recording('song'), match='missing'); patch_attrs(monkeypatch, recording_service, _AUDIO_BACKEND_AVAILABLE=True, _capture_attempts=lambda *_args: [(None, None, 44100, 0, False, 'high')], RecordingSession=Mock(side_effect=RuntimeError('driver rejected stream'))); raises(RuntimeError, lambda: recording_service.start_recording('song'), match='driver rejected stream')


def test_recording_paths_are_confined_to_library(monkeypatch, tmp_path): library = tmp_path / "library"; voice = library / "song" / "recordings" / "take.wav"; voice.parent.mkdir(parents=True); voice.write_bytes(b"voice"); monkeypatch.setattr(recording_service.config, "SONG_OUTPUT_DIR", library); current = recording(voice); assert (recording_service.resolve_recording_path(current) == voice.resolve()) and (recording_service.performance_mix_path(current).name == 'take-performance.mp3') and ([path.name for path in recording_service.performance_mix_paths(current)] == ['take-performance.mp3', 'take-performance.wav']); outside = recording(tmp_path / "outside.wav"); raises(ValueError, lambda: recording_service.resolve_recording_path(outside), match='outside')


def test_recording_deletion_includes_existing_voice_and_mixes(monkeypatch, tmp_path): library = tmp_path / "library"; voice, mix = library / 'take.wav', library / 'take-performance.mp3'; library.mkdir(); voice.write_bytes(b"voice"); mix.write_bytes(b"mix"); monkeypatch.setattr(recording_service.config, "SONG_OUTPUT_DIR", library); delete = Mock(); monkeypatch.setattr(recording_service, "delete_with_files", delete); database, current = Mock(), recording(voice); recording_service.delete_recording(database, current); assert delete.call_args.args == (database, current, (voice.resolve(), mix.resolve()))


@pytest.mark.parametrize(
    ("name", "amount", "fragment"),
    [
        ("reverb", 0.5, "55|110|170"),
        ("echo", 0.5, "180|360"),
        ("delay", 0.5, "305"),
        ("unknown", 1, None),
        ("echo", 0, None),
    ],
)
def test_effect_filters_are_bounded(name, amount, fragment): result = recording_service._effect_filter(name, amount, "in", "out"); assert (fragment in result) if fragment else result is None


def test_performance_mix_command_contains_timing_effects_and_lossy_output(tmp_path):
    current = recording(tmp_path / "take.wav")
    command = recording_service._performance_mix_command(
        "ffmpeg",
        current,
        tmp_path / "instrumental.mp3",
        tmp_path / "mix.mp3",
        1.25,
        0.8,
        {"reverb": 0.5, "unknown": 1},
    )
    assert (command[command.index('-ss') + 1] == '1.250') and (command[command.index('-t') + 1] == '12.500'); filters = command[command.index("-filter_complex") + 1]; assert ('volume=0.800000' in filters) and ('aecho' in filters) and (command[-4:] == ['libmp3lame', '-b:a', '320k', str(tmp_path / 'mix.mp3')])


def test_instrumental_lookup_and_optional_mix_fail_safely(monkeypatch, tmp_path):
    assert recording_service._find_instrumental(tmp_path) is None; separated = tmp_path / "separated"; separated.mkdir(); instrumental = separated / "instrumental.wav"
    instrumental.write_bytes(b"music"); assert recording_service._find_instrumental(tmp_path) == instrumental; instrumental.unlink(); optimized = separated / "instrumental.flac"
    optimized.write_bytes(b"lossless"); assert recording_service._find_instrumental(tmp_path) == optimized; optimized.unlink(); legacy = tmp_path / "instrumental.wav"
    legacy.write_bytes(b"legacy"); assert recording_service._find_instrumental(tmp_path) == legacy

    create = Mock(side_effect=RuntimeError("ffmpeg failed")); monkeypatch.setattr(recording_service, "_create_performance_mix", create)
    recording_service._create_performance_mix_safely(
        recording(tmp_path / "take.wav"),
        make_song(),
        0,
        1,
    )
    create.assert_called_once()


def test_recording_path_remains_accessible_in_historical_library_root(monkeypatch, tmp_path): current, historical = tmp_path / 'current', tmp_path / 'historical'; current.mkdir(); voice = historical / "song" / "recordings" / "take.wav"; voice.parent.mkdir(parents=True); voice.write_bytes(b"voice"); patch_attrs(monkeypatch, recording_service.config, SONG_OUTPUT_DIR=current, SONG_LIBRARY_ROOTS={current.resolve(), historical.resolve()}); assert recording_service.resolve_recording_path(recording(voice)) == voice.resolve()
