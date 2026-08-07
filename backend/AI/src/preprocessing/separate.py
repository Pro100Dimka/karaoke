"""Separate an audio track into vocals and instrumental stems with Demucs."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from src.common.model_paths import demucs_cache_dir

DEFAULT_MODEL = "htdemucs"
DEFAULT_SHIFTS = 1
DEFAULT_SEGMENT = 7


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
    configured = os.getenv("SONGAPP_DEMUCS_SEGMENT")
    if configured:
        return _positive_int(configured, name="Demucs segment")
    # Hybrid Transformer Demucs was trained with short bounded segments.  A
    # larger arbitrary value can trigger invalid internal reshapes in some
    # Demucs/PyTorch combinations; seven seconds is the upstream-safe default.
    return DEFAULT_SEGMENT if model.startswith("htdemucs") else 10


def _overlap() -> float:
    try:
        value = float(os.getenv("SONGAPP_DEMUCS_OVERLAP", "0.15"))
    except ValueError:
        return 0.15
    return max(0.05, min(value, 0.5))


def _mix_stems(stems: dict[str, Any], *, excluded: str = "vocals"):
    sources = [audio for name, audio in stems.items() if name != excluded]
    if not sources:
        raise RuntimeError("Demucs returned no instrumental stems")
    mixed = sources[0]
    for source in sources[1:]:
        mixed = mixed + source
    return mixed


def _create_separator(
    separator_type,
    *,
    model: str,
    device: str,
    shifts: int,
    segment: int,
):
    return separator_type(
        model=model,
        device=device,
        shifts=shifts,
        overlap=_overlap(),
        split=True,
        segment=segment,
        progress=False,
    )


def _separate_with_retry(
    separator_type,
    input_path: str,
    *,
    model: str,
    device: str,
    shifts: int,
):
    configured = _segment_for_model(model)
    attempts = []
    for candidate in (configured, DEFAULT_SEGMENT, 6, 5):
        if candidate not in attempts:
            attempts.append(candidate)

    last_error: RuntimeError | None = None
    for index, segment in enumerate(attempts):
        try:
            separator = _create_separator(
                separator_type,
                model=model,
                device=device,
                shifts=shifts,
                segment=segment,
            )
            _, stems = separator.separate_audio_file(Path(input_path))
            return separator, stems
        except RuntimeError as exc:
            last_error = exc
            message = str(exc).lower()
            recoverable = (
                ("shape" in message and "invalid" in message)
                or "out of memory" in message
                or "cuda" in message and "memory" in message
            )
            if not recoverable or index == len(attempts) - 1:
                raise
            next_segment = attempts[index + 1]
            print(
                f"Demucs failed with segment={segment}; "
                f"retrying with segment={next_segment}. {exc}"
            )
            _release_cuda_cache(device)
    assert last_error is not None
    raise last_error



def _release_cuda_cache(device: str) -> None:
    if device != "cuda":
        return
    try:
        import torch

        torch.cuda.empty_cache()
    except (ImportError, RuntimeError):
        pass


def separate(
    input_path: str,
    out_dir: str,
    model: str | None = None,
    two_stems: bool = True,
    shifts: int | None = None,
):
    source = Path(input_path)
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

    segment = _segment_for_model(selected_model)
    print(
        f"Запуск Demucs: {selected_model} "
        f"({device}, shifts={selected_shifts}, segment={segment}, overlap={_overlap():.2f})"
    )
    separator, stems = _separate_with_retry(
        Separator,
        str(source),
        model=selected_model,
        device=device,
        shifts=selected_shifts,
    )
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
    try:
        save_audio(stems["vocals"], vocals, **options)
        save_audio(_mix_stems(stems), instrumental, **options)
        if vocals.stat().st_size == 0 or instrumental.stat().st_size == 0:
            raise RuntimeError("Demucs produced an empty stem")
    except Exception:
        vocals.unlink(missing_ok=True)
        instrumental.unlink(missing_ok=True)
        raise

    if not two_stems:
        for name in ("drums", "bass", "other"):
            if name in stems:
                save_audio(stems[name], output / f"{name}.wav", **options)

    del stems
    del separator
    _release_cuda_cache(device)
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
