import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.services import app_settings_service
from tests._shared import patch_attrs, raises


def test_installer_preferences_merge_once_without_erasing_settings(monkeypatch, tmp_path):
    settings, install_preferences = tmp_path / 'backend-data' / 'settings.json', tmp_path / 'install-preferences.json'
    settings.parent.mkdir()
    settings.write_text(
        json.dumps({"theme": "dark", "language": "uk", "online_name": "Singer"}),
        encoding="utf-8",
    )
    install_preferences.write_text(
        json.dumps({"theme": "violet", "language": "en", "unknown": "ignored"}),
        encoding="utf-8",
    )
    patch_attrs(monkeypatch, app_settings_service, SETTINGS_FILE=settings, INSTALL_PREFERENCES_FILE=install_preferences)

    result = app_settings_service.read_settings()

    assert ((result['theme'], result['language'], result['online_name']) == ('violet', 'en', 'Singer')) and (not install_preferences.exists())


def test_invalid_installer_preferences_are_discarded(monkeypatch, tmp_path):
    settings, install_preferences = tmp_path / 'settings.json', tmp_path / 'install-preferences.json'
    install_preferences.write_text(
        json.dumps({"theme": "unknown", "language": "de"}), encoding="utf-8"
    )
    patch_attrs(monkeypatch, app_settings_service, SETTINGS_FILE=settings, INSTALL_PREFERENCES_FILE=install_preferences)

    result = app_settings_service.read_settings()

    assert ((result['theme'], result['language']) == ('dark', 'uk')) and (not install_preferences.exists())


def configure_files(monkeypatch, tmp_path):
    settings, paths, install, ui = tmp_path / 'settings.json', tmp_path / 'path-settings.json', tmp_path / 'install-preferences.json', tmp_path / 'ui-preferences.json'
    patch_attrs(monkeypatch, app_settings_service, SETTINGS_FILE=settings, PATH_SETTINGS_FILE=paths, INSTALL_PREFERENCES_FILE=install, UI_PREFERENCES_FILE=ui)
    return settings, paths, install, ui


def test_directory_normalization_validates_input_and_write_access(monkeypatch, tmp_path):
    raises(ValueError, lambda: app_settings_service._normalize_writable_directory(None, 'Песни'), match='выберите папку')
    raises(ValueError, lambda: app_settings_service._normalize_writable_directory(' ', 'Песни'), match='выберите папку')

    selected = tmp_path / "new"
    assert (app_settings_service._normalize_writable_directory(str(selected), 'Песни') == str(selected.resolve())) and (selected.is_dir() and (not list(selected.glob('.advoice-write-test-*'))))

    monkeypatch.setattr(Path, "mkdir", Mock(side_effect=OSError("denied")))
    raises(ValueError, lambda: app_settings_service._normalize_writable_directory(str(tmp_path / 'denied'), 'Кэш'), match='Нет доступа')


@pytest.mark.parametrize(
    ("legacy", "expected"),
    [
        ({"use_gpu": True, "use_cpu": True}, "auto"),
        ({"use_gpu": True, "use_cpu": False}, "cuda"),
        ({"use_gpu": False, "use_cpu": True}, "cpu"),
    ],
)
def test_legacy_compute_settings_are_migrated(monkeypatch, tmp_path, legacy, expected):
    settings, _paths, _install, _ui = configure_files(monkeypatch, tmp_path)
    settings.write_text(json.dumps(legacy), encoding="utf-8")
    assert app_settings_service.read_settings()["compute_mode"] == expected


def test_settings_recover_from_invalid_or_non_object_json(monkeypatch, tmp_path):
    settings, _paths, install, _ui = configure_files(monkeypatch, tmp_path)
    settings.write_text("invalid", encoding="utf-8")
    install.write_text("[]", encoding="utf-8")
    assert app_settings_service.read_settings()["language"] == "uk"

    settings.write_text("[]", encoding="utf-8")
    assert app_settings_service.read_settings()["theme"] == "dark"


def test_settings_recover_when_installer_preferences_cannot_be_read(monkeypatch, tmp_path):
    configure_files(monkeypatch, tmp_path)
    reads = Mock(side_effect=[{}, OSError("locked")])
    monkeypatch.setattr(app_settings_service, "read_json", reads)
    assert app_settings_service.read_settings()["language"] == "uk"


def test_update_settings_validates_compute_and_applies_storage_paths(monkeypatch, tmp_path):
    _settings, paths, _install, _ui = configure_files(monkeypatch, tmp_path)
    apply_paths = Mock()
    monkeypatch.setattr(app_settings_service.config, "apply_storage_paths", apply_paths)
    patch_attrs(monkeypatch, app_settings_service, path_settings=lambda: {'songs_folder': str(tmp_path / 'old-songs'), 'ai_folder': str(tmp_path / 'old-models'), 'cache_folder': str(tmp_path / 'old-cache')})

    raises(ValueError, lambda: app_settings_service.update_settings({'compute_mode': 'quantum'}), match='Unsupported')

    selected = tmp_path / "songs"
    result = app_settings_service.update_settings(
        {"theme": "violet", "songs_folder": str(selected)}
    )
    assert result["theme"] == "violet"
    persisted_paths = json.loads(paths.read_text(encoding="utf-8"))
    assert persisted_paths["songs_folder"] == str(selected.resolve())
    apply_paths.assert_called_once_with(**persisted_paths)


def test_ui_preferences_filter_merge_validate_and_copy(monkeypatch, tmp_path):
    _settings, _paths, _install, ui = configure_files(monkeypatch, tmp_path)
    ui.write_text("invalid", encoding="utf-8")
    assert app_settings_service.read_ui_preferences() == {}
    ui.write_text("[]", encoding="utf-8")
    assert app_settings_service.read_ui_preferences() == {}
    ui.write_text(
        json.dumps({"karaoke": {"speed": 1}, "unknown": {"x": 1}, "radio": "bad"}),
        encoding="utf-8",
    )
    preferences = app_settings_service.read_ui_preferences()
    assert preferences == {"karaoke": {"speed": 1}}
    preferences["karaoke"]["speed"] = 2
    assert app_settings_service.read_ui_preferences()["karaoke"]["speed"] == 1

    updated = app_settings_service.update_ui_preferences("karaoke", {"volume": 0.5})
    assert updated == {"speed": 1, "volume": 0.5}
    updated["volume"] = 0
    assert app_settings_service.read_ui_preferences()["karaoke"]["volume"] == 0.5

    raises(ValueError, lambda: app_settings_service.update_ui_preferences('unknown', {}), match='Unknown preference')
    raises(ValueError, lambda: app_settings_service.update_ui_preferences('karaoke', {'value': 'x' * 33000}), match='too large')
