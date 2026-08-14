"""Research-only plain TensorRT FP16 benchmark with one dynamic-shape engine."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from benchmark_worker import (
    ARTIFACTS,
    DEPS,
    DURATIONS,
    MODELS,
    ResourceSampler,
    fcpe_post,
    load_audio,
    load_processor,
    quality_ctc,
    quality_fcpe,
    timer,
)


def load_tensorrt():
    root = DEPS / "tensorrt"
    sys.path.append(str(root))
    libs = str(root / "tensorrt_libs")
    cuda = str(root / "nvidia/cuda_runtime/bin")
    os.environ["PATH"] = f"{libs}{os.pathsep}{cuda}{os.pathsep}{os.environ['PATH']}"
    import tensorrt as trt

    return trt


def build_engine(model: str):
    trt = load_tensorrt()
    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(
        1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH)
    )
    parser = trt.OnnxParser(network, logger)
    onnx_path = ARTIFACTS / f"{model}-fp16.onnx"
    if not parser.parse_from_file(str(onnx_path)):
        raise RuntimeError(
            "; ".join(str(parser.get_error(i)) for i in range(parser.num_errors))
        )
    config = builder.create_builder_config()
    config.set_flag(trt.BuilderFlag.FP16)
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 4 << 30)
    profile = builder.create_optimization_profile()
    if model == "fcpe":
        shapes = ((1, 1001, 128), (1, 4501, 128), (1, 12001, 128))
    else:
        shapes = tuple((1, int(seconds * 16000)) for seconds in DURATIONS[model])
    profile.set_shape("input", *shapes)
    config.add_optimization_profile(profile)
    started = time.perf_counter()
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("TensorRT engine build returned null")
    build_seconds = time.perf_counter() - started
    path = ARTIFACTS.parent / "plain-tensorrt" / f"{model}-fp16.plan"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(serialized)
    return path, build_seconds


def load_engine(path: Path):
    trt = load_tensorrt()
    logger = trt.Logger(trt.Logger.WARNING)
    runtime = trt.Runtime(logger)
    engine = runtime.deserialize_cuda_engine(path.read_bytes())
    if engine is None:
        raise RuntimeError("TensorRT engine deserialize returned null")
    context = engine.create_execution_context()

    def run(value):
        tensor = (
            value if isinstance(value, torch.Tensor) else torch.from_numpy(value).cuda()
        )
        tensor = tensor.contiguous().float()
        if not context.set_input_shape("input", tuple(tensor.shape)):
            raise RuntimeError(f"TensorRT rejected input shape {tuple(tensor.shape)}")
        output_shape = tuple(context.get_tensor_shape("output"))
        output = torch.empty(output_shape, dtype=torch.float32, device="cuda")
        context.set_tensor_address("input", tensor.data_ptr())
        context.set_tensor_address("output", output.data_ptr())
        if not context.execute_async_v3(torch.cuda.current_stream().cuda_stream):
            raise RuntimeError("TensorRT execution failed")
        torch.cuda.synchronize()
        return output.cpu().numpy()

    return run


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("fcpe", "ctc_ru", "ctc_uk"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = {
        "model": args.model,
        "backend": "tensorrt",
        "precision": "fp16",
        "lengths": [],
    }
    with ResourceSampler() as resources:
        try:
            plan, build_seconds = build_engine(args.model)
            runner, cold_load = timer(lambda: load_engine(plan))
            reference_root = ARTIFACTS.parent / "reference"
            references = np.load(reference_root / f"{args.model}.npz")
            if args.model == "fcpe":
                import torchfcpe

                reference_model = torchfcpe.spawn_bundled_infer_model(device="cpu")
                cent_table = reference_model.model.cent_table.numpy()
                preprocessor = reference_model.wav2mel.cuda()
            else:
                processor = load_processor(MODELS[args.model])
            for duration in DURATIONS[args.model]:
                audio = load_audio(duration)
                timings, candidate = [], None
                for _ in range(3):
                    if args.model == "fcpe":
                        wav = torch.from_numpy(audio).view(1, -1, 1).cuda()
                        mel, preprocessing = timer(
                            lambda wav=wav: preprocessor(wav, 16000)
                        )
                        latent, inference = timer(lambda mel=mel: runner(mel))
                        candidate, postprocessing = timer(
                            lambda latent=latent: fcpe_post(latent[0], cent_table)
                        )
                    else:
                        values, preprocessing = timer(
                            lambda audio=audio: (
                                processor(
                                    audio,
                                    sampling_rate=16000,
                                    return_tensors="np",
                                    padding=False,
                                ).input_values
                            )
                        )
                        logits, inference = timer(
                            lambda values=values: runner(values)[0]
                        )
                        candidate = logits
                        _, postprocessing = timer(
                            lambda logits=logits: logits.argmax(-1)
                        )
                    timings.append(
                        {
                            "preprocessing": preprocessing,
                            "inference": inference,
                            "postprocessing": postprocessing,
                        }
                    )
                reference = (
                    (
                        references[f"f0_{duration:g}"],
                        references[f"confidence_{duration:g}"],
                    )
                    if args.model == "fcpe"
                    else references[f"logits_{duration:g}"]
                )
                quality = (
                    quality_fcpe(reference, candidate)
                    if args.model == "fcpe"
                    else quality_ctc(
                        reference,
                        candidate,
                        duration=len(audio) / 16000,
                        blank=int(processor.tokenizer.pad_token_id or 0),
                        delimiter=getattr(
                            processor.tokenizer, "word_delimiter_token_id", None
                        ),
                    )
                )
                warm = timings[1:]
                result["lengths"].append(
                    {
                        "seconds": duration,
                        "cold_stage": sum(timings[0].values()),
                        "warm": {
                            key: float(np.median([item[key] for item in warm]))
                            for key in warm[0]
                        },
                        "full_stage": float(
                            np.median([sum(item.values()) for item in warm])
                        ),
                        "quality": quality,
                        "stable": True,
                    }
                )
            result.update(
                status="success",
                build_seconds=build_seconds,
                cold_load=cold_load,
                engine_bytes=plan.stat().st_size,
            )
        except Exception as exc:  # noqa: BLE001 - failure is benchmark evidence
            result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
    result.update(
        peak_rss_bytes=resources.peak_rss,
        peak_gpu_bytes=resources.peak_gpu,
        peak_cpu_percent=resources.peak_cpu,
        artifact_bytes=(ARTIFACTS / f"{args.model}-fp16.onnx").stat().st_size,
        runtime_bytes=sum(
            path.stat().st_size
            for path in (DEPS / "tensorrt").rglob("*")
            if path.is_file()
        ),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
