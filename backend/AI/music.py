from __future__ import annotations

from pathlib import Path

from .audio import load_mono


def estimate_tempo(path: str | Path) -> float:
    """Estimate a stable global tempo; return 120 BPM when beat tracking is unavailable."""
    try:
        import librosa
    except ImportError:
        return 120.0

    try:
        audio, sample_rate = load_mono(path, 22_050)
        if len(audio) < sample_rate:
            return 120.0
        tempo, _ = librosa.beat.beat_track(y=audio, sr=sample_rate, units="time")
        value = float(tempo.item() if hasattr(tempo, "item") else tempo)
    except (OSError, RuntimeError, ValueError, TypeError):
        return 120.0

    return min(300.0, max(30.0, value)) if value > 0 else 120.0
