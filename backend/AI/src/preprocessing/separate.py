"""
Шаг 3. Разделение дорожек.
song.wav -> vocals.wav, instrumental.wav (+ drums.wav, bass.wav, other.wav)
"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def separate(
    input_path: str,
    out_dir: str,
    model: str = "htdemucs_ft",
    two_stems: bool = True,
    shifts: int | None = None,
):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Максимальная длина сегмента для разных моделей
    segment = "7" if model == "htdemucs_ft" or model.startswith("htdemucs") else "10"

    # ``--shifts 2`` runs the costly separator twice. One pass is the best
    # default for interactive karaoke; users who need an archival-quality
    # separation can set SONGAPP_DEMUCS_SHIFTS=2 (or higher).
    demucs_shifts = shifts if shifts is not None else int(os.getenv("SONGAPP_DEMUCS_SHIFTS", "1"))
    demucs_shifts = max(1, demucs_shifts)
    cmd = [
        "demucs",
        "-n", model,
        "-o", str(out_dir),
        "--segment", segment,
        "--shifts", str(demucs_shifts),
    ]

    # GPU если есть
    # Проверяем реальную поддержку CUDA в PyTorch
    try:
        import torch

        if torch.cuda.is_available():
            cmd += ["-d", "cuda"]
            print("Используется GPU CUDA")
        else:
            cmd += ["-d", "cpu"]
            print("CUDA недоступна, используется CPU")

    except Exception:
        cmd += ["-d", "cpu"]
        print("PyTorch CUDA не найден, используется CPU")

    if two_stems:
        cmd += ["--two-stems", "vocals"]

    cmd.append(input_path)

    print("Запуск Demucs:")
    print(" ".join(cmd))

    result = subprocess.run(
        cmd,
        text=True,
    )

    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError("Demucs завершился с ошибкой.")

    stem_name = Path(input_path).stem
    result_dir = out_dir / model / stem_name

    vocals_src = result_dir / "vocals.wav"
    instrumental_src = result_dir / (
        "no_vocals.wav" if two_stems else "other.wav"
    )

    vocals_dst = out_dir / "vocals.wav"
    instrumental_dst = out_dir / "instrumental.wav"

    if vocals_src.exists():
        shutil.copy2(vocals_src, vocals_dst)

    if instrumental_src.exists():
        shutil.copy2(instrumental_src, instrumental_dst)

    if not two_stems:
        for stem in ("drums", "bass", "other"):
            src = result_dir / f"{stem}.wav"
            if src.exists():
                shutil.copy2(src, out_dir / f"{stem}.wav")

    return {
        "vocals": str(vocals_dst) if vocals_dst.exists() else None,
        "instrumental": str(instrumental_dst) if instrumental_dst.exists() else None,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Разделение вокала и инструментала"
    )

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
