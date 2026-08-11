from __future__ import annotations

import math
from pathlib import Path

from .audio import load_mono

_NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_MAJOR_PROFILE = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
_MINOR_PROFILE = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)
MUSIC_ANALYZER_VERSION = "librosa-adaptive-key-tempo-v5"


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


def _adaptive_key_windows(chroma, frames_per_second: float):
    """Return musically active chroma windows learned from the song itself.

    No fixed 4-24 second intro is assumed. Windows span roughly one eighth of
    the song (bounded only for numerical stability), slide across the complete
    arrangement and are ranked by harmonic energy/contrast.
    """
    import numpy as np
    frames = int(chroma.shape[1])
    if frames < 8:
        return []
    duration = frames / max(frames_per_second, 1e-9)
    window_sec = max(6.0, min(24.0, duration / 8.0))
    window = max(8, min(frames, int(round(window_sec * frames_per_second))))
    stride = max(4, window // 2)
    candidates=[]
    for start in range(0, max(1, frames-window+1), stride):
        end=min(frames,start+window)
        block=chroma[:,start:end]
        if block.shape[1] < 8: continue
        energy=float(np.mean(np.sum(block,axis=0)))
        contrast=float(np.std(np.mean(block,axis=1)))
        candidates.append((energy*(1.0+contrast), block))
    if not candidates:
        return [chroma]
    candidates.sort(key=lambda x:x[0], reverse=True)
    # Diverse high-evidence regions: enough to cover verse/chorus without one
    # fixed location dictating the key.
    keep=max(1,min(5, int(round(math.sqrt(len(candidates))))+1))
    return [block for _,block in candidates[:keep]]


def _estimate_key(librosa, harmonic, sample_rate: int) -> tuple[str | None, float, dict]:
    import numpy as np
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
    if not chroma.size:
        return None, 0.0, {"key_windows": 0}
    global_scores = _profile_scores(chroma)
    if not global_scores:
        return None, 0.0, {"key_windows": 0}
    frames_per_second = sample_rate / 512.0
    windows = _adaptive_key_windows(chroma, frames_per_second)
    support: dict[tuple[int,str], list[float]] = {}
    for block in windows:
        for score, tonic, mode in _profile_scores(block):
            support.setdefault((tonic,mode),[]).append(score)
    # Combine whole-song evidence with median local evidence. This can resolve
    # relative-major/minor ambiguity without assuming where an intro lives.
    ranked=[]
    for global_score, tonic, mode in global_scores:
        local=support.get((tonic,mode),[])
        local_score=float(np.median(local)) if local else global_score
        ranked.append((0.62*global_score+0.38*local_score, global_score, local_score, tonic, mode))
    ranked.sort(reverse=True)
    combined, global_score, local_score, tonic, mode=ranked[0]
    runner=ranked[1][0] if len(ranked)>1 else -1.0
    margin=combined-runner
    confidence=max(0.0,min(0.95,0.45+max(0.0,margin)*1.1+max(0.0,local_score)*0.14))
    return f"{_NOTE_NAMES[tonic]} {mode}", confidence, {
        "key_windows": len(windows),
        "key_global_score": round(float(global_score),4),
        "key_local_score": round(float(local_score),4),
        "key_margin": round(float(margin),4),
    }


def _tracked_tempo(librosa, percussive, sample_rate: int, hop_length: int) -> tuple[float, int, float]:
    import numpy as np
    onset = librosa.onset.onset_strength(y=percussive, sr=sample_rate, hop_length=hop_length)
    tracked, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sample_rate, hop_length=hop_length, trim=False, units="frames")
    value=float(np.asarray(tracked).reshape(-1)[0])
    if value <= 0:
        return 0.0,0,0.0
    # Beat regularity is used as evidence for the raw meter instead of blindly
    # doubling every tempo below an arbitrary BPM threshold.
    regularity=0.0
    if len(beats)>=3:
        intervals=np.diff(np.asarray(beats,dtype=float))
        med=float(np.median(intervals))
        if med>0:
            mad=float(np.median(np.abs(intervals-med)))
            regularity=max(0.0,min(1.0,1.0-mad/med))
    return value, len(beats), regularity


def _octave_related(a: float,b: float,tol: float=0.10)->bool:
    if a<=0 or b<=0: return False
    ratio=max(a,b)/min(a,b)
    return abs(ratio-2.0)<=tol*2.0 or abs(ratio-0.5)<=tol


def _estimate_tempo(librosa, percussive, sample_rate: int) -> tuple[float,float,dict]:
    coarse, coarse_beats, coarse_reg = _tracked_tempo(librosa,percussive,sample_rate,512)
    fine, fine_beats, fine_reg = _tracked_tempo(librosa,percussive,sample_rate,256)
    candidates=[x for x in (coarse,fine) if x>0]
    if not candidates: raise ValueError("tempo estimation returned no candidates")
    if coarse<=0: selected=fine; confidence=0.40+0.40*fine_reg
    elif fine<=0: selected=coarse; confidence=0.40+0.40*coarse_reg
    else:
        disagreement=abs(coarse-fine)/max(coarse,fine)
        if disagreement<=0.08:
            selected=(coarse+fine)/2.0
            confidence=0.58+0.25*(1.0-disagreement/0.08)+0.12*(coarse_reg+fine_reg)/2.0
        elif _octave_related(coarse,fine):
            # Preserve the metrically better-supported candidate, even when it
            # is a legitimate slow tempo below 62 BPM.
            selected=coarse if (coarse_reg,coarse_beats)>=(fine_reg,fine_beats) else fine
            confidence=0.45+0.30*max(coarse_reg,fine_reg)
        else:
            selected=coarse if (coarse_reg,coarse_beats)>=(fine_reg,fine_beats) else fine
            confidence=max(0.30,0.55-disagreement*0.45+0.20*max(coarse_reg,fine_reg))
    return selected,max(0.0,min(0.92,confidence)),{
        "raw_tempo_candidates":[round(float(x),3) for x in candidates],
        "coarse_tempo":round(float(coarse),3),"fine_tempo":round(float(fine),3),
        "coarse_regularity":round(float(coarse_reg),4),"fine_regularity":round(float(fine_reg),4),
    }


def analyze_music(path: str | Path) -> dict[str, float | str | None | list]:
    try:
        import librosa
    except ImportError:
        return {"bpm":120.0,"raw_bpm":None,"tempo_candidates":[],"tempo_confidence":0.0,"key":None,"key_confidence":0.0}
    try:
        audio,sample_rate=load_mono(path,22_050)
        if len(audio)<sample_rate: raise ValueError("audio is too short")
        harmonic,percussive=librosa.effects.hpss(audio)
        bpm,tempo_confidence,tempo_diag=_estimate_tempo(librosa,percussive,sample_rate)
        key,key_confidence,key_diag=_estimate_key(librosa,harmonic,sample_rate)
    except (OSError,RuntimeError,ValueError,TypeError,FloatingPointError):
        return {"bpm":120.0,"raw_bpm":None,"tempo_candidates":[],"tempo_confidence":0.0,"key":None,"key_confidence":0.0}
    value=int(round(min(300.0,max(30.0,bpm))))
    return {"bpm":value,"raw_bpm":round(float(bpm),3),"tempo_candidates":tempo_diag["raw_tempo_candidates"],"tempo_confidence":round(tempo_confidence,3),"key":key,"key_confidence":round(key_confidence,3),**tempo_diag,**key_diag}


def estimate_tempo(path: str | Path) -> float:
    return float(analyze_music(path)["bpm"] or 120.0)
