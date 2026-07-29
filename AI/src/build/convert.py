"""
Шаг 2. Конвертация.
song.mp3 -> song.wav

Приводит аудио к единому формату: 44.1 kHz, 16 bit, mono/stereo.
Опционально нормализует громкость (EBU R128 loudness, через ffmpeg
loudnorm — встроенный фильтр, бесплатно, ничего доп. ставить не надо).
"""
import argparse
import subprocess


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
    subprocess.run(cmd, check=True,
                   stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def normalize_loudness(input_path: str, output_path: str,
                        target_lufs: float = -16.0, true_peak: float = -1.5,
                        loudness_range: float = 11.0):
    """
    Нормализует громкость по стандарту EBU R128 (LUFS) через ffmpeg
    loudnorm. Зачем: пороги вроде top_db в анализе пауз или confidence
    в pitch-детекторе были откалиброваны на конкретной громкости —
    если трек смастерен заметно тише/громче обычного, эти пороги
    срабатывают иначе. После нормализации все треки анализируются в
    одинаковых условиях по громкости.

    target_lufs   — целевая интегральная громкость (-16 LUFS — типичный
                     стриминговый стандарт, разумный дефолт для голоса)
    true_peak     — максимальный истинный пик, дБ
    loudness_range — допустимый динамический диапазон, LU

    Это однопроходный loudnorm (без предварительного анализа) — чуть
    менее точен, чем двухпроходный, но не требует парсинга JSON-вывода
    ffmpeg между двумя запусками и работает за один проход.
    """
    filt = f"loudnorm=I={target_lufs}:TP={true_peak}:LRA={loudness_range}"
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", filt,
        output_path,
    ]
    subprocess.run(cmd, check=True,
                   stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description="Конвертация аудио в единый формат")
    parser.add_argument("input", help="Путь к song.mp3")
    parser.add_argument("output", nargs="?", default="song.wav", help="Путь к song.wav")
    parser.add_argument("--rate", type=int, default=44100)
    parser.add_argument("--channels", type=int, default=2, choices=[1, 2])
    parser.add_argument("--bits", type=int, default=16, choices=[16, 24])
    parser.add_argument("--normalize", action="store_true",
                         help="дополнительно нормализовать громкость (EBU R128)")
    parser.add_argument("--target-lufs", type=float, default=-16.0)
    args = parser.parse_args()

    convert(args.input, args.output, args.rate, args.channels, args.bits)
    print(f"Готово: {args.output} ({args.rate} Hz, {args.bits} bit, "
          f"{'mono' if args.channels == 1 else 'stereo'})")

    if args.normalize:
        import shutil
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = f"{tmp}/normalized.wav"
            normalize_loudness(args.output, tmp_path, target_lufs=args.target_lufs)
            shutil.move(tmp_path, args.output)
        print(f"Громкость нормализована до {args.target_lufs} LUFS")


if __name__ == "__main__":
    main()
