

import json
import math
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, write_json

import librosa
import numpy as np
import soundfile as sf
from AI.music import _adaptive_key_windows, _profile_scores, analyze_music
from scipy.signal import resample_poly

import sys
SOURCE = ROOT / "build/performance-baseline-after-v2/warm/song.wav"
OUTPUT = ROOT / "build/ai-runtime-benchmark/tempo-profile.json"


def measured(function): started = time.perf_counter(); value = function(); return value, time.perf_counter() - started


def run_once():
    audio_data, disk_io = measured(
        lambda: sf.read(SOURCE, dtype="float32", always_2d=True)
    )
    (audio, source_rate) = audio_data; mono, mono_mix = measured(lambda: np.mean(audio, axis=1, dtype=np.float32)); divisor = math.gcd(source_rate, 22050)
    mono, resample = measured(
        lambda: resample_poly(mono, 22050 // divisor, source_rate // divisor).astype(
            np.float32, copy=False
        )
    )
    (harmonic, percussive), hpss = measured(lambda: librosa.effects.hpss(mono))
    onset_512, onset_512_time = measured(
        lambda: librosa.onset.onset_strength(y=percussive, sr=22050, hop_length=512)
    )
    (tempo_512, beats_512), beat_tracking_512 = measured(
        lambda: librosa.beat.beat_track(
            onset_envelope=onset_512,
            sr=22050,
            hop_length=512,
            trim=False,
            units="frames",
        )
    )
    onset_256, onset_256_time = measured(
        lambda: librosa.onset.onset_strength(y=percussive, sr=22050, hop_length=256)
    )
    (tempo_256, beats_256), beat_tracking_256 = measured(
        lambda: librosa.beat.beat_track(
            onset_envelope=onset_256,
            sr=22050,
            hop_length=256,
            trim=False,
            units="frames",
        )
    )
    chroma, chroma_time = measured(
        lambda: librosa.feature.chroma_cqt(y=harmonic, sr=22050)
    )

    def score_key():
        global_scores = _profile_scores(chroma); windows = _adaptive_key_windows(chroma, 22050 / 512.0)
        for block in windows: _profile_scores(block)
        return len(global_scores), len(windows)

    _, key_scoring = measured(score_key)
    total = sum(
        (
            disk_io,
            mono_mix,
            resample,
            hpss,
            onset_512_time,
            beat_tracking_512,
            onset_256_time,
            beat_tracking_256,
            chroma_time,
            key_scoring,
        )
    )
    return {
        "disk_io_decode_wav": disk_io,
        "mono_mix": mono_mix,
        "resample": resample,
        "stft_fft_hpss": hpss,
        "tempo_onset": onset_512_time + onset_256_time,
        "tempo_beat_tracking": beat_tracking_512 + beat_tracking_256,
        "key_chroma_cqt": chroma_time,
        "key_scoring_windows": key_scoring,
        "other": 0.0,
        "accounted_total": total,
        "coarse_bpm": float(np.asarray(tempo_512).reshape(-1)[0]),
        "fine_bpm": float(np.asarray(tempo_256).reshape(-1)[0]),
        "coarse_beats": len(beats_512),
        "fine_beats": len(beats_256),
    }


def main():
    authoritative_runs = [measured(lambda: analyze_music(SOURCE)) for _ in range(3)]; authoritative = authoritative_runs[-1][0]; authoritative_time = float(np.median([item[1] for item in authoritative_runs])); runs = [run_once() for _ in range(3)]
    keys = [key for key in runs[0] if isinstance(runs[0][key], float)]; median = {key: float(np.median([run[key] for run in runs])) for key in keys}; median["other"] = max(0.0, authoritative_time - median["accounted_total"])
    result = {
        "source": str(SOURCE),
        "source_bytes": SOURCE.stat().st_size,
        "duration_seconds": sf.info(SOURCE).duration,
        "authoritative_result": authoritative,
        "authoritative_stage_seconds": authoritative_time,
        "authoritative_runs_seconds": [item[1] for item in authoritative_runs],
        "median_breakdown": median,
        "runs": runs,
    }
    write_json(OUTPUT, result); print(json.dumps(result, indent=2))


if __name__ == "__main__": main()
