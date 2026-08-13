from __future__ import annotations

import math
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

import config

from .errors import AICoreError
from .models import VocalNote

DIAGNOSTIC_AUDIO_VERSION = "stereo-v1-authoritative-game-notes"


def _render_notes(notes: list[VocalNote], frames: int, sample_rate: int) -> np.ndarray:
    audio = np.zeros(frames, dtype=np.float32)
    for note in notes:
        start = max(0, min(frames, round(note.start * sample_rate)))
        end = max(start, min(frames, round(note.end * sample_rate)))
        if end <= start:
            continue
        count = end - start
        t = np.arange(count, dtype=np.float64) / sample_rate
        frequency = 440.0 * 2.0 ** ((int(note.midi_note) - 69) / 12.0)
        # A soft, clearly audible guide tone. Two harmonics make low notes easy
        # to hear without pretending to be the original vocal timbre.
        tone = np.sin(2.0 * math.pi * frequency * t)
        tone += 0.16 * np.sin(4.0 * math.pi * frequency * t)
        envelope = np.ones(count, dtype=np.float64)
        fade = min(round(0.008 * sample_rate), count // 3)
        if fade:
            envelope[:fade] = np.linspace(0.0, 1.0, fade, endpoint=False)
            envelope[-fade:] = np.linspace(1.0, 0.0, fade, endpoint=False)
        audio[start:end] += (tone * envelope * 0.42).astype(np.float32)
    return np.clip(audio, -0.92, 0.92)


def write_diagnostic_audio(
    vocal_path: str | Path,
    target: str | Path,
    notes: list[VocalNote],
    *,
    sample_rate: int = 44_100,
) -> Path:
    """Write an ear-check MP3 from the exact artifacts used by karaoke.

    Left: the analysis vocal that fed pitch/note extraction, deliberately lower.
    Right: synthesized *game_notes* with their final start/end/midi_note values.
    No pitch detection, timing inference, lyric alignment or re-analysis happens
    here, so disagreement in this file is disagreement already present in the
    backend result.
    """
    source = Path(vocal_path)
    output = Path(target)
    if not source.is_file():
        raise FileNotFoundError(source)
    if not notes:
        raise ValueError("diagnostic audio requires at least one game note")

    vocal, source_rate = sf.read(source, dtype="float32", always_2d=True)
    if source_rate != sample_rate:
        raise ValueError(f"unexpected diagnostic vocal sample rate: {source_rate}")
    mono = np.mean(vocal, axis=1, dtype=np.float32)
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak > 0:
        mono = mono * (0.58 / peak)
    melody = _render_notes(notes, len(mono), sample_rate)
    stereo = np.column_stack((mono, melody)).astype(np.float32, copy=False)

    output.parent.mkdir(parents=True, exist_ok=True)
    fd, wav_name = tempfile.mkstemp(prefix="diagnostic-", suffix=".wav", dir=output.parent)
    os.close(fd)
    wav = Path(wav_name)
    temporary = output.with_name(f".{output.name}.tmp.mp3")
    try:
        sf.write(wav, stereo, sample_rate, subtype="PCM_16")
        subprocess.run(
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
            check=True,
            capture_output=True,
            timeout=30 * 60,
        )
        if not temporary.is_file() or temporary.stat().st_size <= 0:
            raise AICoreError("FFmpeg did not create diagnostic MP3")
        os.replace(temporary, output)
    except FileNotFoundError as exc:
        raise AICoreError("FFmpeg is required to create diagnostic audio") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace").strip()
        raise AICoreError(detail or "FFmpeg failed while creating diagnostic audio") from exc
    finally:
        wav.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)
    return output
