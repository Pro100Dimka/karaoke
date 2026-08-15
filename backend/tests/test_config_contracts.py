from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import config


def test_environment_path_integer_and_csv_helpers(monkeypatch, tmp_path):
    monkeypatch.delenv("TEST_PATH", raising=False)
    assert config._env_path("TEST_PATH", tmp_path) == tmp_path
    monkeypatch.setenv("TEST_PATH", str(tmp_path / "nested" / ".." / "target"))
    assert config._env_path("TEST_PATH", tmp_path) == (tmp_path / "target").resolve()

    monkeypatch.delenv("TEST_INT", raising=False)
    assert config._env_int("TEST_INT", 3, minimum=1, maximum=5) == 3
    monkeypatch.setenv("TEST_INT", "4")
    assert config._env_int("TEST_INT", 3, minimum=1, maximum=5) == 4
    for invalid in ("text", "0", "6"):
        monkeypatch.setenv("TEST_INT", invalid)
        with pytest.raises(ValueError, match="TEST_INT"):
            config._env_int("TEST_INT", 3, minimum=1, maximum=5)
    monkeypatch.setenv("TEST_INT", "0")
    with pytest.raises(ValueError, match=">= 1"):
        config._env_int("TEST_INT", 3, minimum=1)

    monkeypatch.delenv("TEST_CSV", raising=False)
    assert config._unique_csv("TEST_CSV", ("a", "b")) == ("a", "b")
    monkeypatch.setenv("TEST_CSV", " b, a, b, ,c ")
    assert config._unique_csv("TEST_CSV", ()) == ("b", "a", "c")


def test_runtime_executable_prefers_bundled_binary_then_path(monkeypatch, tmp_path):
    executable_dir = tmp_path / "python"
    runtime_dir = tmp_path / "runtime"
    base_dir = tmp_path / "base"
    executable_dir.mkdir()
    runtime_dir.mkdir()
    base_dir.mkdir()
    monkeypatch.setattr(config.sys, "executable", str(executable_dir / "python.exe"))
    monkeypatch.setattr(config, "RUNTIME_DIR", runtime_dir)
    monkeypatch.setattr(config, "BASE_DIR", base_dir)

    bundled_name = "tool.exe" if config.os.name == "nt" else "tool"
    bundled = runtime_dir / bundled_name
    bundled.write_bytes(b"binary")
    assert config.resolve_runtime_executable("tool") == str(bundled)
    bundled.unlink()

    monkeypatch.setattr(config.shutil, "which", Mock(return_value="C:/bin/tool.exe"))
    assert config.resolve_runtime_executable("tool.exe") == "C:/bin/tool.exe"
    config.shutil.which.return_value = None
    assert config.resolve_runtime_executable("missing") == "missing"


def test_default_data_and_models_directories_cover_runtime_modes(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "IS_FROZEN", False)
    monkeypatch.setattr(config, "PROJECT_ROOT", tmp_path / "project")
    monkeypatch.setattr(config, "DOWNLOADS_DIR", tmp_path / "downloads")
    assert config._default_data_dir() == tmp_path / "project" / "data"
    assert config._default_models_dir() == tmp_path / "downloads" / "models"

    monkeypatch.setattr(config, "IS_FROZEN", True)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    assert config._default_data_dir() == tmp_path / "local" / "A&D Voice"
    assert config._default_models_dir() == tmp_path / "local" / "A&D Voice" / "models"

    monkeypatch.delenv("LOCALAPPDATA")
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path / "home"))
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    assert config._default_data_dir() == tmp_path / "home" / "AppData" / "Local" / "A&D Voice"
    assert config._default_models_dir() == tmp_path / "data" / "models"


def test_saved_storage_path_is_validated(monkeypatch, tmp_path):
    settings = tmp_path / "paths.json"
    default = tmp_path / "default"
    monkeypatch.setattr(config, "PATH_SETTINGS_FILE", settings)

    assert config._saved_path("songs_folder", default) == default
    settings.write_text("invalid", encoding="utf-8")
    assert config._saved_path("songs_folder", default) == default
    settings.write_text('[["songs_folder", "ignored"]]', encoding="utf-8")
    assert config._saved_path("songs_folder", default) == default
    settings.write_text('{"songs_folder": "   "}', encoding="utf-8")
    assert config._saved_path("songs_folder", default) == default
    selected = tmp_path / "selected"
    settings.write_text(f'{{"songs_folder": "{selected.as_posix()}"}}', encoding="utf-8")
    assert config._saved_path("songs_folder", default) == selected.resolve()



def test_saved_storage_path_from_previous_dev_checkout_uses_current_default(monkeypatch, tmp_path):
    current_root = tmp_path / "D" / "Git" / "karaoke"
    old_root = tmp_path / "E" / "Git" / "karaoke"
    current_default = current_root / "karaoke_songs"
    settings = tmp_path / "paths.json"
    settings.write_text(
        '{"songs_folder": "' + (old_root / "karaoke_songs").as_posix() + '"}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "IS_FROZEN", False)
    monkeypatch.setattr(config, "PROJECT_ROOT", current_root)
    monkeypatch.setattr(config, "PATH_SETTINGS_FILE", settings)
    assert config._saved_path("songs_folder", current_default) == current_default

    external = tmp_path / "external-library"
    settings.write_text(
        '{"songs_folder": "' + external.as_posix() + '"}', encoding="utf-8"
    )
    assert config._saved_path("songs_folder", current_default) == external.resolve()

def test_apply_storage_paths_updates_only_supplied_values(monkeypatch, tmp_path):
    original_models = config.MODELS_DIR
    ensure = Mock()
    configure = Mock()
    monkeypatch.setattr(config, "ensure_directories", ensure)
    monkeypatch.setattr(config, "configure_ai_resource_environment", configure)

    config.apply_storage_paths(
        songs_folder=str(tmp_path / "songs"),
        ai_folder=str(tmp_path / "models"),
        cache_folder=str(tmp_path / "cache"),
    )
    assert (tmp_path / "songs").resolve() == config.SONG_OUTPUT_DIR
    assert (tmp_path / "models").resolve() == config.MODELS_DIR
    assert (tmp_path / "cache").resolve() == config.CACHE_DIR
    assert (tmp_path / "cache" / "uploads").resolve() == config.UPLOAD_TEMP_DIR
    ensure.assert_called_once_with()
    configure.assert_called_once_with(force=True)

    monkeypatch.setattr(config, "MODELS_DIR", original_models)


def test_ai_resource_environment_uses_existing_downloads(monkeypatch, tmp_path):
    models_dir = tmp_path / "models"
    engine_dir = tmp_path / "engines" / "msst"
    config_file = (
        engine_dir / "configs" / "KimberleyJensen" / "config_vocals_mel_band_roformer_kj.yaml"
    )
    checkpoint = models_dir / "pitch.pt"
    snapshot = models_dir / "asr"
    config_file.parent.mkdir(parents=True)
    config_file.write_text("model: test", encoding="utf-8")
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"model")
    snapshot.mkdir()
    resources = (
        SimpleNamespace(key="pitch", env_var="TEST_PITCH", kind="file"),
        SimpleNamespace(key="asr", env_var="TEST_ASR", kind="snapshot"),
    )
    monkeypatch.setattr(config, "MODELS", resources)
    monkeypatch.setattr(config, "MODELS_DIR", models_dir)
    monkeypatch.setattr(config, "EXTERNAL_ENGINES_DIR", tmp_path / "engines")
    monkeypatch.setattr(
        config,
        "model_path",
        lambda _root, model: checkpoint if model.key == "pitch" else snapshot,
    )
    for name in (
        "TEST_PITCH",
        "TEST_ASR",
        "MSST_ENGINE_DIR",
        "MSST_CONFIG",
        "KARAOKE_AI_REQUIRE_CTC",
    ):
        monkeypatch.delenv(name, raising=False)

    config.configure_ai_resource_environment()

    assert config.os.environ["TEST_PITCH"] == str(checkpoint)
    assert config.os.environ["TEST_ASR"] == str(snapshot)
    assert config.os.environ["MSST_ENGINE_DIR"] == str(engine_dir)
    assert config.os.environ["MSST_CONFIG"] == str(config_file)
    assert config.os.environ["KARAOKE_AI_REQUIRE_CTC"] == "1"

    alternate = tmp_path / "alternate.pt"
    alternate.write_bytes(b"old")
    monkeypatch.setenv("TEST_PITCH", str(alternate))
    config.configure_ai_resource_environment()
    assert config.os.environ["TEST_PITCH"] == str(alternate)
    config.configure_ai_resource_environment(force=True)
    assert config.os.environ["TEST_PITCH"] == str(checkpoint)


def test_ensure_directories_creates_every_runtime_location(monkeypatch, tmp_path):
    paths = [tmp_path / name for name in ("songs", "uploads", "cache", "data", "logs")]
    for attribute, path in zip(
        ("SONG_OUTPUT_DIR", "UPLOAD_TEMP_DIR", "CACHE_DIR", "DATA_DIR", "APP_LOG_DIR"),
        paths,
        strict=True,
    ):
        monkeypatch.setattr(config, attribute, path)
    config.ensure_directories()
    assert all(path.is_dir() for path in paths)
