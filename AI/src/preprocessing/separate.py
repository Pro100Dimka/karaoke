"""
Шаг 3. Разделение дорожек.
song.wav -> vocals.wav, instrumental.wav (+ drums.wav, bass.wav, other.wav)

Использует Demucs (Facebook Research) — современную нейросеть для
разделения аудио на стемы. Требует: pip install demucs (и PyTorch).
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def separate(input_path: str, out_dir: str, model: str = "htdemucs",
             two_stems: bool = True):
    """
    two_stems=True -> получаем vocals.wav + no_vocals.wav (инструментал)
    two_stems=False -> получаем 4 дорожки: vocals, drums, bass, other
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = ["demucs", "-n", model, "-o", str(out_dir)]
    if two_stems:
        cmd += ["--two-stems", "vocals"]
    cmd.append(input_path)

    subprocess.run(cmd, check=True)

    # demucs кладёт результат в out_dir/<model>/<имя_файла_без_расширения>/
    stem_name = Path(input_path).stem
    result_dir = out_dir / model / stem_name

    vocals_src = result_dir / "vocals.wav"
    instrumental_src = result_dir / ("no_vocals.wav" if two_stems else "other.wav")

    vocals_dst = out_dir / "vocals.wav"
    instrumental_dst = out_dir / "instrumental.wav"

    if vocals_src.exists():
        shutil.copy(vocals_src, vocals_dst)
    if instrumental_src.exists():
        shutil.copy(instrumental_src, instrumental_dst)

    if not two_stems:
        for stem in ["drums", "bass"]:
            src = result_dir / f"{stem}.wav"
            if src.exists():
                shutil.copy(src, out_dir / f"{stem}.wav")

    return {
        "vocals": str(vocals_dst) if vocals_src.exists() else None,
        "instrumental": str(instrumental_dst) if instrumental_src.exists() else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Разделение вокала и минуса (Demucs)")
    parser.add_argument("input", help="song.wav")
    parser.add_argument("--out", default="separated", help="Папка для результата")
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--full", action="store_true",
                         help="Разделить на 4 дорожки (vocals/drums/bass/other) вместо 2")
    args = parser.parse_args()

    result = separate(args.input, args.out, args.model, two_stems=not args.full)
    print("Готово:", result)


if __name__ == "__main__":
    main()
