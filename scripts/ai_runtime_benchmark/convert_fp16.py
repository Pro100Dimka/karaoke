

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DEPS, ROOT

sys.path.append(str(DEPS / "ort-gpu"))

import onnx
from onnxconverter_common import float16


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("model", choices=("fcpe", "ctc_ru", "ctc_uk")); args = parser.parse_args(); artifacts = ROOT / "build/ai-runtime-benchmark/artifacts"
    source = artifacts / (
        "fcpe-core.onnx" if args.model == "fcpe" else f"{args.model}.onnx"
    )
    target = artifacts / f"{args.model}-fp16.onnx"; started = time.perf_counter(); model = onnx.load(str(source))
    converted = float16.convert_float_to_float16(
        model,
        keep_io_types=True,
        disable_shape_infer=False,
    )
    onnx.save(converted, str(target)); onnx.checker.check_model(str(target))
    result = {
        "model": args.model,
        "precision": "fp16",
        "status": "success",
        "source_bytes": source.stat().st_size,
        "artifact_bytes": target.stat().st_size,
        "seconds": time.perf_counter() - started,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__": main()
