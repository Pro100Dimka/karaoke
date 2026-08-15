from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ai_runtime_benchmark" / "directml_fcpe_downstream_gate.py"


def _module():
    spec = importlib.util.spec_from_file_location("directml_fcpe_downstream_gate", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_note_metrics_detects_structural_difference():
    module = _module()
    left = [{"start": 1.0, "end": 1.5, "midi_note": 60}]
    right = [{"start": 1.0, "end": 1.5, "midi_note": 61}, {"start": 2.0, "end": 2.2, "midi_note": 62}]
    metrics = module._note_metrics(left, right)
    assert metrics["count_delta"] == 1
    assert metrics["max_pitch"] == 1.0
    assert metrics["exact_json"] is False


def test_find_audio_accepts_wav_and_flac(tmp_path: Path):
    module = _module()
    separated = tmp_path / "separated"
    separated.mkdir()
    target = separated / "vocals.midi-analysis-tail.flac"
    target.write_bytes(b"flac")
    assert module._find_audio(tmp_path, "vocals.midi-analysis-tail") == target


def test_baseline_source_reads_diagnostics(tmp_path: Path):
    module = _module()
    (tmp_path / "diagnostics.json").write_text(
        json.dumps({"data_flow": {"pitch_analysis_source": "tail-suppressed"}}),
        encoding="utf-8",
    )
    assert module._baseline_source(tmp_path) == "tail-suppressed"


def test_downstream_batch_does_not_change_production_backend():
    text = (ROOT / "scripts" / "test-fcpe-directml-downstream.bat").read_text(encoding="utf-8")
    assert "directml_fcpe_downstream_gate.py" in text
    assert "KARAOKE_AI_FCPE_SHADOW=1" not in text
    assert "call start-dev" not in text.casefold()
