from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

import models
import schemas
from app.routers import analysis, audio


def test_audio_router_forwards_devices_settings_and_selection(monkeypatch):
    database = Mock()
    monkeypatch.setattr(audio.audio_service, "list_input_devices", Mock(return_value=[{"i": 1}]))
    monkeypatch.setattr(audio.audio_service, "list_output_devices", Mock(return_value=[{"o": 1}]))
    monkeypatch.setattr(audio.audio_service, "list_asio_drivers", Mock(return_value=["ASIO"]))
    current = SimpleNamespace(input_device_id=2, volume=1, monitoring_enabled=False)
    monkeypatch.setattr(audio.audio_service, "get_settings", Mock(return_value=current))
    update = Mock(return_value=current)
    monkeypatch.setattr(audio.audio_service, "update_settings", update)
    monitor = Mock(return_value=current)
    monkeypatch.setattr(audio.audio_service, "set_monitoring_enabled", monitor)

    assert audio.list_devices() == [{"i": 1}]
    assert audio.list_output_devices() == [{"o": 1}]
    assert audio.list_asio_drivers() == [{"name": "ASIO"}]
    assert audio.get_settings(database) is current
    assert audio.update_settings(schemas.AudioSettingsUpdate(volume=2), database) is current
    update.assert_called_with(database, {"volume": 2.0})
    assert audio.start_direct_monitoring(database) is current
    assert audio.stop_direct_monitoring(database) is current
    assert audio.select_device(4, database) is current
    update.assert_called_with(database, {"input_device_id": 4})


def test_audio_router_translates_runtime_failures(monkeypatch):
    database = Mock()
    monkeypatch.setattr(
        audio.audio_service,
        "update_settings",
        Mock(side_effect=RuntimeError("device failed")),
    )
    with pytest.raises(HTTPException) as update_error:
        audio.update_settings(schemas.AudioSettingsUpdate(volume=2), database)
    assert update_error.value.status_code == 503

    monkeypatch.setattr(
        audio.audio_service,
        "set_monitoring_enabled",
        Mock(side_effect=RuntimeError("monitor failed")),
    )
    with pytest.raises(HTTPException) as monitor_error:
        audio.start_direct_monitoring(database)
    assert monitor_error.value.status_code == 503


def test_signal_quality_uses_persisted_gain_and_monitor_state(monkeypatch):
    database = Mock()
    current = SimpleNamespace(input_device_id=2, volume=1.5, monitoring_enabled=True)
    monkeypatch.setattr(audio.audio_service, "get_settings", Mock(return_value=current))
    check = Mock(return_value={"rms_db": -10})
    monkeypatch.setattr(audio.audio_service, "check_signal_quality", check)
    assert audio.signal_quality(database) == {"rms_db": -10}
    check.assert_called_once_with(2, gain=1.5, monitoring_expected=True)
    check.side_effect = RuntimeError("unavailable")
    with pytest.raises(HTTPException) as unavailable:
        audio.signal_quality(database)
    assert unavailable.value.status_code == 503


def analysis_result(**changes):
    values = {
        "id": "analysis",
        "recording_id": "recording",
        "pitch_accuracy_percent": 90,
        "mean_deviation_semitones": 0.2,
        "sections_json": '[{"label":"verse"}]',
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
    }
    values.update(changes)
    return models.AnalysisResult(**values)


def test_analysis_output_and_read_endpoints():
    result = analysis_result()
    output = analysis._to_out(result)
    assert output.sections == [{"label": "verse"}]
    assert analysis.get_analysis(result) == output
    assert analysis.get_accuracy(result) == {"pitch_accuracy_percent": 90}
    assert analysis.get_deviation(result) == {"mean_deviation_semitones": 0.2}
    assert analysis.get_sections(result) == {"sections": [{"label": "verse"}]}


def test_run_analysis_handles_missing_song_existing_and_domain_failure(monkeypatch):
    recording = SimpleNamespace(id="recording", song_id="song")
    database = Mock()
    monkeypatch.setattr(analysis.repositories, "get_song", Mock(return_value=None))
    with pytest.raises(HTTPException) as missing:
        analysis.run_analysis(recording, database)
    assert missing.value.status_code == 404

    song = object()
    analysis.repositories.get_song.return_value = song
    existing = analysis_result()
    monkeypatch.setattr(
        analysis.repositories,
        "get_analysis_by_recording",
        Mock(return_value=existing),
    )
    assert analysis.run_analysis(recording, database).id == "analysis"

    analysis.repositories.get_analysis_by_recording.return_value = None
    monkeypatch.setattr(
        analysis.analysis_service,
        "analyze_recording",
        Mock(side_effect=ValueError("reference missing")),
    )
    with pytest.raises(HTTPException) as conflict:
        analysis.run_analysis(recording, database)
    assert conflict.value.status_code == 409


def test_run_analysis_persists_result_and_recovers_insert_race(monkeypatch):
    recording = SimpleNamespace(id="recording", song_id="song")
    database = Mock()
    monkeypatch.setattr(analysis.repositories, "get_song", Mock(return_value=object()))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(analysis.repositories, "get_analysis_by_recording", lookup)
    monkeypatch.setattr(
        analysis.analysis_service,
        "analyze_recording",
        Mock(
            return_value={
                "pitch_accuracy_percent": 80,
                "mean_deviation_semitones": 0.4,
                "sections": [{"label": "verse"}],
            }
        ),
    )
    database.refresh.side_effect = lambda result: (
        setattr(result, "id", "new"),
        setattr(result, "created_at", datetime(2026, 1, 1, tzinfo=UTC)),
    )
    assert analysis.run_analysis(recording, database).id == "new"

    database.reset_mock()
    database.commit.side_effect = IntegrityError("insert", {}, Exception("duplicate"))
    stored = analysis_result(id="winner")
    lookup.side_effect = [None, stored]
    assert analysis.run_analysis(recording, database).id == "winner"
    database.rollback.assert_called_once_with()


def test_run_analysis_reraises_database_failures(monkeypatch):
    recording = SimpleNamespace(id="recording", song_id="song")
    database = Mock()
    monkeypatch.setattr(analysis.repositories, "get_song", Mock(return_value=object()))
    lookup = Mock(return_value=None)
    monkeypatch.setattr(analysis.repositories, "get_analysis_by_recording", lookup)
    monkeypatch.setattr(
        analysis.analysis_service,
        "analyze_recording",
        Mock(
            return_value={
                "pitch_accuracy_percent": None,
                "mean_deviation_semitones": None,
                "sections": None,
            }
        ),
    )
    database.commit.side_effect = IntegrityError("insert", {}, Exception("duplicate"))
    with pytest.raises(IntegrityError):
        analysis.run_analysis(recording, database)
    database.rollback.assert_called_once_with()

    database.reset_mock()
    database.commit.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        analysis.run_analysis(recording, database)
    database.rollback.assert_called_once_with()
