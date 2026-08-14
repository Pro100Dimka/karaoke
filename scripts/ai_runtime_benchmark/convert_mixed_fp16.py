"""Build research-only mixed-precision CTC graphs with sensitive ops kept FP32."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.append(str(DEPS / "ort-gpu"))

import onnx
from onnxconverter_common import float16

PROFILES = {
    "norms-fp32": ["LayerNormalization", "ReduceL2"],
    "norms-softmax-fp32": ["LayerNormalization", "ReduceL2", "Softmax"],
    "conv-norms-fp32": ["Conv", "LayerNormalization", "ReduceL2"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("ctc_ru", "ctc_uk"))
    parser.add_argument("profile", choices=tuple(PROFILES))
    args = parser.parse_args()
    artifacts = ROOT / "build/ai-runtime-benchmark/artifacts"
    source = artifacts / f"{args.model}.onnx"
    target = artifacts / f"{args.model}-{args.profile}.onnx"
    started = time.perf_counter()
    model = onnx.load(str(source))
    converted = float16.convert_float_to_float16(
        model,
        keep_io_types=True,
        disable_shape_infer=False,
        op_block_list=PROFILES[args.profile],
    )
    onnx.save(converted, str(target))
    onnx.checker.check_model(str(target))
    print(
        json.dumps(
            {
                "model": args.model,
                "profile": args.profile,
                "fp32_ops": PROFILES[args.profile],
                "artifact_bytes": target.stat().st_size,
                "seconds": time.perf_counter() - started,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
