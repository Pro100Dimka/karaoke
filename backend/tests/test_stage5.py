import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

import schemas
from app.routers import recording as recording_router
from app.services import song_package_service


def _request(**overrides):
    values = {
        "song_id": "song-1",
        "position_sec": 0,
        "music_volume": 1,
        "microphone_volume": 1.5,
        "reverb": 0.2,
        "echo": 0.3,
        "delay": 0.4,
    }
    values.update(overrides)
    return schemas.RecordingStartRequest(**values)


def _settings(driver="asio"):
    return SimpleNamespace(
        audio_driver=driver,
        monitoring_enabled=False,
        volume=0.6,
        reverb=0.1,
        echo=0.1,
        delay=0.1,
    )


def test_configure_recording_monitor_restores_persisted_values(monkeypatch):
    settings = _settings()
    original = vars(settings).copy()
    observed = {}

    def configure(value):
        observed.update(vars(value))

    monkeypatch.setattr(recording_router.audio_service, "configure_monitoring", configure)
    assert recording_router._configure_recording_monitor(settings, _request()) is True
    assert observed["monitoring_enabled"] is True
    assert observed["volume"] == 1.5
    assert vars(settings) == original


def test_configure_recording_monitor_stops_non_asio_monitor(monkeypatch):
    calls = []
    monkeypatch.setattr(recording_router.audio_service, "stop_monitoring", lambda: calls.append(True))
    assert recording_router._configure_recording_monitor(_settings("wasapi"), _request()) is False
    assert calls == [True]


def test_restore_monitoring_falls_back_to_stop(monkeypatch):
    calls = []
    monkeypatch.setattr(recording_router.audio_service, "get_settings", lambda db: object())
    monkeypatch.setattr(
        recording_router.audio_service,
        "configure_monitoring",
        lambda settings: (_ for _ in ()).throw(RuntimeError("device unavailable")),
    )
    monkeypatch.setattr(recording_router.audio_service, "stop_monitoring", lambda: calls.append(True))
    recording_router._restore_monitoring(object())
    assert calls == [True]


def test_package_manifest_must_be_an_object(tmp_path: Path):
    package = tmp_path / "song.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", json.dumps(["not", "an", "object"]))
    with zipfile.ZipFile(package) as archive, pytest.raises(ValueError, match="manifest"):
        song_package_service._read_manifest(archive)


def test_package_identity_trims_required_fields():
    assert song_package_service._package_identity({"id": " x ", "title": " Song "}) == (
        "x",
        "Song",
    )


def test_source_member_requires_exactly_one_audio_file():
    members = [
        SimpleNamespace(filename="source/a.mp3", is_dir=lambda: False),
        SimpleNamespace(filename="source/b.wav", is_dir=lambda: False),
    ]
    with pytest.raises(ValueError, match="one source"):
        song_package_service._source_member(members)


def test_source_member_rejects_unsupported_extension():
    member = SimpleNamespace(filename="source/a.exe", is_dir=lambda: False)
    with pytest.raises(ValueError, match="not supported"):
        song_package_service._source_member([member])


def test_copy_archive_member_creates_parent_directories(tmp_path: Path):
    package = tmp_path / "song.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("output/nested/data.json", b"{}")
    destination = tmp_path / "target" / "nested" / "data.json"
    with zipfile.ZipFile(package) as archive:
        song_package_service._copy_archive_member(
            archive,
            archive.getinfo("output/nested/data.json"),
            destination,
        )
    assert destination.read_bytes() == b"{}"


def test_effect_filter_ignores_unknown_and_negligible_effects():
    from app.services import recording_service

    assert recording_service._effect_filter("unknown", 1, "a", "b") is None
    assert recording_service._effect_filter("echo", 0.001, "a", "b") is None


def test_effect_filter_clamps_amount():
    from app.services import recording_service

    value = recording_service._effect_filter("delay", 5, "a", "b")
    assert value is not None
    assert "500" in value


def test_performance_mix_command_contains_expected_graph(tmp_path: Path):
    from app.services import recording_service

    recording = SimpleNamespace(path=str(tmp_path / "take.wav"), duration_sec=12.5)
    command = recording_service._performance_mix_command(
        "ffmpeg",
        recording,
        tmp_path / "instrumental.wav",
        tmp_path / "mix.mp3",
        1.25,
        0.8,
        {"reverb": 0.5},
    )
    graph = command[command.index("-filter_complex") + 1]
    assert command[:4] == ["ffmpeg", "-y", "-ss", "1.250"]
    assert "amix=inputs=2" in graph
    assert "performer1" in graph
    assert command[-1].endswith("mix.mp3")
