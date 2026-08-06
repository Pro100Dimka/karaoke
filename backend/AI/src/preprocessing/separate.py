"""Separate an audio track into vocals and instrumental stems with Demucs."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from src.common.model_paths import demucs_cache_dir

DEFAULT_MODEL = "htdemucs"
DEFAULT_SHIFTS = 1


def _positive_int(value: str | int, *, name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc
    return max(1, parsed)


def _resolve_device(requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    try:
        import torch
    except ImportError:
        return "cpu"
    return "cuda" if torch.cuda.is_available() else "cpu"


def _segment_for_model(model: str) -> int:
    return 7 if model.startswith("htdemucs") else 10


def _mix_stems(stems: dict[str, Any], *, excluded: str = "vocals"):
    sources = [audio for name, audio in stems.items() if name != excluded]
    if not sources:
        raise RuntimeError("Demucs returned no instrumental stems")
    mixed = sources[0]
    for source in sources[1:]:
        mixed = mixed + source
    return mixed


def separate(
    input_path: str,
    out_dir: str,
    model: str | None = None,
    two_stems: bool = True,
    shifts: int | None = None,
):
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    selected_model = model or os.getenv("SONGAPP_DEMUCS_MODEL", DEFAULT_MODEL)
    selected_shifts = _positive_int(
        shifts if shifts is not None else os.getenv("SONGAPP_DEMUCS_SHIFTS", DEFAULT_SHIFTS),
        name="Demucs shifts",
    )
    device = _resolve_device(os.getenv("SONGAPP_DEVICE", "auto").strip().lower())
    print("Используется GPU CUDA" if device == "cuda" else "CUDA недоступна, используется CPU")

    os.environ.setdefault("HF_HOME", str(demucs_cache_dir()))
    from demucs.api import Separator, save_audio

    print(f"Запуск Demucs: {selected_model} ({device}, shifts={selected_shifts})")
    separator = Separator(
        model=selected_model,
        device=device,
        shifts=selected_shifts,
        overlap=0.25,
        split=True,
        segment=_segment_for_model(selected_model),
        progress=False,
    )
    _, stems = separator.separate_audio_file(Path(input_path))
    if "vocals" not in stems:
        raise RuntimeError("Demucs returned no vocals stem")

    options = {
        "samplerate": separator.samplerate,
        "clip": "rescale",
        "as_float": False,
        "bits_per_sample": 16,
    }
    vocals = output / "vocals.wav"
    instrumental = output / "instrumental.wav"
    save_audio(stems["vocals"], vocals, **options)
    save_audio(_mix_stems(stems), instrumental, **options)

    if not two_stems:
        for name in ("drums", "bass", "other"):
            if name in stems:
                save_audio(stems[name], output / f"{name}.wav", **options)

    if not vocals.is_file() or not instrumental.is_file():
        raise RuntimeError("Demucs did not create the expected output files")
    return {"vocals": str(vocals), "instrumental": str(instrumental)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Разделение вокала и инструментала")
    parser.add_argument("input")
    parser.add_argument("--out", default="separated")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    print(separate(args.input, args.out, args.model, two_stems=not args.full))


if __name__ == "__main__":
    main()
