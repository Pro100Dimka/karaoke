"""
Шаг 3. Разделение дорожек.
song.wav -> vocals.wav, instrumental.wav (+ drums.wav, bass.wav, other.wav)
"""

import argparse
import os
from pathlib import Path

from src.common.model_paths import demucs_cache_dir


def separate(
    input_path: str,
    out_dir: str,
    model: str | None = None,
    two_stems: bool = True,
    shifts: int | None = None,
):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # ``htdemucs_ft`` is a four-model bag: excellent for archival separation
    # but disproportionate for interactive karaoke.  The single htdemucs
    # model keeps clean enough vocals for GAME and runs several times faster.
    # Power users can still opt into the four-pass model via the environment.
    model = model or os.getenv("SONGAPP_DEMUCS_MODEL", "htdemucs")
    requested_device = os.getenv("SONGAPP_DEVICE", "auto").lower()

    # Максимальная длина сегмента для разных моделей
    segment = "7" if model == "htdemucs_ft" or model.startswith("htdemucs") else "10"

    # ``--shifts 2`` runs the costly separator twice. One pass is the best
    # default for interactive karaoke; users who need an archival-quality
    # separation can set SONGAPP_DEMUCS_SHIFTS=2 (or higher).
    demucs_shifts = shifts if shifts is not None else int(os.getenv("SONGAPP_DEMUCS_SHIFTS", "1"))
    demucs_shifts = max(1, demucs_shifts)
    # Run Demucs in-process. Calling ``python -m demucs`` breaks after
    # PyInstaller packaging because ``sys.executable`` then points at the
    # frozen backend executable, not a Python interpreter.
    # Проверяем реальную поддержку CUDA в PyTorch.
    device = "cpu"
    try:
        import torch

        if requested_device != "cpu" and torch.cuda.is_available():
            device = "cuda"
            print("Используется GPU CUDA")
        else:
            print("CUDA недоступна, используется CPU")

    except Exception:
        print("PyTorch CUDA не найден, используется CPU")

    os.environ.setdefault("HF_HOME", str(demucs_cache_dir()))
    from demucs.api import Separator, save_audio

    print(f"Запуск Demucs: {model} ({device}, shifts={demucs_shifts})")
    separator = Separator(
        model=model,
        device=device,
        shifts=demucs_shifts,
        overlap=0.25,
        split=True,
        segment=int(segment),
        progress=False,
    )
    _, stems = separator.separate_audio_file(Path(input_path))
    vocals_dst = out_dir / "vocals.wav"
    instrumental_dst = out_dir / "instrumental.wav"
    save_options = {
        "samplerate": separator.samplerate,
        "clip": "rescale",
        "as_float": False,
        "bits_per_sample": 16,
    }
    save_audio(stems["vocals"], vocals_dst, **save_options)

    other_stems = [audio for name, audio in stems.items() if name != "vocals"]
    instrumental = other_stems[0]
    for audio in other_stems[1:]:
        instrumental = instrumental + audio
    save_audio(instrumental, instrumental_dst, **save_options)

    if not two_stems:
        for stem in ("drums", "bass", "other"):
            if stem in stems:
                save_audio(stems[stem], out_dir / f"{stem}.wav", **save_options)

    return {
        "vocals": str(vocals_dst) if vocals_dst.exists() else None,
        "instrumental": str(instrumental_dst) if instrumental_dst.exists() else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Разделение вокала и инструментала")

    parser.add_argument("input")
    parser.add_argument("--out", default="separated")
    parser.add_argument("--model", default="htdemucs_ft")
    parser.add_argument("--full", action="store_true")

    args = parser.parse_args()

    result = separate(
        args.input,
        args.out,
        args.model,
        two_stems=not args.full,
    )

    print(result)


if __name__ == "__main__":
    main()
