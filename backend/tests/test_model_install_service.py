from unittest.mock import Mock

import config
from AI.engines.separation import MSSTMelRoformerSeparator
from AI.model_registry import ModelSpec, model_directory
from app.services import model_install_service


def _model() -> ModelSpec:
    return ModelSpec(
        key="recovery",
        name="Recovery model",
        repo_id="owner/repository",
        revision="revision",
        relative_path="recovery",
        env_var="RECOVERY_MODEL",
    )


def test_frozen_default_model_path_matches_installer(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "IS_FROZEN", True)
    monkeypatch.setenv("SONGAPP_INSTALL_ROOT", str(tmp_path / "A&D Voice"))

    assert config._default_models_dir() == tmp_path / "A&D Voice" / "data" / "models"


def test_separator_reports_each_missing_resource(monkeypatch, tmp_path):
    monkeypatch.delenv("MSST_CHECKPOINT", raising=False)
    separator = MSSTMelRoformerSeparator(
        engine_dir=str(tmp_path / "engine"),
        config=str(tmp_path / "config.yaml"),
        checkpoint=None,
    )

    missing = separator.missing_resources()

    assert any("MSST_ENGINE_DIR/inference.py" in item for item in missing)
    assert any("MSST_CONFIG" in item for item in missing)
    assert any("MSST_CHECKPOINT=<not configured>" in item for item in missing)


def test_model_status_reports_missing_resources(monkeypatch, tmp_path):
    model = _model()
    monkeypatch.setattr(model_install_service, "MODELS", (model,))
    monkeypatch.setattr(model_install_service.config, "MODELS_DIR", tmp_path / "models")
    model_install_service._set_state(state="idle", current_model=None, error=None)

    result = model_install_service.status()

    assert result["state"] == "missing"
    assert result["ready_count"] == 0
    assert result["models"] == [{"key": "recovery", "name": "Recovery model", "ready": False}]


def test_recovery_download_verifies_and_activates_models(monkeypatch, tmp_path):
    model = _model()
    models_root = tmp_path / "models"
    configured = []
    resets = []

    def install(root, _cache, resource, retries):
        assert retries == 3
        directory = model_directory(root, resource)
        directory.mkdir(parents=True)
        (directory / "config.json").write_text("{}", encoding="utf-8")
        (directory / "model.safetensors").write_bytes(b"weights")

    monkeypatch.setattr(model_install_service, "MODELS", (model,))
    monkeypatch.setattr(model_install_service, "install_one", install)
    monkeypatch.setattr(
        model_install_service.config,
        "configure_ai_resource_environment",
        lambda **options: configured.append(options),
    )
    monkeypatch.setattr("AI.service.reset_ai_service", lambda: resets.append(True))
    model_install_service._set_state(state="downloading", current_model=None, error=None)

    model_install_service._download_worker(models_root, tmp_path / "cache")

    assert model_install_service._state["state"] == "ready"
    assert configured == [{"force": True}]
    assert resets == [True]


def test_progress_values_tolerate_missing_and_invalid_entries(monkeypatch, tmp_path):
    monkeypatch.setattr(model_install_service.config, "APP_LOG_DIR", tmp_path)
    assert model_install_service._progress_values() == {}
    (tmp_path / "model-recovery-progress.txt").write_text(
        "downloaded_bytes=10\ntotal_bytes=bad\nignored\nremaining_seconds=4\n",
        encoding="utf-8",
    )
    assert model_install_service._progress_values() == {
        "downloaded_bytes": 10,
        "remaining_seconds": 4,
    }


def test_status_ready_overrides_stale_runtime_error(monkeypatch, tmp_path):
    model = _model()
    monkeypatch.setattr(model_install_service, "MODELS", (model,))
    monkeypatch.setattr(model_install_service.config, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(model_install_service, "is_valid", Mock(return_value=True))
    monkeypatch.setattr(
        model_install_service,
        "_progress_values",
        Mock(return_value={"downloaded_bytes": 42}),
    )
    model_install_service._set_state(state="error", current_model="stale", error="previous failure")

    result = model_install_service.status()

    assert result["state"] == "ready"
    assert result["ready"] is True
    assert result["current_model"] is None
    assert result["error"] is None
    assert result["downloaded_bytes"] == 42


def test_status_preserves_active_download_state(monkeypatch, tmp_path):
    monkeypatch.setattr(model_install_service, "MODELS", (_model(),))
    monkeypatch.setattr(model_install_service.config, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(model_install_service, "is_valid", Mock(return_value=False))
    model_install_service._set_state(state="downloading", current_model="Recovery", error=None)
    assert model_install_service.status()["state"] == "downloading"


def test_download_worker_skips_valid_models(monkeypatch, tmp_path):
    model = _model()
    reporter = Mock()
    monkeypatch.setattr(model_install_service, "MODELS", (model,))
    monkeypatch.setattr(model_install_service, "is_valid", Mock(return_value=True))
    monkeypatch.setattr(model_install_service, "ProgressReporter", Mock(return_value=reporter))
    install = Mock()
    monkeypatch.setattr(model_install_service, "install_one", install)
    monkeypatch.setattr(model_install_service.config, "configure_ai_resource_environment", Mock())
    monkeypatch.setattr("AI.service.reset_ai_service", Mock())

    model_install_service._download_worker(tmp_path / "models", tmp_path / "cache")

    install.assert_not_called()
    reporter.model_finished.assert_called_once_with(model.name)
    reporter.finish.assert_called_once_with(True)


def test_download_worker_reports_verification_failure(monkeypatch, tmp_path):
    reporter = Mock()
    monkeypatch.setattr(model_install_service, "MODELS", (_model(),))
    monkeypatch.setattr(model_install_service, "is_valid", Mock(return_value=False))
    monkeypatch.setattr(model_install_service, "install_one", Mock())
    monkeypatch.setattr(model_install_service, "ProgressReporter", Mock(return_value=reporter))
    model_install_service._set_state(state="downloading", current_model=None, error=None)

    model_install_service._download_worker(tmp_path / "models", tmp_path / "cache")

    assert model_install_service._state["state"] == "error"
    assert model_install_service._state["error"] == "Model verification failed after download"
    reporter.finish.assert_called_once_with(False)


def test_start_download_is_idempotent_and_spawns_daemon(monkeypatch, tmp_path):
    response = {"state": "test"}
    status = Mock(return_value=response)
    monkeypatch.setattr(model_install_service, "status", status)
    monkeypatch.setattr(model_install_service.config, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setattr(model_install_service.config, "CACHE_DIR", tmp_path / "cache")
    thread = Mock()
    thread_factory = Mock(return_value=thread)
    monkeypatch.setattr(model_install_service.threading, "Thread", thread_factory)

    model_install_service._set_state(state="downloading", current_model=None, error=None)
    assert model_install_service.start_download() is response
    thread_factory.assert_not_called()

    model_install_service._set_state(state="missing", current_model="old", error="old")
    assert model_install_service.start_download() is response
    thread_factory.assert_called_once_with(
        target=model_install_service._download_worker,
        args=((tmp_path / "models").resolve(), (tmp_path / "cache/model-downloads").resolve()),
        name="ai-model-recovery",
        daemon=True,
    )
    thread.start.assert_called_once_with()
    assert model_install_service._state == {
        "state": "downloading",
        "current_model": None,
        "error": None,
    }


def test_sync_recovery_repairs_before_processing(monkeypatch, tmp_path):
    model = _model()
    models_root = tmp_path / "models"
    monkeypatch.setattr(model_install_service, "MODELS", (model,))
    monkeypatch.setattr(model_install_service.config, "MODELS_DIR", models_root)
    monkeypatch.setattr(model_install_service.config, "CACHE_DIR", tmp_path / "cache-root")
    monkeypatch.setattr(model_install_service.config, "APP_LOG_DIR", tmp_path / "logs")
    configured = Mock()
    monkeypatch.setattr(model_install_service.config, "configure_ai_resource_environment", configured)
    monkeypatch.setattr("AI.service.reset_ai_service", Mock())

    def install(root, _cache, resource, retries):
        assert retries == 3
        directory = model_directory(root, resource)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "config.json").write_text("{}", encoding="utf-8")
        (directory / "model.safetensors").write_bytes(b"weights")

    monkeypatch.setattr(model_install_service, "install_one", install)
    model_install_service._set_state(state="idle", current_model=None, error=None)

    result = model_install_service.ensure_ready_sync()

    assert result["ready"] is True
    configured.assert_called_once_with(force=True)
