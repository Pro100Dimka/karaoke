"""In-process ONNX inference for the bundled GAME singing-melody model."""

from __future__ import annotations

import ctypes
import os
from pathlib import Path
from typing import Any

import librosa
import numpy as np

from src.common.json_io import load_json

_MODEL_NAMES = ("encoder", "segmenter", "bd2dur", "estimator")
_DLL_DIRECTORY_HANDLES: list[Any] = []


def _prepare_cuda_dlls() -> None:
    """Let ONNX Runtime reuse CUDA libraries shipped with PyTorch on Windows."""
    if not hasattr(os, "add_dll_directory"):
        return
    try:
        import torch
    except ImportError:
        return

    torch_lib = Path(torch.__file__).resolve().parent / "lib"
    if not torch_lib.is_dir():
        return
    try:
        handle = os.add_dll_directory(str(torch_lib))
    except OSError:
        return
    # Keep the handle alive for the process lifetime; otherwise Windows may
    # remove the directory from the DLL search path immediately.
    _DLL_DIRECTORY_HANDLES.append(handle)


def _select_providers() -> list[str]:
    """Select CUDA only when its native dependencies are actually loadable."""
    import onnxruntime as ort

    if os.getenv("SONGAPP_DEVICE", "auto").strip().lower() == "cpu":
        return ["CPUExecutionProvider"]
    if "CUDAExecutionProvider" not in ort.get_available_providers():
        return ["CPUExecutionProvider"]
    if os.name == "nt":
        try:
            for library in ("cublas64_13.dll", "cublasLt64_13.dll", "cudnn64_9.dll"):
                ctypes.WinDLL(library)
        except OSError:
            print("GAME ONNX: CUDA 13/cuDNN 9 unavailable; using CPU inference.")
            return ["CPUExecutionProvider"]
    return ["CUDAExecutionProvider", "CPUExecutionProvider"]


def _session(path: Path, providers: list[str]) -> Any:
    import onnxruntime as ort

    return ort.InferenceSession(str(path), providers=providers)


def _chunks(length: int, rate: int) -> list[tuple[int, int, int, int]]:
    """Return overlapping 25-second windows."""
    if length <= 0:
        return []
    size, overlap = 25 * rate, rate // 4
    return [
        (max(0, core_start - overlap), min(length, core_end + overlap), core_start, core_end)
        for core_start in range(0, length, size)
        for core_end in [min(length, core_start + size)]
    ]


def _extract_chunk(
    waveform: np.ndarray, rate: int, sessions: dict[str, Any], language_id: int
) -> list[tuple[float, float, float]]:
    audio = np.ascontiguousarray(waveform, dtype=np.float32)[None, :]
    duration = np.asarray([audio.shape[1] / rate], dtype=np.float32)
    x_seg, x_est, mask_t = sessions["encoder"].run(None, {"waveform": audio, "duration": duration})
    known = np.zeros(mask_t.shape, dtype=np.bool_)
    boundaries = known
    for step in range(8):
        (boundaries,) = sessions["segmenter"].run(
            None,
            {
                "x_seg": x_seg,
                "language": np.asarray([language_id], dtype=np.int64),
                "known_boundaries": known,
                "prev_boundaries": boundaries,
                "t": np.asarray([step / 8], dtype=np.float32),
                "maskT": mask_t,
                "threshold": np.asarray(0.2, dtype=np.float32),
                "radius": np.asarray(2, dtype=np.int64),
            },
        )
    durations, mask_n = sessions["bd2dur"].run(None, {"boundaries": boundaries, "maskT": mask_t})
    presence, scores = sessions["estimator"].run(
        None,
        {
            "x_est": x_est,
            "boundaries": boundaries,
            "maskT": mask_t,
            "maskN": mask_n,
            "threshold": np.asarray(0.2, dtype=np.float32),
        },
    )

    notes: list[tuple[float, float, float]] = []
    cursor = 0.0
    for note_duration, voiced, pitch, valid in zip(
        durations[0], presence[0], scores[0], mask_n[0], strict=False
    ):
        duration_value = float(note_duration)
        end = cursor + duration_value
        if bool(valid) and bool(voiced) and duration_value >= 0.06 and 0 <= float(pitch) <= 127:
            notes.append((cursor, end, float(pitch)))
        cursor = end
    return notes


def _load_config(model_dir: Path) -> tuple[int, dict[str, int]]:
    config = load_json(model_dir / "config.json")
    if not isinstance(config, dict):
        raise ValueError("GAME config must be a JSON object")
    rate = int(config.get("samplerate", 0))
    if rate <= 0:
        raise ValueError("GAME config contains an invalid samplerate")
    languages = config.get("languages")
    if languages is None:
        languages = {}
    if not isinstance(languages, dict):
        raise ValueError("GAME config languages must be an object")
    return rate, {str(key): int(value) for key, value in languages.items()}


def _load_sessions(model_dir: Path, providers: list[str]) -> dict[str, Any]:
    paths = {name: model_dir / f"{name}.onnx" for name in _MODEL_NAMES}
    missing = [path.name for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing GAME models: {', '.join(missing)}")
    return {name: _session(path, providers) for name, path in paths.items()}


def extract(audio_path: str | Path, model_dir: str | Path, language: str | None) -> dict[str, Any]:
    """Extract a melody into a compact JSON-compatible payload."""
    _prepare_cuda_dlls()
    model_directory = Path(model_dir)
    rate, languages = _load_config(model_directory)
    providers = _select_providers()
    sessions = _load_sessions(model_directory, providers)
    waveform, _ = librosa.load(audio_path, sr=rate, mono=True)
    if waveform.size == 0:
        raise ValueError("Cannot run GAME on empty audio")

    language_id = int(languages.get(language or "", 0))
    notes: list[dict[str, float | int]] = []
    for start, end, core_start, core_end in _chunks(len(waveform), rate):
        for onset, offset, pitch in _extract_chunk(waveform[start:end], rate, sessions, language_id):
            note_start = onset + start / rate
            note_end = offset + start / rate
            midpoint = (note_start + note_end) / 2
            if core_start / rate <= midpoint < core_end / rate:
                notes.append(
                    {
                        "note": int(round(pitch)),
                        "start": round(note_start, 3),
                        "end": round(note_end, 3),
                    }
                )
    return {
        "engine": "game-onnx",
        "provider": sessions["encoder"].get_providers()[0],
        "notes": notes,
    }
