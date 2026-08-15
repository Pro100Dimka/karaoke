"""Real DirectML FCPE neural-core smoke test on the current DX12 adapter.

This proves that the exported ONNX artifact and DirectML adapter can execute on
this PC. It does NOT emulate AMD/Intel performance when run on an NVIDIA GPU.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from AI.engines.fcpe_backends import (  # noqa: E402
    OrtDirectMLFCPEBackend,
    decode_fcpe_latent,
    nearest_resize,
)


def cents_error(reference: np.ndarray, candidate: np.ndarray) -> np.ndarray:
    mask = (reference > 0.0) & (candidate > 0.0)
    if not np.any(mask):
        return np.empty(0, dtype=np.float64)
    return np.abs(
        1200.0
        * np.log2(
            np.maximum(candidate[mask].astype(np.float64), 1e-12)
            / np.maximum(reference[mask].astype(np.float64), 1e-12)
        )
    )


def main() -> int:
    try:
        import torch
        import torchfcpe
    except (ImportError, OSError) as exc:
        print(f"[FAIL] PyTorch/torchfcpe unavailable: {exc}", file=sys.stderr)
        return 1

    rng = np.random.default_rng(20260815)
    bundled = torchfcpe.spawn_bundled_infer_model(device="cpu")
    bundled.eval()
    core = bundled.model.eval()
    cent_table = core.cent_table.detach().float().cpu().numpy()
    backend = OrtDirectMLFCPEBackend()

    try:
        availability = backend.availability()
        if not availability.available:
            print(f"[FAIL] DirectML unavailable: {availability.reason}", file=sys.stderr)
            return 1

        print("A&D Voice FCPE DirectML smoke")
        print(f"Artifact: {backend.artifact}")
        print(f"Availability: {availability.reason}\n")

        for frames in (31, 101, 401):
            mel = rng.normal(0.0, 0.35, size=(1, frames, 128)).astype(np.float32)
            with torch.inference_mode():
                latent = core(torch.from_numpy(mel)).detach().float().cpu().numpy()
            reference_f0, reference_conf = decode_fcpe_latent(latent, cent_table)
            candidate = backend.infer(mel, cent_table, target_length=frames)
            reference_f0 = nearest_resize(reference_f0, frames)[0]
            reference_conf = nearest_resize(reference_conf, frames)[0]

            if candidate.f0.shape != reference_f0.shape:
                raise AssertionError(
                    f"shape mismatch: {candidate.f0.shape} != {reference_f0.shape}"
                )
            if not np.all(np.isfinite(candidate.f0)) or not np.all(
                np.isfinite(candidate.confidence)
            ):
                raise AssertionError("DirectML output contains NaN/Inf")

            voiced_ref = reference_f0 > 0.0
            voiced_dml = candidate.f0 > 0.0
            voiced_agreement = float(np.mean(voiced_ref == voiced_dml))
            cents = cents_error(reference_f0, candidate.f0)
            p95 = float(np.percentile(cents, 95)) if cents.size else 0.0
            conf_mae = float(np.mean(np.abs(reference_conf - candidate.confidence)))

            # Smoke thresholds are deliberately loose: this test detects a broken
            # provider/artifact, not production quality. Corpus/downstream gates
            # remain authoritative for enabling a backend.
            if voiced_agreement < 0.999:
                raise AssertionError(f"voiced agreement too low: {voiced_agreement:.6f}")
            if not math.isfinite(p95) or p95 > 1.0:
                raise AssertionError(f"cents P95 too high: {p95:.6f}")

            print(
                f"[PASS] frames={frames:3d} provider={candidate.providers[0]} "
                f"init={candidate.session_initialization_sec:.3f}s "
                f"infer={candidate.inference_sec:.4f}s "
                f"voiced={voiced_agreement * 100:.5f}% "
                f"cents_p95={p95:.4f} conf_mae={conf_mae:.8f}"
            )
    except Exception as exc:  # noqa: BLE001 - diagnostic command
        print(f"[FAIL] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        backend.release()

    print("\nDirectML adapter executed successfully on the current DX12 GPU.")
    print("This is a compatibility smoke only; AMD/Intel speed still needs real hardware.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
