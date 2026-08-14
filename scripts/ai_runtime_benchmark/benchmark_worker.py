"""One-process research benchmark for a single model/runtime combination."""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

import numpy as np
import psutil
import torch

ROOT = Path(__file__).resolve().parents[2]
DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.append(str(DEPS / "monitor"))
ARTIFACTS = ROOT / "build/ai-runtime-benchmark/artifacts"
AUDIO = (
    ROOT / "build/performance-baseline-after-v2/warm/separated/vocals.midi-analysis.wav"
)
MODELS = {
    "ctc_ru": ROOT / "downloads/models/ctc/wav2vec2-large-xlsr-53-russian",
    "ctc_uk": ROOT / "downloads/models/ctc/wav2vec2-xls-r-300m-uk",
}
DURATIONS = {
    "fcpe": (10.0, 45.0, 120.0),
    "ctc_ru": (2.0, 8.0, 20.0),
    "ctc_uk": (2.0, 8.0, 20.0),
}


class ResourceSampler:
    def __init__(self):
        self.process = psutil.Process()
        self.peak_rss = self.process.memory_info().rss
        self.peak_gpu = 0
        self.peak_cpu = 0.0
        self.gpu_handle = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _gpu(self) -> int:
        try:
            import pynvml

            if self.gpu_handle is None:
                pynvml.nvmlInit()
                self.gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            return int(pynvml.nvmlDeviceGetMemoryInfo(self.gpu_handle).used)
        except Exception:  # noqa: BLE001 - optional vendor sampler must never stop a run
            return 0

    def _run(self):
        while not self.stop.wait(0.05):
            try:
                self.peak_rss = max(self.peak_rss, self.process.memory_info().rss)
                self.peak_cpu = max(self.peak_cpu, self.process.cpu_percent(None))
                self.peak_gpu = max(self.peak_gpu, self._gpu())
            except (psutil.Error, OSError):
                pass

    def __enter__(self):
        self.process.cpu_percent(None)
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.stop.set()
        self.thread.join()


def timer(function):
    started = time.perf_counter()
    value = function()
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    return value, time.perf_counter() - started


def load_audio(seconds: float) -> np.ndarray:
    from AI.audio import load_mono

    audio, _ = load_mono(AUDIO, 16000)
    audio = np.ascontiguousarray(audio[: int(seconds * 16000)], dtype=np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    return audio * (0.999 / peak) if peak > 0.999 else audio


def load_processor(model_path: Path):
    from transformers import (
        AutoFeatureExtractor,
        AutoProcessor,
        AutoTokenizer,
        Wav2Vec2Processor,
    )

    try:
        return AutoProcessor.from_pretrained(model_path, local_files_only=True)
    except ImportError as exc:
        if (
            "pyctcdecode" not in str(exc).lower()
            and "processorwithlm" not in str(exc).lower()
        ):
            raise
        return Wav2Vec2Processor(
            feature_extractor=AutoFeatureExtractor.from_pretrained(
                model_path, local_files_only=True
            ),
            tokenizer=AutoTokenizer.from_pretrained(model_path, local_files_only=True),
        )


def fcpe_post(latent: np.ndarray, cent_table: np.ndarray, threshold: float = 0.006):
    confidence = latent.max(axis=-1)
    center = latent.argmax(axis=-1)
    offsets = np.arange(-4, 5)
    indices = np.clip(center[..., None] + offsets, 0, latent.shape[-1] - 1)
    local = np.take_along_axis(latent, indices, axis=-1)
    cents = np.take(cent_table, indices)
    decoded = (local * cents).sum(axis=-1) / np.maximum(local.sum(axis=-1), 1e-30)
    f0 = 10.0 * np.power(2.0, decoded / 1200.0)
    f0[confidence <= threshold] = 0.0
    return f0.astype(np.float32), confidence.astype(np.float32)


def quality_fcpe(reference, candidate):
    ref_f0, ref_conf = reference
    f0, conf = candidate
    count = min(ref_f0.size, f0.size)
    ref_f0, f0 = ref_f0[:count], f0[:count]
    ref_conf, conf = ref_conf[:count], conf[:count]
    ref_voiced, voiced = ref_f0 > 0, f0 > 0
    both = ref_voiced & voiced
    cents = np.abs(
        1200.0 * np.log2(np.maximum(f0[both], 1e-12) / np.maximum(ref_f0[both], 1e-12))
    )
    return {
        "frames": count,
        "voiced_agreement": float(np.mean(ref_voiced == voiced)),
        "confidence_mae": float(np.mean(np.abs(ref_conf - conf))),
        "cents_mae": float(np.mean(cents)) if cents.size else 0.0,
        "cents_p95": float(np.percentile(cents, 95)) if cents.size else 0.0,
    }


def _viterbi_spans(logits: np.ndarray, target: list[int], blank: int):
    from AI.engines.ctc_alignment import _ctc_viterbi_states

    log_probs = torch.log_softmax(torch.from_numpy(logits).float(), dim=-1)
    path, _ = _ctc_viterbi_states(log_probs, target, blank)
    spans = []
    for position in range(len(target)):
        frames = [
            index for index, state in enumerate(path) if state == 2 * position + 1
        ]
        spans.append((min(frames), max(frames) + 1) if frames else None)
    return spans


def quality_ctc(
    reference: np.ndarray,
    candidate: np.ndarray,
    *,
    duration: float | None = None,
    blank: int = 0,
    delimiter: int | None = None,
):
    frames = min(reference.shape[0], candidate.shape[0])
    labels = min(reference.shape[1], candidate.shape[1])
    reference, candidate = reference[:frames, :labels], candidate[:frames, :labels]
    delta = np.abs(reference - candidate)
    result = {
        "frames": frames,
        "max_abs_logit": float(delta.max()),
        "mean_abs_logit": float(delta.mean()),
        "argmax_agreement": float(
            np.mean(reference.argmax(-1) == candidate.argmax(-1))
        ),
    }
    if duration and frames:
        reference_ids = reference.argmax(-1).tolist()
        target, previous = [], blank
        for token in reference_ids:
            if token != blank and token != previous:
                target.append(int(token))
            previous = token
        try:
            reference_spans = _viterbi_spans(reference, target, blank)
            candidate_spans = _viterbi_spans(candidate, target, blank)
            token_errors, word_errors = [], []
            current_word = []
            for index, (left, right) in enumerate(
                zip(reference_spans, candidate_spans, strict=True)
            ):
                if left is not None and right is not None:
                    token_errors.extend(
                        abs(left[edge] - right[edge]) * duration / frames
                        for edge in (0, 1)
                    )
                    current_word.extend((left, right))
                if (
                    delimiter is not None
                    and target[index] == delimiter
                    and current_word
                ):
                    word_errors.append(
                        abs(current_word[0][0] - current_word[1][0])
                        * duration
                        / frames,
                    )
                    word_errors.append(
                        abs(current_word[-2][1] - current_word[-1][1])
                        * duration
                        / frames,
                    )
                    current_word = []
            if current_word:
                word_errors.extend(
                    (
                        abs(current_word[0][0] - current_word[1][0])
                        * duration
                        / frames,
                        abs(current_word[-2][1] - current_word[-1][1])
                        * duration
                        / frames,
                    )
                )
            result.update(
                viterbi_target_tokens=len(target),
                token_timestamp_mae_ms=float(np.mean(token_errors) * 1000)
                if token_errors
                else 0.0,
                token_timestamp_p95_ms=float(np.percentile(token_errors, 95) * 1000)
                if token_errors
                else 0.0,
                word_timestamp_mae_ms=float(np.mean(word_errors) * 1000)
                if word_errors
                else 0.0,
                word_timestamp_p95_ms=float(np.percentile(word_errors, 95) * 1000)
                if word_errors
                else 0.0,
            )
        except (RuntimeError, ValueError, IndexError) as exc:
            result["viterbi_error"] = f"{type(exc).__name__}: {exc}"
    return result


def fcpe_reference(audio):
    import torchfcpe

    model = torchfcpe.spawn_bundled_infer_model(device="cuda")
    wav = torch.from_numpy(audio).view(1, -1, 1).cuda()
    mel, preprocessing = timer(lambda: model.wav2mel(wav, 16000))
    with torch.inference_mode():
        latent, inference = timer(lambda: model.model(mel))
    output, post = timer(
        lambda: fcpe_post(
            latent.float().cpu().numpy()[0],
            model.model.cent_table.float().cpu().numpy(),
        )
    )
    return output, {
        "preprocessing": preprocessing,
        "inference": inference,
        "postprocessing": post,
    }


def ctc_reference(name, audio):
    from transformers import AutoModelForCTC, AutoProcessor

    processor, preprocessing = timer(
        lambda: AutoProcessor.from_pretrained(MODELS[name], local_files_only=True)
    )
    model, load = timer(
        lambda: (
            AutoModelForCTC.from_pretrained(MODELS[name], local_files_only=True)
            .eval()
            .cuda()
        )
    )
    model.config.apply_spec_augment = False
    inputs, prep_input = timer(
        lambda: (
            processor(
                audio, sampling_rate=16000, return_tensors="pt", padding=False
            ).input_values
        )
    )
    values = inputs.cuda()
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        logits, inference = timer(
            lambda: model(input_values=values).logits[0].float().cpu().numpy()
        )
    return logits, {
        "model_load": load + preprocessing,
        "preprocessing": prep_input,
        "inference": inference,
        "postprocessing": 0.0,
    }


def artifact_path(model: str, precision: str) -> Path:
    if precision == "fp16":
        return ARTIFACTS / f"{model}-fp16.onnx"
    return ARTIFACTS / ("fcpe-core.onnx" if model == "fcpe" else f"{model}.onnx")


def create_runtime(backend: str, model: str, precision: str):
    path = artifact_path(model, precision)
    if backend.startswith("ort-"):
        if backend == "ort-tensorrt":
            trt_root = DEPS / "tensorrt"
            sys.path.append(str(trt_root))
            trt_libs = str(trt_root / "tensorrt_libs")
            cuda_runtime = str(trt_root / "nvidia/cuda_runtime/bin")
            os.environ["PATH"] = (
                f"{trt_libs}{os.pathsep}{cuda_runtime}{os.pathsep}{os.environ['PATH']}"
            )
        sys.path.append(
            str(DEPS / ("directml" if backend == "ort-directml" else "ort-gpu"))
        )
        import onnxruntime as ort

        if backend == "ort-cpu":
            providers = ["CPUExecutionProvider"]
        elif backend == "ort-cuda":
            ort.preload_dlls()
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        elif backend == "ort-tensorrt":
            ort.preload_dlls()
            (ARTIFACTS.parent / "engine-cache" / model).mkdir(
                parents=True, exist_ok=True
            )
            providers = [
                (
                    "TensorrtExecutionProvider",
                    {
                        "trt_engine_cache_enable": True,
                        "trt_engine_cache_path": str(
                            ARTIFACTS.parent / "engine-cache" / model
                        ),
                        "trt_fp16_enable": precision == "fp16",
                    },
                ),
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        else:
            providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
        session = ort.InferenceSession(str(path), providers=providers)
        actual = session.get_providers()
        if backend in {"ort-cuda", "ort-tensorrt"}:

            def run_cuda(value):
                if not isinstance(value, torch.Tensor) or not value.is_cuda:
                    return session.run(["output"], {"input": value})[0]
                binding = session.io_binding()
                binding.bind_input(
                    "input",
                    "cuda",
                    0,
                    np.float32,
                    tuple(value.shape),
                    value.data_ptr(),
                )
                binding.bind_output("output", "cpu")
                session.run_with_iobinding(binding)
                return binding.copy_outputs_to_cpu()[0]

            return run_cuda, actual
        return lambda value: session.run(["output"], {"input": value})[0], actual
    if backend.startswith("openvino-"):
        sys.path.append(str(DEPS / "openvino"))
        import openvino as ov

        device = backend.removeprefix("openvino-").upper()
        core = ov.Core()
        compiled = core.compile_model(str(path), device)
        request = compiled.create_infer_request()
        return lambda value: request.infer({"input": value})["output"], [
            f"OpenVINO:{device}"
        ]
    raise ValueError(f"Unknown backend {backend}")


def run_fcpe(runner, preprocessor, preprocessor_device, audio, reference, cent_table):
    wav = torch.from_numpy(audio).view(1, -1, 1).to(preprocessor_device)
    mel, preprocessing = timer(lambda: preprocessor(wav, 16000))
    if preprocessor_device == "cpu":
        mel = mel.numpy()
    latent, inference = timer(lambda: runner(mel))
    output, post = timer(lambda: fcpe_post(latent[0], cent_table))
    return (
        output,
        {
            "preprocessing": preprocessing,
            "inference": inference,
            "postprocessing": post,
        },
        quality_fcpe(reference, output),
    )


def run_ctc(name, runner, processor, audio, reference):
    values, preprocessing = timer(
        lambda: (
            processor(
                audio, sampling_rate=16000, return_tensors="np", padding=False
            ).input_values
        )
    )
    logits, inference = timer(lambda: runner(values)[0])
    _, post = timer(lambda: logits.argmax(-1))
    return (
        logits,
        {
            "preprocessing": preprocessing,
            "inference": inference,
            "postprocessing": post,
        },
        quality_ctc(
            reference,
            logits,
            duration=len(audio) / 16000,
            blank=int(processor.tokenizer.pad_token_id or 0),
            delimiter=getattr(processor.tokenizer, "word_delimiter_token_id", None),
        ),
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("fcpe", "ctc_ru", "ctc_uk"))
    parser.add_argument(
        "backend",
        choices=(
            "ort-cpu",
            "ort-cuda",
            "ort-directml",
            "ort-tensorrt",
            "openvino-cpu",
            "openvino-gpu",
        ),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--precision", choices=("fp32", "fp16"), default="fp32")
    args = parser.parse_args()
    result = {
        "model": args.model,
        "backend": args.backend,
        "precision": args.precision,
        "lengths": [],
    }
    with ResourceSampler() as resources:
        try:
            runner, load_time = timer(
                lambda: create_runtime(args.backend, args.model, args.precision)
            )
            runner, providers = runner
            result.update(status="success", cold_load=load_time, providers=providers)
            if args.model == "fcpe":
                import torchfcpe

                ref_model = torchfcpe.spawn_bundled_infer_model(device="cpu")
                cent_table = ref_model.model.cent_table.numpy()
                preprocessor_device = (
                    "cuda" if args.backend in {"ort-cuda", "ort-tensorrt"} else "cpu"
                )
                preprocessor = ref_model.wav2mel.to(preprocessor_device)
            else:
                processor = load_processor(MODELS[args.model])
            reference_root = ARTIFACTS.parent / "reference"
            reference_arrays = np.load(reference_root / f"{args.model}.npz")
            reference_manifest = json.loads(
                (reference_root / f"{args.model}.json").read_text(encoding="utf-8")
            )
            for duration in DURATIONS[args.model]:
                audio = load_audio(duration)
                if args.model == "fcpe":
                    reference = (
                        reference_arrays[f"f0_{duration:g}"],
                        reference_arrays[f"confidence_{duration:g}"],
                    )
                    outputs = [
                        run_fcpe(
                            runner,
                            preprocessor,
                            preprocessor_device,
                            audio,
                            reference,
                            cent_table,
                        )
                        for _ in range(3)
                    ]
                else:
                    reference = reference_arrays[f"logits_{duration:g}"]
                    outputs = [
                        run_ctc(args.model, runner, processor, audio, reference)
                        for _ in range(3)
                    ]
                reference_times = next(
                    item
                    for item in reference_manifest["lengths"]
                    if item["seconds"] == duration
                )["warm"]
                timings = [item[1] for item in outputs]
                warm_timings = timings[1:]
                quality = outputs[-1][2]
                result["lengths"].append(
                    {
                        "seconds": duration,
                        "reference": reference_times,
                        "warm": {
                            key: float(
                                np.median([value[key] for value in warm_timings])
                            )
                            for key in timings[0]
                        },
                        "cold_stage": float(sum(timings[0].values())),
                        "full_stage": float(
                            np.median([sum(value.values()) for value in warm_timings])
                        ),
                        "quality": quality,
                        "stable": all(
                            tuple(part.shape for part in item[0])
                            == tuple(part.shape for part in outputs[0][0])
                            if isinstance(item[0], tuple)
                            else item[0].shape == outputs[0][0].shape
                            for item in outputs
                        ),
                    }
                )
        except Exception as exc:  # noqa: BLE001 - failures are benchmark data
            result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
    result["peak_rss_bytes"] = resources.peak_rss
    result["peak_gpu_bytes"] = resources.peak_gpu
    result["peak_cpu_percent"] = resources.peak_cpu
    result["artifact_bytes"] = artifact_path(args.model, args.precision).stat().st_size
    dep = DEPS / (
        "directml"
        if args.backend == "ort-directml"
        else "openvino"
        if args.backend.startswith("openvino")
        else "ort-gpu"
    )
    result["runtime_bytes"] = sum(
        path.stat().st_size for path in dep.rglob("*") if path.is_file()
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
