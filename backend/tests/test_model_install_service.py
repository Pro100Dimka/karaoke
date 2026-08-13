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
    model_install_service._set_state(state="downloading", current_model=None, error=None)

    model_install_service._download_worker(models_root, tmp_path / "cache")

    assert model_install_service._state["state"] == "ready"
    assert configured == [{"force": True}]
