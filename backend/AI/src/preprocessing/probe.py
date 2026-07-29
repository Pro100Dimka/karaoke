"""
Шаг 1. Проверка файла.
song.mp3 -> songInfo.json

Рассчитывает: длительность, формат, частоту дискретизации,
количество каналов, битрейт.
"""
import json
import subprocess
import sys
from pathlib import Path


def probe_file(input_path: str) -> dict:
    """Использует ffprobe (часть ffmpeg) для получения метаданных аудио."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries",
        "format=duration,format_name,bit_rate:stream=sample_rate,channels,codec_name,bit_rate",
        "-of", "json",
        input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    raw = json.loads(result.stdout)

    fmt = raw.get("format", {})
    streams = raw.get("streams", [])
    audio_stream = streams[0] if streams else {}

    info = {
        "file": str(input_path),
        "duration_sec": float(fmt.get("duration", 0.0)),
        "format": fmt.get("format_name"),
        "codec": audio_stream.get("codec_name"),
        "sample_rate_hz": int(audio_stream.get("sample_rate", 0)),
        "channels": int(audio_stream.get("channels", 0)),
        "bit_rate_bps": int(audio_stream.get("bit_rate") or fmt.get("bit_rate") or 0),
    }
    return info


def main():
    if len(sys.argv) < 2:
        print("Использование: python step01_probe.py song.mp3 [songInfo.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "songInfo.json"

    info = probe_file(input_path)

    Path(output_path).write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Сохранено: {output_path}")
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
