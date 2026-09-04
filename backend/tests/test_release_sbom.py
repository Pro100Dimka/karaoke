from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/generate_release_sbom.py"


def test_release_sbom_emits_cyclonedx_components_for_every_runtime_layer():
    spec = importlib.util.spec_from_file_location("release_sbom_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    component = module._component(
        "backend", {"name": "Example", "version": "1.2.3", "license": "MIT"}
    )
    assert component["bom-ref"] == "pkg:pypi/Example@1.2.3"
    assert component["licenses"] == [{"license": {"name": "MIT"}}]

    version = (module.ROOT / "VERSION").read_text(encoding="utf-8").strip()
    native = module._native_components(version)
    names = {item["name"] for item in native}
    assert {
        "Electron",
        "FFmpeg",
        "KaraokeWasapi",
        "KaraokeAsioBridge",
        "KeyboardLighting",
        "Music-Source-Separation-Training",
    } <= names
    assert all(item.get("licenses") for item in native)


def test_generated_release_sbom_is_valid_cyclonedx_without_unknown_licenses(
    monkeypatch, tmp_path
):
    spec = importlib.util.spec_from_file_location("release_sbom_generate_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sbom_dir = tmp_path / "generated/sbom"
    sbom_dir.mkdir(parents=True)
    (tmp_path / "VERSION").write_text("1.2.3\n", encoding="utf-8")
    for ecosystem in ("backend", "frontend", "cloudflare"):
        (sbom_dir / f"{ecosystem}.json").write_text(
            json.dumps(
                {
                    "packages": [
                        {"name": f"{ecosystem}-package", "version": "1", "license": "MIT"}
                    ]
                }
            ),
            encoding="utf-8",
        )
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "SBOM_DIR", sbom_dir)
    monkeypatch.setattr(module, "OUTPUT", sbom_dir / "release.cdx.json")
    monkeypatch.setattr(module, "_native_components", lambda _version: [])
    assert module.main() == 0
    document = json.loads(module.OUTPUT.read_text(encoding="utf-8"))
    assert document["bomFormat"] == "CycloneDX"
    assert document["specVersion"] == "1.6"
    assert document["metadata"]["component"]["name"] == "A&D Voice"
    assert len(document["components"]) == 3
    assert all(
        license_entry["license"]["name"] != "UNKNOWN"
        for component in document["components"]
        for license_entry in component["licenses"]
    )
