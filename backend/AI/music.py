from __future__ import annotations

import math
from pathlib import Path

from .audio import load_mono

_NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
_MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)


def _canonical_tempo(value: float) -> float:
    while value < 62.0:
        value *= 2.0
    while value > 190.0:
        value /= 2.0
    return value


def _estimate_key(librosa, harmonic, sample_rate: int) -> tuple[str | None, float]:
    import numpy as np

    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
    if not chroma.size:
        return None, 0.0
    energy = np.percentile(chroma, 75, axis=1)
    if not np.any(np.isfinite(energy)) or float(np.sum(energy)) <= 1e-8:
        return None, 0.0
    scores: list[tuple[float, int, str]] = []
    for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
        base = np.asarray(profile, dtype=float)
        for tonic in range(12):
            score = float(np.corrcoef(energy, np.roll(base, tonic))[0, 1])
            if math.isfinite(score):
                scores.append((score, tonic, mode))
    if not scores:
        return None, 0.0
    scores.sort(reverse=True)
    best = scores[0]
    runner_up = scores[1][0] if len(scores) > 1 else -1.0
    confidence = max(0.0, min(1.0, 0.5 + (best[0] - runner_up) * 1.8))
    return f"{_NOTE_NAMES[best[1]]} {best[2]}", confidence


def analyze_music(path: str | Path) -> dict[str, float | str | None]:
    """Estimate stable global BPM and musical key from the instrumental stem."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        return {"bpm": 120.0, "tempo_confidence": 0.0, "key": None, "key_confidence": 0.0}

    try:
        audio, sample_rate = load_mono(path, 22_050)
        if len(audio) < sample_rate:
            raise ValueError("audio is too short")
        harmonic, percussive = librosa.effects.hpss(audio)
        onset = librosa.onset.onset_strength(y=percussive, sr=sample_rate)
        tracked, beats = librosa.beat.beat_track(
            onset_envelope=onset,
            sr=sample_rate,
            trim=False,
            units="frames",
        )
        tracked_value = float(tracked.item() if hasattr(tracked, "item") else tracked)
        candidates = [_canonical_tempo(tracked_value)] if tracked_value > 0 else []
        beat_times = librosa.frames_to_time(beats, sr=sample_rate)
        intervals = np.diff(beat_times)
        intervals = intervals[(intervals > 0.25) & (intervals < 2.0)]
        if intervals.size >= 4:
            candidates.append(_canonical_tempo(60.0 / float(np.median(intervals))))
        local_tempo = librosa.feature.tempo(onset_envelope=onset, sr=sample_rate, aggregate=None)
        local_tempo = local_tempo[np.isfinite(local_tempo) & (local_tempo > 0)]
        if local_tempo.size:
            candidates.append(_canonical_tempo(float(np.median(local_tempo))))
        if not candidates:
            raise ValueError("tempo estimation returned no candidates")
        # Beat tracking is the phase-aware estimate. Other estimators are used
        # as confidence checks only: taking their median can jump to an unrelated
        # harmonic (for example 136 instead of the actual ~100 BPM).
        bpm = candidates[0]
        spread = float(np.std([value - bpm for value in candidates])) if len(candidates) > 1 else 10.0
        tempo_confidence = max(0.0, min(1.0, 1.0 - spread / 18.0))
        key, key_confidence = _estimate_key(librosa, harmonic, sample_rate)
    except (OSError, RuntimeError, ValueError, TypeError, FloatingPointError):
        return {"bpm": 120.0, "tempo_confidence": 0.0, "key": None, "key_confidence": 0.0}

    return {
        "bpm": round(min(300.0, max(30.0, bpm)), 1),
        "tempo_confidence": round(tempo_confidence, 3),
        "key": key,
        "key_confidence": round(key_confidence, 3),
    }


def estimate_tempo(path: str | Path) -> float:
    """Backward-compatible tempo-only API."""
    return float(analyze_music(path)["bpm"])
