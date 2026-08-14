"""Counterfactual full pitch/downstream comparison on identical cached upstream data."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.insert(0, str(DEPS / "ort-gpu"))
sys.path.insert(0, str(ROOT / "backend"))

INVALIDATED = (
    "pitchRaw.json",
    "pitch.json",
    "syllables.json",
    "reference.json",
    "melodyContour.json",
    "acousticNotes.json",
    "vocal.mid",
    "game.mid",
    "songMap.json",
    "quality.json",
    "diagnostics.json",
    "alignmentDebug.json",
    "manifest.json",
    "performance.json",
)
QUALITY_OUTPUTS = INVALIDATED[1:10]


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _reset(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    index_path = target / ".ai-cache/index.json"
    cache = json.loads(index_path.read_text(encoding="utf-8"))
    for stage in cache["stages"].values():
        stage["outputs"] = {
            str(target / Path(path).relative_to(source)): metadata
            for path, metadata in stage["outputs"].items()
        }
    index_path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    for name in INVALIDATED:
        (target / name).unlink(missing_ok=True)


def _install_ort_estimator(estimator):
    import torch

    from AI.audio import load_mono
    from AI.engines.fcpe_backends import OrtCudaFCPEBackend
    from AI.models import PitchFrame

    backend = OrtCudaFCPEBackend()

    def estimate(audio_path):
        _, model = estimator._load_model()
        y, _ = load_mono(audio_path, estimator.sr)
        if y.size == 0:
            return []
        y = np.asarray(y, dtype=np.float32)
        peak = float(np.max(np.abs(y)))
        if peak > 0.999:
            y = np.ascontiguousarray(y * (0.999 / peak), dtype=np.float32)
        tensor = torch.from_numpy(y).view(1, -1, 1).to(estimator._device)
        target_length = len(y) // estimator.hop + 1
        with torch.inference_mode():
            mel = model.wav2mel(tensor, estimator.sr)
        cent_table = model.model.cent_table.float().cpu().numpy()
        result = backend.infer(
            mel.detach().cpu().numpy(), cent_table, target_length=target_length
        )
        energy_window = max(32, int(estimator.sr * 0.025))
        output = []
        for index, value in enumerate(result.f0):
            hz = min(float(value), estimator.fmax)
            start = min(len(y), int(round(index * estimator.hop)))
            end = min(len(y), start + energy_window)
            energy = (
                float(np.sqrt(np.mean(np.square(y[start:end])) + 1e-12))
                if end > start
                else 0.0
            )
            voiced = bool(np.isfinite(hz) and estimator.fmin <= hz <= estimator.fmax)
            output.append(
                PitchFrame(
                    index * estimator.hop / estimator.sr,
                    hz if voiced else 0.0,
                    1.0 if voiced else 0.0,
                    voiced,
                    energy,
                )
            )
        return output

    estimator.estimate = estimate
    return backend


def _freeze_text_stage(pipeline) -> None:
    original = pipeline._cache_hit

    def cache_hit(cache, stage, key, outputs, validators=None):
        if stage in {"alignment", "transcription"} and all(
            path.is_file() for path in outputs
        ):
            return True
        return original(cache, stage, key, outputs, validators)

    pipeline._cache_hit = cache_hit


def _run(pipeline, target: Path) -> dict[str, object]:
    from AI.pipeline import PipelineRequest

    source = ROOT / "build/performance-baseline-input/source.mp3"
    started = time.perf_counter()
    result = pipeline.run(PipelineRequest(source, target, language="Russian"))
    wall = time.perf_counter() - started
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    performance = json.loads((target / "performance.json").read_text(encoding="utf-8"))
    stages = {report["stage"]: report["elapsed_sec"] for report in manifest["reports"]}
    return {
        "wall_sec": wall,
        "pitch_stage_sec": sum(
            value for name, value in stages.items() if name.startswith("pitch")
        ),
        "derivation_sec": stages.get("derivation", 0.0),
        "midi_sec": stages.get("midi", 0.0),
        "performance": performance,
        "hashes": {name: _hash(target / name) for name in QUALITY_OUTPUTS},
    }


def _note_comparison(left: Path, right: Path, key: str) -> dict[str, object]:
    left_data = json.loads(left.read_text(encoding="utf-8"))
    right_data = json.loads(right.read_text(encoding="utf-8"))
    production = left_data[key] if isinstance(left_data, dict) else left_data
    candidate = right_data[key] if isinstance(right_data, dict) else right_data
    pitch, cents, onset, offset = [], [], [], []
    for a, b in zip(production, candidate):
        if "midi" in a and "midi" in b:
            pitch.append(abs(float(a["midi"]) - float(b["midi"])))
        if float(a.get("frequency", 0)) > 0 and float(b.get("frequency", 0)) > 0:
            cents.append(
                abs(1200 * np.log2(float(a["frequency"]) / float(b["frequency"])))
            )
        onset.append(
            abs(
                float(a.get("start", a.get("time", 0)))
                - float(b.get("start", b.get("time", 0)))
            )
        )
        offset.append(
            abs(
                float(a.get("end", a.get("time", 0)))
                - float(b.get("end", b.get("time", 0)))
            )
        )
    return {
        "production_count": len(production),
        "candidate_count": len(candidate),
        "count_delta": len(candidate) - len(production),
        "pitch_max_semitones": max(pitch, default=0.0),
        "frequency_max_cents": max(cents, default=0.0),
        "onset_max_ms": max(onset, default=0.0) * 1000,
        "offset_max_ms": max(offset, default=0.0) * 1000,
    }


def main() -> int:
    from AI.config import CoreConfig
    from AI.pipeline import KaraokePipeline

    os.environ["KARAOKE_AI_FCPE_ONNX"] = str(
        ROOT / "build/ai-runtime-benchmark/artifacts/fcpe-fp16.onnx"
    )
    source = (ROOT / "build/performance-baseline-after-v2/warm").resolve()
    output = (ROOT / "build/fcpe-shadow-corpus/pipeline").resolve()
    production_pipeline = KaraokePipeline(CoreConfig.from_env())
    candidate_pipeline = KaraokePipeline(CoreConfig.from_env())
    _freeze_text_stage(production_pipeline)
    _freeze_text_stage(candidate_pipeline)
    backend = _install_ort_estimator(candidate_pipeline.engines.pitch)
    results = {"production": [], "candidate": []}
    for run in ("cold", "warm"):
        production_dir = output / f"production-{run}"
        candidate_dir = output / f"candidate-{run}"
        _reset(source, production_dir)
        _reset(source, candidate_dir)
        results["production"].append(_run(production_pipeline, production_dir))
        results["candidate"].append(_run(candidate_pipeline, candidate_dir))
    backend.release()
    production_pipeline.close()
    candidate_pipeline.close()
    left, right = output / "production-warm", output / "candidate-warm"
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **results,
        "equal_outputs": {
            name: results["production"][1]["hashes"][name]
            == results["candidate"][1]["hashes"][name]
            for name in QUALITY_OUTPUTS
        },
        "pitch": _note_comparison(left / "pitch.json", right / "pitch.json", "frames"),
        "acoustic_notes": _note_comparison(
            left / "acousticNotes.json", right / "acousticNotes.json", "notes"
        ),
        "reference": _note_comparison(
            left / "reference.json", right / "reference.json", "notes"
        ),
        "quality_equal": json.loads((left / "quality.json").read_text(encoding="utf-8"))
        == json.loads((right / "quality.json").read_text(encoding="utf-8")),
    }
    result_path = BUILD / "pipeline-results.json"
    result_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(result_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
