from __future__ import annotations

import math
from pathlib import Path

from .audio import load_mono

_NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
_MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)
MUSIC_ANALYZER_VERSION = "librosa-multires-relative-mode-v4"


def _canonical_tempo(value: float) -> float:
    while value < 62.0:
        value *= 2.0
    while value > 190.0:
        value /= 2.0
    return value


def _profile_scores(chroma) -> list[tuple[float, int, str]]:
    import numpy as np

    energy = np.mean(chroma, axis=1)
    if not np.any(np.isfinite(energy)) or float(np.sum(energy)) <= 1e-8:
        return []
    scores: list[tuple[float, int, str]] = []
    for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
        base = np.asarray(profile, dtype=float)
        for tonic in range(12):
            score = float(np.corrcoef(energy, np.roll(base, tonic))[0, 1])
            if math.isfinite(score):
                scores.append((score, tonic, mode))
    return sorted(scores, reverse=True)


def _estimate_key(librosa, harmonic, sample_rate: int) -> tuple[str | None, float]:
    """Estimate tonic and mode, resolving common relative-key mistakes.

    Whole-song chroma alone often labels a minor song as its relative major.
    The opening harmonic phrase is useful evidence because arrangements commonly
    establish the tonic there.  It is only allowed to flip closely related keys,
    so unusual intros cannot replace an otherwise clear global estimate.
    """
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
    if not chroma.size:
        return None, 0.0
    global_scores = _profile_scores(chroma)
    if not global_scores:
        return None, 0.0
    by_key = {(tonic, mode): score for score, tonic, mode in global_scores}
    best = global_scores[0]

    frames_per_second = sample_rate / 512.0
    intro_start = min(chroma.shape[1], int(4.0 * frames_per_second))
    intro_end = min(chroma.shape[1], int(24.0 * frames_per_second))
    intro = chroma[:, intro_start:intro_end]
    intro_scores = _profile_scores(intro) if intro.shape[1] >= 8 else []
    intro_by_key = {(tonic, mode): score for score, tonic, mode in intro_scores}

    score, tonic, mode = best
    relative = ((tonic - 3) % 12, "minor") if mode == "major" else ((tonic + 3) % 12, "major")
    relative_global = by_key.get(relative, -1.0)
    best_intro = intro_by_key.get((tonic, mode), -1.0)
    relative_intro = intro_by_key.get(relative, -1.0)
    if score - relative_global <= 0.22 and relative_intro >= best_intro + 0.08:
        tonic, mode = relative
        score = relative_global

    competitors = [
        value
        for value, candidate_tonic, candidate_mode in global_scores
        if (candidate_tonic, candidate_mode) != (tonic, mode)
    ]
    margin = score - max(competitors, default=-1.0)
    intro_support = intro_by_key.get((tonic, mode), score)
    confidence = 0.42 + max(0.0, margin) * 0.9 + max(0.0, intro_support) * 0.18
    return f"{_NOTE_NAMES[tonic]} {mode}", max(0.0, min(0.95, confidence))


def _tracked_tempo(librosa, percussive, sample_rate: int, hop_length: int) -> tuple[float, int]:
    import numpy as np

    onset = librosa.onset.onset_strength(
        y=percussive,
        sr=sample_rate,
        hop_length=hop_length,
    )
    tracked, beats = librosa.beat.beat_track(
        onset_envelope=onset,
        sr=sample_rate,
        hop_length=hop_length,
        trim=False,
        units="frames",
    )
    value = float(np.asarray(tracked).reshape(-1)[0])
    return (_canonical_tempo(value), len(beats)) if value > 0 else (0.0, 0)


def _estimate_tempo(librosa, percussive, sample_rate: int) -> tuple[float, float]:
    """Use coarse meter selection and a finer confirmation pass.

    The fine tracker can lock onto drum subdivisions (for example 132 instead
    of a true 100 BPM).  The coarse pass remains authoritative when both meters
    disagree substantially; close estimates are combined to reduce frame-grid
    quantisation.
    """
    coarse, coarse_beats = _tracked_tempo(librosa, percussive, sample_rate, 512)
    fine, fine_beats = _tracked_tempo(librosa, percussive, sample_rate, 256)
    if coarse <= 0 and fine <= 0:
        raise ValueError("tempo estimation returned no candidates")
    if coarse <= 0:
        return fine, 0.45
    if fine <= 0:
        return coarse, 0.45
    disagreement = abs(coarse - fine) / max(coarse, fine)
    if disagreement <= 0.08:
        bpm = (coarse + fine) / 2.0
        confidence = 0.62 + (1.0 - disagreement / 0.08) * 0.25
    else:
        bpm = coarse
        confidence = max(0.32, 0.58 - disagreement * 0.8)
    if min(coarse_beats, fine_beats) < 8:
        confidence *= 0.65
    return bpm, max(0.0, min(0.9, confidence))


def analyze_music(path: str | Path) -> dict[str, float | str | None]:
    """Estimate stable global BPM and musical key from the instrumental stem."""
    try:
        import librosa
    except ImportError:
        return {"bpm": 120.0, "tempo_confidence": 0.0, "key": None, "key_confidence": 0.0}

    try:
        audio, sample_rate = load_mono(path, 22_050)
        if len(audio) < sample_rate:
            raise ValueError("audio is too short")
        harmonic, percussive = librosa.effects.hpss(audio)
        bpm, tempo_confidence = _estimate_tempo(librosa, percussive, sample_rate)
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
