

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DEPS, ROOT, write_json

import numpy as np

ARTIFACTS = ROOT / "build/ai-runtime-benchmark/artifacts"


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("model", choices=("fcpe", "ctc_ru", "ctc_uk")); parser.add_argument("backend", choices=("cuda", "directml", "cpu")); parser.add_argument("--precision", choices=("fp32", "fp16"), default="fp32")
    args = parser.parse_args()
    sys.path.append(
        str(DEPS / ("directml" if args.backend == "directml" else "ort-gpu"))
    )
    import onnxruntime as ort

    if args.backend == "cuda":
        import torch  # noqa: F401 - makes bundled CUDA/cuDNN DLLs visible to ORT

        ort.preload_dlls()

    providers = {
        "cuda": ["CUDAExecutionProvider", "CPUExecutionProvider"],
        "directml": ["DmlExecutionProvider", "CPUExecutionProvider"],
        "cpu": ["CPUExecutionProvider"],
    }[args.backend]
    options = ort.SessionOptions(); options.enable_profiling = True
    name = (
        f"{args.model}-fp16.onnx"
        if args.precision == "fp16"
        else "fcpe-core.onnx"
        if args.model == "fcpe"
        else f"{args.model}.onnx"
    )
    session = ort.InferenceSession(str(ARTIFACTS / name), options, providers=providers); shape = (1, 1001, 128) if args.model == "fcpe" else (1, 32000); session.run(["output"], {"input": np.zeros(shape, dtype=np.float32)}); profile_path = Path(session.end_profiling())
    events = json.loads(profile_path.read_text(encoding="utf-8"))
    counts = Counter(
        event.get("args", {}).get("provider", "unassigned")
        for event in events
        if event.get("cat") == "Node"
    )
    fallback_nodes = Counter(
        event.get("args", {}).get("op_name", event.get("name", "unknown"))
        for event in events
        if event.get("cat") == "Node"
        and event.get("args", {}).get("provider") == "CPUExecutionProvider"
    )
    result = {
        "model": args.model,
        "backend": args.backend,
        "precision": args.precision,
        "session_providers": session.get_providers(),
        "node_events_by_provider": dict(counts),
        "cpu_fallback_ops": dict(fallback_nodes),
    }
    output = (
        ROOT
        / "build/ai-runtime-benchmark/provider-coverage"
        / f"{args.model}-{args.backend}-{args.precision}.json"
    )
    write_json(output, result); profile_path.unlink(missing_ok=True); print(json.dumps(result, indent=2))


if __name__ == "__main__": main()
