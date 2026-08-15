"""DirectML FCPE debug gate on one real vocal/audio file.

The command compares the current PyTorch CPU FCPE implementation with the
DirectML neural-core adapter. It never changes BackendRegistry quality status,
never writes a production validation marker, and never changes runtime policy.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from AI import runtime  # noqa: E402
from AI.audio import load_mono  # noqa: E402
from AI.engines.fcpe_backends import OrtDirectMLFCPEBackend  # noqa: E402
from AI.engines.pitch import FCPEPitchEstimator  # noqa: E402
from AI.models import PitchFrame  # noqa: E402
from AI.pitch_post import fuse_pitch_with_yin, refine_pitch_confidence, stabilize_pitch  # noqa: E402


def _compare(left: list[PitchFrame], right: list[PitchFrame]) -> dict[str, object]:
    count = min(len(left), len(right))
    left = left[:count]
    right = right[:count]
    left_v = np.asarray([frame.voiced for frame in left], dtype=bool)
    right_v = np.asarray([frame.voiced for frame in right], dtype=bool)
    both = left_v & right_v
    left_f = np.asarray([frame.frequency for frame in left], dtype=np.float64)[both]
    right_f = np.asarray([frame.frequency for frame in right], dtype=np.float64)[both]
    cents = np.abs(1200 * np.log2(np.maximum(right_f, 1e-12) / np.maximum(left_f, 1e-12)))
    return {
        "frames": count,
        "frame_delta": len(right) - len(left),
        "voiced_agreement": float(np.mean(left_v == right_v)) if count else 1.0,
        "cents_mae": float(np.mean(cents)) if cents.size else 0.0,
        "cents_p95": float(np.percentile(cents, 95)) if cents.size else 0.0,
        "cents_max": float(np.max(cents)) if cents.size else 0.0,
    }


def _candidate_frames(candidate, production: list[PitchFrame], sr: int, hop: int) -> list[PitchFrame]:
    step = hop / sr
    frames: list[PitchFrame] = []
    for index, value in enumerate(candidate.f0):
        hz = min(float(value), 1400.0)
        voiced = bool(np.isfinite(hz) and 55.0 <= hz <= 1400.0)
        frames.append(
            PitchFrame(
                index * step,
                hz if voiced else 0.0,
                1.0 if voiced else 0.0,
                voiced,
                production[index].energy if index < len(production) else 0.0,
            )
        )
    return frames


def _stabilized(frames: list[PitchFrame], source: Path) -> list[PitchFrame]:
    return stabilize_pitch(
        fuse_pitch_with_yin(
            refine_pitch_confidence(frames, source, sample_rate=16_000),
            source,
            sample_rate=16_000,
            fmin_hz=55,
            fmax_hz=1400,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    source = args.audio.expanduser().resolve()
    if not source.is_file():
        print(f"[FAIL] Audio file not found: {source}", file=sys.stderr)
        return 2

    directml = ROOT / "downloads/runtimes/onnxruntime-directml"
    artifact = ROOT / "downloads/models/optimized/fcpe/fcpe-core.onnx"
    os.environ["KARAOKE_AI_ORT_DIRECTML_PATH"] = str(directml)
    os.environ["KARAOKE_AI_FCPE_ONNX"] = str(artifact)
    if str(directml) not in sys.path:
        sys.path.insert(0, str(directml))

    previous_device = os.environ.get("SONGAPP_DEVICE")
    os.environ["SONGAPP_DEVICE"] = "cpu"
    runtime.reset_runtime_for_tests()
    runtime.configure_runtime("cpu", force=True)
    estimator = FCPEPitchEstimator()
    backend = OrtDirectMLFCPEBackend(artifact)
    availability = backend.availability()
    if not availability.available:
        print(f"[FAIL] DirectML unavailable: {availability.reason}", file=sys.stderr)
        if previous_device is None:
            os.environ.pop("SONGAPP_DEVICE", None)
        else:
            os.environ["SONGAPP_DEVICE"] = previous_device
        runtime.reset_runtime_for_tests()
        return 3

    # Force the PyTorch reference onto CPU even on a machine with CUDA. The
    # DirectML gate measures the future AMD/Intel path, so CUDA must not leak
    # into preprocessing or the reference implementation.
    estimator._load_model()
    if estimator._device != "cpu":
        print(f"[FAIL] Reference FCPE unexpectedly selected {estimator._device}", file=sys.stderr)
        backend.release()
        if previous_device is None:
            os.environ.pop("SONGAPP_DEVICE", None)
        else:
            os.environ["SONGAPP_DEVICE"] = previous_device
        runtime.reset_runtime_for_tests()
        return 4
    print("Reference device: cpu")
    print("DirectML provider: DmlExecutionProvider")

    # Warm the production model once so model-load time is not confused with
    # steady-state inference time.
    estimator.estimate(source)
    pytorch_times = []
    production: list[PitchFrame] = []
    for _ in range(max(1, args.runs)):
        started = time.perf_counter()
        production = estimator.estimate(source)
        pytorch_times.append(time.perf_counter() - started)

    import torch

    audio, sample_rate = load_mono(source, 16_000)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.999:
        audio = np.ascontiguousarray(audio * (0.999 / peak), dtype=np.float32)
    model = estimator._model
    tensor = torch.from_numpy(np.asarray(audio, dtype=np.float32)).view(1, -1, 1)
    with torch.inference_mode():
        started = time.perf_counter()
        mel = model.wav2mel(tensor, sample_rate)
        preprocess_sec = time.perf_counter() - started
    cent_table = model.model.cent_table.detach().float().cpu().numpy()
    mel_np = np.asarray(mel.detach().cpu(), dtype=np.float32)
    target_length = len(production)

    directml_times = []
    candidate_frames: list[PitchFrame] = []
    providers: tuple[str, ...] = ()
    init_sec = 0.0
    for _ in range(max(1, args.runs)):
        started = time.perf_counter()
        candidate = backend.infer(mel_np, cent_table, target_length=target_length)
        candidate_frames = _candidate_frames(candidate, production, estimator.sr, estimator.hop)
        directml_times.append(time.perf_counter() - started)
        providers = candidate.providers
        init_sec = max(init_sec, candidate.session_initialization_sec)

    production_stable = _stabilized(production, source)
    candidate_stable = _stabilized(candidate_frames, source)
    payload = {
        "audio": str(source),
        "duration_sec": len(audio) / sample_rate if sample_rate else 0.0,
        "providers": list(providers),
        "directml_session_init_sec": init_sec,
        "preprocess_sec": preprocess_sec,
        "pytorch_full_pitch_median_sec": statistics.median(pytorch_times),
        "directml_core_median_sec": statistics.median(directml_times),
        "directml_preprocess_plus_core_sec": preprocess_sec + statistics.median(directml_times),
        "raw": _compare(production, candidate_frames),
        "stabilized": _compare(production_stable, candidate_stable),
    }

    print("A&D Voice DirectML FCPE real-file debug gate")
    print(f"Audio: {source}")
    print(f"Duration: {payload['duration_sec']:.2f}s")
    print("Providers:", ", ".join(payload["providers"]))
    print(f"DirectML session init: {init_sec:.3f}s")
    print(f"PyTorch CPU full pitch median: {payload['pytorch_full_pitch_median_sec']:.4f}s")
    print(f"DirectML preprocess: {preprocess_sec:.4f}s")
    print(f"DirectML core median: {payload['directml_core_median_sec']:.4f}s")
    print(f"DirectML preprocess+core: {payload['directml_preprocess_plus_core_sec']:.4f}s")
    print("Raw:", json.dumps(payload["raw"], ensure_ascii=False))
    print("Stabilized:", json.dumps(payload["stabilized"], ensure_ascii=False))
    print("\nNOTE: this is a debug/feasibility gate, not production approval.")

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"JSON: {args.json_output}")
    backend.release()
    if previous_device is None:
        os.environ.pop("SONGAPP_DEVICE", None)
    else:
        os.environ["SONGAPP_DEVICE"] = previous_device
    runtime.reset_runtime_for_tests()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
