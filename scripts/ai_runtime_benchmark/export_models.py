"""Export research-only FCPE/CTC ONNX artifacts without touching production runtime."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.append(str(DEFAULT_DEPS / "ort-gpu"))
MODEL_PATHS = {
    "ctc_ru": ROOT / "downloads/models/ctc/wav2vec2-large-xlsr-53-russian",
    "ctc_uk": ROOT / "downloads/models/ctc/wav2vec2-xls-r-300m-uk",
}


def _load_onnx():
    sys.path.append(str(DEFAULT_DEPS / "ort-gpu"))
    import onnx

    return onnx


class _FCPECore(torch.nn.Module):
    def __init__(self, core):
        super().__init__()
        self.core = core

    def forward(self, mel):
        return self.core(mel)


class _CTCCore(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_values):
        return self.model(input_values=input_values).logits


def _export(
    name: str, model: torch.nn.Module, example: torch.Tensor, output: Path
) -> dict:
    started = time.perf_counter()
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (example,),
        str(output),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch", 1: "time"},
            "output": {0: "batch", 1: "frames"},
        },
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx = _load_onnx()
    graph = onnx.load(str(output), load_external_data=False)
    onnx.checker.check_model(graph)
    inferred = onnx.shape_inference.infer_shapes(graph)
    operators = sorted(
        {f"{node.domain or 'ai.onnx'}::{node.op_type}" for node in graph.graph.node}
    )
    return {
        "model": name,
        "status": "success",
        "path": str(output),
        "bytes": output.stat().st_size,
        "seconds": time.perf_counter() - started,
        "opset": next(
            (item.version for item in graph.opset_import if not item.domain), None
        ),
        "operators": operators,
        "nodes": len(graph.graph.node),
        "input_shape": [
            str(value.dim_param or value.dim_value)
            for value in inferred.graph.input[0].type.tensor_type.shape.dim
        ],
        "output_shape": [
            str(value.dim_param or value.dim_value)
            for value in inferred.graph.output[0].type.tensor_type.shape.dim
        ],
    }


def export_fcpe(output: Path) -> dict:
    import torchfcpe

    bundled = torchfcpe.spawn_bundled_infer_model(device="cpu")
    bundled.eval()
    core = _FCPECore(bundled.model).eval()
    result = _export("fcpe", core, torch.zeros(1, 101, 128), output / "fcpe-core.onnx")
    result["preprocessing"] = bundled.get_mel_config()
    result["core_parameters"] = sum(
        parameter.numel() for parameter in core.parameters()
    )
    return result


def export_ctc(name: str, output: Path) -> dict:
    from transformers import AutoModelForCTC

    model = AutoModelForCTC.from_pretrained(
        MODEL_PATHS[name], local_files_only=True
    ).eval()
    model.config.apply_spec_augment = False
    result = _export(
        name, _CTCCore(model).eval(), torch.zeros(1, 16000), output / f"{name}.onnx"
    )
    result["core_parameters"] = sum(
        parameter.numel() for parameter in model.parameters()
    )
    result["vocab_size"] = model.config.vocab_size
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=ROOT / "build/ai-runtime-benchmark/artifacts"
    )
    parser.add_argument(
        "--models",
        nargs="+",
        choices=("fcpe", "ctc_ru", "ctc_uk"),
        default=("fcpe", "ctc_ru", "ctc_uk"),
    )
    args = parser.parse_args()
    manifest = []
    for name in args.models:
        try:
            manifest.append(
                export_fcpe(args.output)
                if name == "fcpe"
                else export_ctc(name, args.output)
            )
        except Exception as exc:  # noqa: BLE001 - export failures are research data
            manifest.append(
                {
                    "model": name,
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
        finally:
            import gc

            gc.collect()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "export-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0 if all(item["status"] == "success" for item in manifest) else 1


if __name__ == "__main__":
    raise SystemExit(main())
