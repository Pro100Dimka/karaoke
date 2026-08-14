"""Counterfactual CTC pipeline comparison using cached identical upstream artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.insert(0, str(DEPS / "ort-gpu"))
sys.path.insert(0, str(ROOT / "backend"))

INVALIDATED = (
    "lyricsSync.json",
    "syllables.json",
    "acousticNotes.json",
    "reference.json",
    "vocal.mid",
    "game.mid",
    "songMap.json",
    "quality.json",
    "diagnostics.json",
    "alignmentDebug.json",
    "manifest.json",
    "performance.json",
)
QUALITY_OUTPUTS = INVALIDATED[:10]


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _reset_from(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    cache_index = target / ".ai-cache" / "index.json"
    cache = json.loads(cache_index.read_text(encoding="utf-8"))
    for stage in cache["stages"].values():
        stage["outputs"] = {
            str(target / Path(path).relative_to(source)): metadata
            for path, metadata in stage["outputs"].items()
        }
    cache_index.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    for name in INVALIDATED:
        (target / name).unlink(missing_ok=True)


def _ort_override(ctc, model: str):
    import torch
    from AI.engines.ctc_backends import OrtCudaCTCBackend

    backend = OrtCudaCTCBackend(model)
    original_infer = ctc._infer
    original_release = ctc.release

    def infer(audio, sample_rate, language, text):
        processor, _ = ctc._load(language, text)
        values = (
            processor(
                audio,
                sampling_rate=sample_rate,
                return_tensors="pt",
                padding=False,
            )
            .input_values.detach()
            .cpu()
            .numpy()
        )
        shadow = backend.infer(values)
        return torch.log_softmax(
            torch.from_numpy(shadow.logits).float(), dim=-1
        ), processor

    def release():
        original_release()
        backend.release()

    ctc._infer = infer
    ctc.release = release
    return original_infer, original_release, backend


def _run(output: Path, candidate: bool) -> dict[str, object]:
    from AI.config import CoreConfig
    from AI.pipeline import KaraokePipeline, PipelineRequest

    pipeline = KaraokePipeline(CoreConfig.from_env())
    override = None
    if candidate:
        override = _ort_override(pipeline.engines.aligner._ctc, "ctc_ru")
    source = ROOT / "build/performance-baseline-input/source.mp3"
    lyrics = ROOT / "build/performance-baseline-after-v2/warm/lyrics.txt"
    started = time.perf_counter()
    result = pipeline.run(
        PipelineRequest(source, output, language="Russian", lyrics_path=lyrics)
    )
    elapsed = time.perf_counter() - started
    pipeline.close()
    if override is not None:
        override[2].release()
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    performance = json.loads((output / "performance.json").read_text(encoding="utf-8"))
    alignment = next(
        item for item in manifest["reports"] if item["stage"] == "alignment"
    )
    return {
        "wall_sec": elapsed,
        "alignment_sec": alignment["elapsed_sec"],
        "performance": performance,
        "hashes": {name: _hash(output / name) for name in QUALITY_OUTPUTS},
    }


def _word_delta(left: Path, right: Path) -> dict[str, object]:
    production = json.loads(left.read_text(encoding="utf-8"))["words"]
    candidate = json.loads(right.read_text(encoding="utf-8"))["words"]
    same_text = [word["text"] for word in production] == [
        word["text"] for word in candidate
    ]
    deltas = []
    if same_text:
        for a, b in zip(production, candidate, strict=True):
            deltas.extend(
                (
                    abs(float(a["start"]) - float(b["start"])) * 1000,
                    abs(float(a["end"]) - float(b["end"])) * 1000,
                )
            )
    deltas.sort()
    p95 = deltas[min(len(deltas) - 1, int(len(deltas) * 0.95))] if deltas else 0.0
    return {
        "canonical_text_equal": same_text,
        "production_words": len(production),
        "candidate_words": len(candidate),
        "timing_mae_ms": sum(deltas) / len(deltas) if deltas else 0.0,
        "timing_p95_ms": p95,
        "timing_max_ms": max(deltas, default=0.0),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "build/ctc-shadow-corpus/pipeline-comparison.json",
    )
    args = parser.parse_args()
    args.output = args.output.resolve()
    os.environ["KARAOKE_AI_CTC_RU_ONNX"] = str(
        ROOT / "build/ai-runtime-benchmark/artifacts/ctc_ru-fp16.onnx"
    )
    os.environ["KARAOKE_AI_CTC_SHADOW"] = "0"
    source = ROOT / "build/performance-baseline-after-v2/warm"
    root = args.output.parent / "pipeline"
    production_dir, candidate_dir = root / "pytorch", root / "ort"
    _reset_from(source, production_dir)
    _reset_from(source, candidate_dir)
    production = _run(production_dir, False)
    candidate = _run(candidate_dir, True)
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "production": production,
        "candidate": candidate,
        "equal_outputs": {
            name: production["hashes"][name] == candidate["hashes"][name]
            for name in QUALITY_OUTPUTS
        },
        "lyrics_sync": _word_delta(
            production_dir / "lyricsSync.json", candidate_dir / "lyricsSync.json"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
