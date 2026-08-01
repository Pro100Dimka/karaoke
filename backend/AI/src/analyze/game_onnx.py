"""In-process ONNX inference for the bundled GAME singing-melody model."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import librosa
import numpy as np


def _prepare_cuda_dlls() -> None:
    """Let ONNX Runtime reuse the CUDA libraries shipped with PyTorch."""
    try:
        import torch

        torch_lib = Path(torch.__file__).resolve().parent / "lib"
        if torch_lib.is_dir() and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(torch_lib))
    except Exception:
        pass


def _session(path: Path) -> Any:
    import onnxruntime as ort

    return ort.InferenceSession(
        str(path), providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )


def _chunks(length: int, rate: int) -> list[tuple[int, int, int, int]]:
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
    notes, cursor = [], 0.0
    for note_duration, voiced, pitch, valid in zip(
        durations[0], presence[0], scores[0], mask_n[0], strict=False
    ):
        end = cursor + float(note_duration)
        if valid and voiced and note_duration >= 0.06 and 0 <= pitch <= 127:
            notes.append((cursor, end, float(pitch)))
        cursor = end
    return notes


def extract(audio_path: str | Path, model_dir: str | Path, language: str | None) -> dict[str, Any]:
    """Extract a melody into a small JSON-compatible payload."""
    _prepare_cuda_dlls()
    model_dir = Path(model_dir)
    config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
    rate = int(config["samplerate"])
    languages = config.get("languages") or {}
    language_id = int(languages.get(language, 0))
    sessions = {
        name: _session(model_dir / f"{name}.onnx")
        for name in ("encoder", "segmenter", "bd2dur", "estimator")
    }
    waveform, _ = librosa.load(audio_path, sr=rate, mono=True)
    notes: list[dict[str, float | int]] = []
    for start, end, core_start, core_end in _chunks(len(waveform), rate):
        for onset, offset, pitch in _extract_chunk(
            waveform[start:end], rate, sessions, language_id
        ):
            note_start, note_end = onset + start / rate, offset + start / rate
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
