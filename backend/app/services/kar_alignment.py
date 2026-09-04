from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np


def closest_tempo_octave(detected_bpm: float, kar_bpm: float) -> float:
    if not math.isfinite(detected_bpm) or detected_bpm <= 0:
        raise RuntimeError("Не удалось определить BPM оригинальной песни")
    if not math.isfinite(kar_bpm) or kar_bpm <= 0:
        return detected_bpm
    values = [detected_bpm * 2**step for step in range(-3, 4)]
    return min((value for value in values if 35 <= value <= 260), key=lambda x: abs(math.log(x / kar_bpm)))


def retime_words(value: Any, scale: float, offset: float) -> Any:
    if isinstance(value, list):
        return [retime_words(item, scale, offset) for item in value]
    if isinstance(value, dict):
        return {
            key: round(float(item) * scale + offset, 3) if key in {"start", "end"} else retime_words(item, scale, offset)
            for key, item in value.items()
        }
    return value


def _score_grid(chroma, top, midpoints, pitches, bpm, rate, hop, hint, best, bpms, offsets):
    shifts = np.arange(-6, 6, dtype=np.int16)
    for candidate_bpm in bpms:
        scaled = midpoints * bpm / max(float(candidate_bpm), 0.001)
        for offset in offsets:
            frames = ((scaled + float(offset)) * rate / hop).astype(np.int64)
            valid = (frames >= 0) & (frames < chroma.shape[1])
            count = int(np.count_nonzero(valid))
            if count < 24:
                continue
            valid_frames, valid_pitches = frames[valid], pitches[valid]
            shifted = (valid_pitches[None, :] + shifts[:, None]) % 12
            scores = 0.65 * np.mean(chroma[shifted, valid_frames[None, :]], axis=1)
            scores += 0.35 * np.mean(top[shifted, valid_frames[None, :]], axis=1)
            index = int(np.argmax(scores))
            score, shift = float(scores[index]), int(shifts[index])
            rank = score - 1e-7 * abs(float(candidate_bpm) - hint) - 1e-7 * abs(float(offset))
            if rank > best["rank"]:
                best.update(score=score, rank=rank, bpm=float(candidate_bpm), offset=float(offset), count=count, shift=shift)


def midi_audio_match(document: Any, audio_path: Path, *, max_offset_seconds: float = 1.0) -> dict[str, Any]:
    import librosa

    limit = min(30.0, max(0.0, float(max_offset_seconds)))
    audio, rate = librosa.load(audio_path, sr=11_025, mono=True)
    if audio.size < rate * 20:
        raise RuntimeError("Найденная аудиозапись слишком короткая")
    hop = 1024
    chroma = librosa.feature.chroma_cqt(y=audio, sr=rate, hop_length=hop)
    chroma /= np.maximum(chroma.max(axis=0, keepdims=True), 1e-6)
    top = np.zeros_like(chroma, dtype=bool)
    top[np.argsort(chroma, axis=0)[-3:], np.arange(chroma.shape[1])] = True
    notes = [note for word in document.words for note in word.get("notes", []) if float(note["end"]) - float(note["start"]) >= 0.08]
    if len(notes) < 24:
        raise RuntimeError("В .kar недостаточно нот для проверки найденной аудиозаписи")
    sampled = notes[:: max(1, len(notes) // 600)]
    midpoints = np.asarray([(float(note["start"]) + float(note["end"])) / 2 for note in sampled])
    pitches = np.asarray([int(note["note"]) % 12 for note in sampled], dtype=np.int16)
    detected = float(np.asarray(librosa.feature.tempo(y=audio, sr=rate)).reshape(-1)[0])
    hint = closest_tempo_octave(detected, document.bpm)
    best = {"score": 0.0, "rank": -math.inf, "bpm": hint, "offset": 0.0, "count": 0, "shift": 0}
    args = (chroma, top, midpoints, pitches, document.bpm, rate, hop, hint, best)
    _score_grid(*args, np.arange(document.bpm * 0.88, document.bpm * 1.12 + 0.001, 0.5), np.arange(-limit, limit + 0.001, 0.25))
    coarse_bpm, coarse_offset = best["bpm"], best["offset"]
    fine_offsets = np.arange(max(-limit, coarse_offset - 0.25), min(limit, coarse_offset + 0.25) + 0.001, 0.05)
    _score_grid(*args, np.arange(coarse_bpm - 0.5, coarse_bpm + 0.501, 0.05), fine_offsets)
    audio_bpm = float(best["bpm"])
    return {
        "score": round(float(best["score"]), 4), "offset_seconds": round(float(best["offset"]), 3),
        "time_scale": round(document.bpm / max(audio_bpm, 0.001), 6), "kar_bpm": round(document.bpm, 3),
        "audio_bpm": round(audio_bpm, 3), "detected_audio_bpm": round(detected, 3),
        "pitch_shift_semitones": int(best["shift"]), "audio_duration": round(float(audio.size / rate), 3),
        "compared_notes": int(best["count"]),
    }
