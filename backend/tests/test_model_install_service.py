import queue
import sys

import config
from AI.engines.separation import MSSTMelRoformerSeparator, _run_msst_worker
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
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    assert config._default_models_dir() == tmp_path / "A&D Voice" / "models"


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


def test_msst_worker_supports_frozen_gui_without_console_streams(monkeypatch, tmp_path):
    (tmp_path / "inference.py").write_text(
        "from tqdm import tqdm\n"
        "def proc_folder(arguments):\n"
        "    list(tqdm(range(1), leave=False))\n",
        encoding="utf-8",
    )
    result_queue = queue.Queue()
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    _run_msst_worker(str(tmp_path), {}, result_queue)

    assert result_queue.get_nowait() is None


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
