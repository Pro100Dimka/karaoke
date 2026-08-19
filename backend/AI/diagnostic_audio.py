from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

import config

from .audio import run_ffmpeg
from .errors import AICoreError
from .models import VocalNote

DIAGNOSTIC_AUDIO_VERSION = "stereo-v1-authoritative-game-notes"


def _render_notes(notes: list[VocalNote], frames: int, sample_rate: int) -> np.ndarray:
    audio = np.zeros(frames, dtype=np.float32)
    for note in notes:
        start = max(0, min(frames, round(note.start * sample_rate))); end = max(start, min(frames, round(note.end * sample_rate)))
        if end <= start: continue
        count = end - start; t = np.arange(count, dtype=np.float64) / sample_rate; frequency = 440.0 * 2.0 ** ((int(note.midi_note) - 69) / 12.0); tone = np.sin(2.0 * math.pi * frequency * t)
        tone += 0.16 * np.sin(4.0 * math.pi * frequency * t); envelope = np.ones(count, dtype=np.float64)
        if fade := min(round(0.008 * sample_rate), count // 3):
            envelope[:fade] = np.linspace(0.0, 1.0, fade, endpoint=False); envelope[-fade:] = np.linspace(1.0, 0.0, fade, endpoint=False)
        audio[start:end] += (tone * envelope * 0.42).astype(np.float32)
    return np.clip(audio, -0.92, 0.92)


def write_diagnostic_audio(
    vocal_path: str | Path,
    target: str | Path,
    notes: list[VocalNote],
    *,
    sample_rate: int = 44_100,
) -> Path:
    source, output = Path(vocal_path), Path(target)
    if not source.is_file(): raise FileNotFoundError(source)
    if not notes: raise ValueError("diagnostic audio requires at least one game note")

    vocal, source_rate = sf.read(source, dtype="float32", always_2d=True)
    if source_rate != sample_rate: raise ValueError(f"unexpected diagnostic vocal sample rate: {source_rate}")
    mono = np.mean(vocal, axis=1, dtype=np.float32); peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak > 0: mono = mono * (0.58 / peak)
    melody = _render_notes(notes, len(mono), sample_rate); stereo = np.column_stack((mono, melody)).astype(np.float32, copy=False)

    output.parent.mkdir(parents=True, exist_ok=True); fd, wav_name = tempfile.mkstemp(prefix="diagnostic-", suffix=".wav", dir=output.parent); os.close(fd); wav, temporary = Path(wav_name), output.with_name(f'.{output.name}.tmp.mp3')
    try:
        sf.write(wav, stereo, sample_rate, subtype="PCM_16")
        run_ffmpeg(
            [
                config.FFMPEG_EXE,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(wav),
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(temporary),
            ],
            timeout_sec=30 * 60,
            not_found_message="FFmpeg is required to create diagnostic audio",
            timeout_message="Diagnostic audio FFmpeg exceeded the safety timeout",
            failed_message="FFmpeg failed while creating diagnostic audio",
        )
        if not temporary.is_file() or temporary.stat().st_size <= 0: raise AICoreError("FFmpeg did not create diagnostic MP3")
        os.replace(temporary, output)
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, AICoreError): raise
        raise AICoreError(f"Could not create diagnostic audio: {exc}") from exc
    finally:
        wav.unlink(missing_ok=True); temporary.unlink(missing_ok=True)
    return output
