import json

from app.services import app_settings_service


def test_installer_preferences_merge_once_without_erasing_settings(monkeypatch, tmp_path):
    settings = tmp_path / "backend-data" / "settings.json"
    install_preferences = tmp_path / "install-preferences.json"
    settings.parent.mkdir()
    settings.write_text(
        json.dumps({"theme": "dark", "language": "uk", "online_name": "Singer"}),
        encoding="utf-8",
    )
    install_preferences.write_text(
        json.dumps({"theme": "violet", "language": "en", "unknown": "ignored"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings)
    monkeypatch.setattr(app_settings_service, "INSTALL_PREFERENCES_FILE", install_preferences)

    result = app_settings_service.read_settings()

    assert result["theme"] == "violet"
    assert result["language"] == "en"
    assert result["online_name"] == "Singer"
    assert not install_preferences.exists()


def test_invalid_installer_preferences_are_discarded(monkeypatch, tmp_path):
    settings = tmp_path / "settings.json"
    install_preferences = tmp_path / "install-preferences.json"
    install_preferences.write_text(
        json.dumps({"theme": "unknown", "language": "de"}), encoding="utf-8"
    )
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings)
    monkeypatch.setattr(app_settings_service, "INSTALL_PREFERENCES_FILE", install_preferences)

    result = app_settings_service.read_settings()

    assert result["theme"] == "dark"
    assert result["language"] == "uk"
    assert not install_preferences.exists()
