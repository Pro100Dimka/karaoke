

import json
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, write_json

import librosa
import numpy as np
import soundfile as sf
from scipy import ndimage, signal

import sys
SOURCE = ROOT / "build/performance-baseline-after-v2/warm/song.wav"
OUTPUT = ROOT / "build/ai-runtime-benchmark/hpss-feasibility.json"
KERNEL = 31
RADIUS = KERNEL // 2


def measured(function): started = time.perf_counter(); result = function(); return result, time.perf_counter() - started


def medfilt2d_exact(magnitude: np.ndarray, axis: int) -> np.ndarray: padding = ((0, 0), (RADIUS, RADIUS)) if axis == 1 else ((RADIUS, RADIUS), (0, 0)); padded = np.pad(magnitude, padding, mode="symmetric"); kernel = (1, KERNEL) if axis == 1 else (KERNEL, 1); filtered = signal.medfilt2d(padded, kernel_size=kernel); return filtered[:, RADIUS:-RADIUS] if axis == 1 else filtered[RADIUS:-RADIUS, :]


def torch_cuda_median(
    magnitude: np.ndarray, axis: int, chunk_rows: int = 256
) -> np.ndarray:
    import torch

    oriented = magnitude if axis == 1 else magnitude.T; padded = np.pad(oriented, ((0, 0), (RADIUS, RADIUS)), mode="symmetric"); source = torch.from_numpy(padded).cuda(); output = np.empty_like(oriented)
    for start in range(0, len(oriented), chunk_rows):
        end = min(len(oriented), start + chunk_rows); windows = source[start:end].unfold(1, KERNEL, 1); output[start:end] = windows.median(dim=-1).values.cpu().numpy()
    return output if axis == 1 else output.T


def compare(reference: np.ndarray, candidate: np.ndarray) -> dict[str, float | bool]:
    difference = np.abs(reference - candidate)
    return {
        "exact": bool(np.array_equal(reference, candidate)),
        "max_abs": float(np.max(difference)),
        "mean_abs": float(np.mean(difference)),
    }


def main() -> None:
    audio, sample_rate = sf.read(SOURCE, dtype="float32", always_2d=False)
    if audio.ndim > 1: audio = np.mean(audio, axis=1, dtype=np.float32)
    if sample_rate != 22_050: audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=22_050)
    spectrum, stft_sec = measured(
        lambda: librosa.stft(audio, n_fft=2048, hop_length=512)
    )
    magnitude = np.abs(spectrum).astype(np.float32, copy=False)
    (harmonic, percussive), scipy_sec = measured(
        lambda: (
            ndimage.median_filter(magnitude, size=(1, KERNEL), mode="reflect"),
            ndimage.median_filter(magnitude, size=(KERNEL, 1), mode="reflect"),
        )
    )
    candidates: dict[str, object] = {
        "scipy_ndimage_current": {
            "seconds": scipy_sec,
            "exact": True,
            "dependency": "existing scipy",
        }
    }
    (signal_h, signal_p), signal_sec = measured(
        lambda: (medfilt2d_exact(magnitude, 1), medfilt2d_exact(magnitude, 0))
    )
    candidates["scipy_signal_medfilt2d_symmetric"] = {
        "seconds": signal_sec,
        "harmonic": compare(harmonic, signal_h),
        "percussive": compare(percussive, signal_p),
        "dependency": "existing scipy",
    }
    (_, _), rank_sec = measured(
        lambda: (
            ndimage.rank_filter(
                magnitude, KERNEL // 2, size=(1, KERNEL), mode="reflect"
            ),
            ndimage.rank_filter(
                magnitude, KERNEL // 2, size=(KERNEL, 1), mode="reflect"
            ),
        )
    )
    candidates["scipy_ndimage_rank_filter"] = {
        "seconds": rank_sec,
        "equivalence": "same rank/kernel/boundary contract",
        "dependency": "existing scipy",
    }
    try:
        (torch_h, torch_p), torch_sec = measured(
            lambda: (torch_cuda_median(magnitude, 1), torch_cuda_median(magnitude, 0))
        )
        candidates["torch_cuda_chunked_median"] = {
            "seconds": torch_sec,
            "harmonic": compare(harmonic, torch_h),
            "percussive": compare(percussive, torch_p),
            "dependency": "existing PyTorch CUDA on NVIDIA only",
            "chunk_rows": 256,
        }
    except (ImportError, RuntimeError) as exc:
        candidates["torch_cuda_chunked_median"] = {
            "status": "unavailable",
            "reason": f"{type(exc).__name__}: {exc}",
        }
    payload = {
        "source": str(SOURCE),
        "duration_seconds": len(audio) / 22_050,
        "spectrogram_shape": list(magnitude.shape),
        "spectrogram_bytes": magnitude.nbytes,
        "kernel": KERNEL,
        "boundary": "reflect (half-sample symmetric)",
        "stft_seconds": stft_sec,
        "candidates": candidates,
        "not_installed": {
            "cupy_ndimage": "NVIDIA-only and adds a large CUDA-specific runtime",
            "opencv_medianBlur": "square-kernel/type constraints do not match separable 1x31/31x1 float32 contract",
        },
    }
    write_json(OUTPUT, payload); print(OUTPUT)


if __name__ == "__main__": main()
