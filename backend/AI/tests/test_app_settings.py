import json

from app.services import app_settings_service


def test_update_settings_persists_only_supported_fields(tmp_path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings_file)

    updated = app_settings_service.update_settings(
        {"theme": "light", "whisper_model": "turbo", "unexpected": "ignored"}
    )

    assert updated["theme"] == "light"
    assert updated["whisper_model"] == "turbo"
    stored = json.loads(settings_file.read_text(encoding="utf-8"))
    assert stored == {**app_settings_service.DEFAULT_SETTINGS, "theme": "light"}


def test_read_settings_ignores_unknown_or_invalid_root_json(tmp_path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings_file)

    settings = app_settings_service.read_settings()

    assert settings["theme"] == app_settings_service.DEFAULT_SETTINGS["theme"]
