from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "sync_version.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("sync_version_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def test_version_sync_updates_all_mirrors_and_detects_drift(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "VERSION_FILE", tmp_path / "VERSION")

    _write_json(tmp_path / "front/package.json", {"name": "front", "version": "0.0.1"})
    _write_json(
        tmp_path / "front/package-lock.json",
        {"name": "front", "version": "0.0.1", "packages": {"": {"version": "0.0.1"}}},
    )
    pyproject = tmp_path / "backend/pyproject.toml"
    pyproject.parent.mkdir(parents=True)
    pyproject.write_text('[project]\nversion = "0.0.1"\n', encoding="utf-8")
    version_module = tmp_path / "backend/app/version.py"
    version_module.parent.mkdir(parents=True)
    version_module.write_text('APP_VERSION = "0.0.1"\n', encoding="utf-8")
    _write_json(
        tmp_path / "cloudflare/package.json", {"name": "online", "version": "0.0.1"}
    )
    _write_json(
        tmp_path / "cloudflare/package-lock.json",
        {"name": "online", "version": "0.0.1", "packages": {"": {"version": "0.0.1"}}},
    )

    module.write_transaction(module.rendered_files("1.2.3"))
    assert module.check("1.2.3") == []

    cloudflare = tmp_path / "cloudflare/package.json"
    cloudflare.write_text(cloudflare.read_text(encoding="utf-8").replace("1.2.3", "9.9.9"), encoding="utf-8")
    assert module.check("1.2.3") == ["cloudflare/package.json"]
