"""Inspect an audio file with ffprobe."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from src.common.json_io import save_json

FFPROBE_ENTRIES = (
    "format=duration,format_name,bit_rate:"
    "stream=sample_rate,channels,codec_name,bit_rate"
)


def _first_audio_stream(streams: list[dict[str, Any]]) -> dict[str, Any]:
    return next(
        (stream for stream in streams if stream.get("codec_type") in (None, "audio")),
        {},
    )


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _to_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def probe_file(input_path: str) -> dict:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        FFPROBE_ENTRIES,
        "-of",
        "json",
        input_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    raw = json.loads(result.stdout)
    format_info = raw.get("format") or {}
    audio = _first_audio_stream(raw.get("streams") or [])
    return {
        "file": str(input_path),
        "duration_sec": _to_float(format_info.get("duration")),
        "format": format_info.get("format_name"),
        "codec": audio.get("codec_name"),
        "sample_rate_hz": _to_int(audio.get("sample_rate")),
        "channels": _to_int(audio.get("channels")),
        "bit_rate_bps": _to_int(audio.get("bit_rate") or format_info.get("bit_rate")),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Использование: python probe.py song.mp3 [songInfo.json]")
        raise SystemExit(1)

    output = Path(sys.argv[2] if len(sys.argv) > 2 else "songInfo.json")
    info = probe_file(sys.argv[1])
    save_json(info, output)
    print(f"Сохранено: {output}")
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
