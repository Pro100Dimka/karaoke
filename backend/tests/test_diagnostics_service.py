import builtins
import importlib.metadata
from datetime import UTC, datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

from app.services import diagnostics_service
from tests._shared import patch_attrs


def test_ffmpeg_and_package_availability(monkeypatch):
    monkeypatch.setattr(diagnostics_service.config, "FFMPEG_EXE", "ffmpeg")
    assert diagnostics_service._ffmpeg_available() is False
    monkeypatch.setattr(diagnostics_service.config, "FFMPEG_EXE", "C:/ffmpeg.exe")
    assert diagnostics_service._ffmpeg_available() is True

    monkeypatch.setattr(importlib.metadata, "version", Mock(return_value="1.0"))
    assert diagnostics_service._package_available("package") is True
    importlib.metadata.version.side_effect = importlib.metadata.PackageNotFoundError
    assert diagnostics_service._package_available("missing") is False


def test_torch_and_ai_detection_degrade_on_import_failure(monkeypatch):
    original_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "torch" or name == "AI" or name.startswith("AI."): raise ImportError(name)
        return original_import(name, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(builtins, "__import__", blocked)
        assert diagnostics_service._torch_info() == (False, False, None)
        assert diagnostics_service._ai_package_available() is False

    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True), __version__="2.8")
    monkeypatch.setitem(__import__("sys").modules, "torch", torch)
    assert diagnostics_service._torch_info() == (True, True, "2.8")
    monkeypatch.delitem(__import__("sys").modules, "torch")
    ai_service = ModuleType("AI.service")
    ai_service.AICoreService = object
    monkeypatch.setitem(__import__("sys").modules, "AI.service", ai_service)
    assert diagnostics_service._ai_package_available() is True


def test_pipeline_health_combines_runtime_components(monkeypatch):
    patch_attrs(monkeypatch, diagnostics_service, _torch_info=Mock(return_value=(True, False, '2')), _ffmpeg_available=Mock(return_value=True), _package_available=Mock(return_value=True), _ai_package_available=Mock(return_value=True))
    from app.services import ai_bridge

    patch_attrs(monkeypatch, ai_bridge, get_ai_service=Mock(return_value=SimpleNamespace(health=lambda: {'separation_configured': True, 'runtime': {'selected': {'pitch': 'cpu'}}})))
    assert diagnostics_service.pipeline_health() == {
        "ffmpeg_available": True,
        "demucs_available": True,
        "whisper_available": True,
        "torch_available": True,
        "cuda_available": False,
        "ai_dir_found": True,
        "runtime": {"selected": {"pitch": "cpu"}},
    }
    ai_bridge.get_ai_service.side_effect = RuntimeError("AI unavailable")
    unavailable = diagnostics_service.pipeline_health()
    assert unavailable["demucs_available"] is False and unavailable["runtime"] is None


def test_versions_reports_components_and_missing_packages(monkeypatch):
    monkeypatch.setattr(diagnostics_service, "_torch_info", Mock(return_value=(True, False, "2.8")))
    patch_attrs(monkeypatch, diagnostics_service.subprocess, run=Mock(return_value=SimpleNamespace(stdout='ffmpeg version 8\nconfiguration')))
    versions = {"qwen-asr": "1", "torchfcpe": "2", "librosa": "3"}

    def package_version(name):
        if name not in versions: raise importlib.metadata.PackageNotFoundError(name)
        return versions[name]

    monkeypatch.setattr(importlib.metadata, "version", package_version)
    result = diagnostics_service.versions()
    assert ((result['components']['torch'], result['components']['ffmpeg'], result['components']['qwen_asr']) == ('2.8', 'ffmpeg version 8', '1')) and (result['components']['mido'] is None) and (result['components']['ai_build'])


def test_versions_tolerates_ai_and_ffmpeg_failures(monkeypatch):
    monkeypatch.setattr(diagnostics_service, "_torch_info", Mock(return_value=(False, False, None)))
    patch_attrs(monkeypatch, diagnostics_service.subprocess, run=Mock(side_effect=OSError('missing executable')))
    patch_attrs(monkeypatch, importlib.metadata, version=Mock(side_effect=importlib.metadata.PackageNotFoundError))
    original_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "AI.pipeline": raise ImportError(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    components = diagnostics_service.versions()["components"]
    assert (components['ai_build'] is None) and (components['ai_pipeline'] is None) and (components['ffmpeg'] is None)


def test_versions_handles_ffmpeg_without_stdout(monkeypatch):
    monkeypatch.setattr(diagnostics_service, "_torch_info", Mock(return_value=(False, False, None)))
    patch_attrs(monkeypatch, diagnostics_service.subprocess, run=Mock(return_value=SimpleNamespace(stdout='')))
    patch_attrs(monkeypatch, importlib.metadata, version=Mock(side_effect=importlib.metadata.PackageNotFoundError))
    assert diagnostics_service.versions()["components"]["ffmpeg"] is None


def test_recent_errors_serializes_and_closes_database(monkeypatch):
    updated = datetime(2026, 1, 2, tzinfo=UTC)
    songs, query = [SimpleNamespace(id='one', title='One', error_message='failed', updated_at=updated), SimpleNamespace(id='two', title='Two', error_message=None, updated_at=None)], Mock()
    query.filter.return_value.order_by.return_value.limit.return_value.all.return_value = songs
    database = Mock()
    database.query.return_value = query
    import database as database_module

    monkeypatch.setattr(database_module, "SessionLocal", Mock(return_value=database))
    result = diagnostics_service.recent_errors(2)
    assert result == [
        {
            "song_id": "one",
            "title": "One",
            "error_message": "failed",
            "updated_at": updated.isoformat(),
        },
        {"song_id": "two", "title": "Two", "error_message": None, "updated_at": None},
    ]
    query.filter.return_value.order_by.return_value.limit.assert_called_once_with(2)
    database.close.assert_called_once_with()
