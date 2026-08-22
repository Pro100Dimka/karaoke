from __future__ import annotations

from pathlib import Path

MUSIC_ANALYZER_VERSION = "librosa-v1"
KEYS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def analyze_music(path: str | Path) -> dict:
    import librosa
    import numpy as np

    audio, rate = librosa.load(path, sr=22050, mono=True)
    bpm = float(np.asarray(librosa.feature.tempo(y=audio, sr=rate)).reshape(-1)[0]) if audio.size else 120.0
    chroma = librosa.feature.chroma_cqt(y=audio, sr=rate).mean(axis=1) if audio.size else np.zeros(12)
    tonic = int(np.argmax(chroma))
    major = float(chroma[(tonic + 4) % 12]) >= float(chroma[(tonic + 3) % 12])
    return {"bpm": round(bpm), "key": f"{KEYS[tonic]} {'major' if major else 'minor'}"}


def estimate_tempo(path: str | Path) -> float:
    return float(analyze_music(path)["bpm"])
