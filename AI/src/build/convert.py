"""
Шаг 2. Конвертация.
song.mp3 -> song.wav

Приводит аудио к единому формату: 44.1 kHz, 16 bit, mono/stereo.
"""
import argparse
import subprocess
import sys


def convert(input_path: str, output_path: str, sample_rate: int = 44100,
            channels: int = 2, bit_depth: int = 16):
    codec = "pcm_s16le" if bit_depth == 16 else "pcm_s24le"
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "-c:a", codec,
        output_path,
    ]
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description="Конвертация аудио в единый формат")
    parser.add_argument("input", help="Путь к song.mp3")
    parser.add_argument("output", nargs="?", default="song.wav", help="Путь к song.wav")
    parser.add_argument("--rate", type=int, default=44100)
    parser.add_argument("--channels", type=int, default=2, choices=[1, 2])
    parser.add_argument("--bits", type=int, default=16, choices=[16, 24])
    args = parser.parse_args()

    convert(args.input, args.output, args.rate, args.channels, args.bits)
    print(f"Готово: {args.output} ({args.rate} Hz, {args.bits} bit, "
          f"{'mono' if args.channels == 1 else 'stereo'})")


if __name__ == "__main__":
    main()
