from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from statistics import median

import numpy as np
import soundfile as sf

from .audio import render_wav_atomic
from .errors import AICoreError
from .models import PitchFrame
from .utils.numeric import clamp01

VOCAL_ANALYSIS_PREPROCESS_VERSION = "v4-tail-gate-lyric-phrase-filter-20260812"


@dataclass(frozen=True, slots=True)
class PitchTrackQuality:
    score: float
    voiced_ratio: float
    mean_confidence: float
    jump_rate: float
    micro_run_rate: float
    octave_flip_rate: float


def _render_analysis_variant(source: Path, target: Path, filter_graph: str) -> Path:
    source = Path(source)
    if not source.is_file():
        raise FileNotFoundError(source)

    def validate(path: Path) -> None:
        source_info, target_info = sf.info(source), sf.info(path)
        if target_info.frames <= 0:
            raise AICoreError("Vocal preprocessing produced an empty WAV")
        if target_info.samplerate != source_info.samplerate:
            raise AICoreError("Vocal preprocessing changed the sample rate")
        duration_delta = abs(float(target_info.duration) - float(source_info.duration))
        if duration_delta > max(0.002, 1.5 / max(1, source_info.samplerate)):
            raise AICoreError(
                f"Vocal preprocessing changed duration by {duration_delta:.6f}s"
            )

    try:
        return render_wav_atomic(
            source,
            target,
            ["-vn", "-af", filter_graph, "-c:a", "pcm_s24le", "-f", "wav"],
            timeout_sec=30 * 60,
            not_found_message="FFmpeg is required for MIDI vocal preprocessing",
            timeout_message="MIDI vocal preprocessing exceeded safety timeout",
            failed_message="FFmpeg vocal preprocessing failed",
            validate=validate,
        )
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, AICoreError):
            raise
        raise AICoreError(f"Could not validate preprocessed vocal audio: {exc}") from exc


def _adaptive_gate_threshold(source: Path) -> float:
    try:
        audio, _sr = sf.read(source, dtype="float32", always_2d=False)
        values = np.abs(np.asarray(audio, dtype=np.float32).reshape(-1))
        values = values[np.isfinite(values)]
        if values.size < 256: raise ValueError
        quiet = float(np.percentile(values, 35))
        body = float(np.percentile(values, 75))
        threshold = quiet + max(0.0, body - quiet) * 0.08
        return max(0.001, min(0.03, threshold))
    except Exception:
        return 0.008


def prepare_midi_analysis_vocal(source: Path, target: Path) -> Path: return _render_analysis_variant(source, target, 'highpass=f=65:p=2,lowpass=f=6500:p=2,afftdn=nr=8:nf=-48:tn=1:gs=4')


def prepare_midi_analysis_variants(
    source: Path,
    denoise_target: Path,
    tail_target: Path,
) -> dict[str, Path]:
    denoise, gate_threshold = prepare_midi_analysis_vocal(source, denoise_target), _adaptive_gate_threshold(source)
    tail = _render_analysis_variant(
        source,
        tail_target,
        (
            "highpass=f=65:p=2,lowpass=f=6500:p=2,"
            "afftdn=nr=6:nf=-50:tn=1:gs=3,"
            f"agate=threshold={gate_threshold:.6f}:ratio=2.0:attack=8:release=85:knee=2"
        ),
    )
    return {"denoise": denoise, "tail-suppressed": tail}


def _midi(freq: float) -> float: return 69.0 + 12.0 * math.log2(freq / 440.0)


def score_pitch_track(frames: list[PitchFrame]) -> PitchTrackQuality:
    if not frames: return PitchTrackQuality(-1.0, 0.0, 0.0, 1.0, 1.0, 1.0)

    voiced = [frame for frame in frames if frame.voiced and frame.frequency > 0]
    voiced_ratio = len(voiced) / len(frames)
    if len(voiced) < 3: return PitchTrackQuality(-0.5, voiced_ratio, 0.0, 1.0, 1.0, 1.0)

    mean_confidence, jumps, transitions, octave_flips = sum(frame.confidence for frame in voiced) / len(voiced), 0, 0, 0
    for index in range(1, len(frames)):
        left = frames[index - 1]
        right = frames[index]
        if not (left.voiced and right.voiced and left.frequency > 0 and right.frequency > 0): continue
        transitions += 1
        delta = abs(_midi(right.frequency) - _midi(left.frequency))
        if delta >= 5.0: jumps += 1
        if delta >= 10.5 and index + 2 < len(frames):
            future = frames[index + 2]
            if future.voiced and future.frequency > 0:
                returned = abs(_midi(future.frequency) - _midi(left.frequency)) <= 1.5
                if returned: octave_flips += 1

    jump_rate, octave_flip_rate = jumps / max(1, transitions), octave_flips / max(1, transitions)

    run_lengths: list[int] = []
    run = 0
    for frame in frames:
        if frame.voiced and frame.frequency > 0:
            run += 1
        elif run:
            run_lengths.append(run)
            run = 0
    if run: run_lengths.append(run)
    positive_hops = [
        frames[i].time - frames[i - 1].time
        for i in range(1, len(frames))
        if frames[i].time > frames[i - 1].time
    ]
    typical_hop, typical_run = median(positive_hops) if positive_hops else 0.01, median(run_lengths) if run_lengths else 1
    micro_limit = max(
        1,
        int(
            round(
                max(typical_hop * 2.0, typical_run * typical_hop * 0.22) / max(0.001, typical_hop)
            )
        ),
    )
    micro_runs = sum(1 for length in run_lengths if length <= micro_limit)
    micro_run_rate, coverage_term = micro_runs / max(1, len(run_lengths)), min(voiced_ratio, 0.8) / 0.8
    score = (
        0.58 * mean_confidence
        + 0.12 * coverage_term
        - 0.18 * jump_rate
        - 0.08 * micro_run_rate
        - 0.16 * octave_flip_rate
    )
    return PitchTrackQuality(
        float(score),
        float(voiced_ratio),
        float(mean_confidence),
        float(jump_rate),
        float(micro_run_rate),
        float(octave_flip_rate),
    )


def _quality_vector(value: PitchTrackQuality) -> tuple[float, float, float, float, float]: return (value.mean_confidence, -value.jump_rate, -value.micro_run_rate, -value.octave_flip_rate, value.voiced_ratio)


def _relative_wins(candidate: PitchTrackQuality, reference: PitchTrackQuality) -> int:
    left, right = _quality_vector(candidate), _quality_vector(reference)
    return sum(a > b + 1e-9 for a, b in zip(left, right, strict=True)) - sum(
        a + 1e-9 < b for a, b in zip(left, right, strict=True)
    )


def prefer_cleaned_pitch(original: PitchTrackQuality, cleaned: PitchTrackQuality) -> bool:
    if cleaned.voiced_ratio < original.voiced_ratio * 0.70: return False
    return False if cleaned.mean_confidence < original.mean_confidence * 0.92 else _relative_wins(cleaned, original) >= 2


def choose_best_pitch_track(
    qualities: dict[str, PitchTrackQuality], *, original_key: str = "original"
) -> str:
    if original_key not in qualities: raise ValueError("original pitch quality is required")
    original = qualities[original_key]
    viable = {original_key: original}
    for name, candidate in qualities.items():
        if name == original_key: continue
        if candidate.voiced_ratio < original.voiced_ratio * 0.70: continue
        if candidate.mean_confidence < original.mean_confidence * 0.92: continue
        if _relative_wins(candidate, original) >= 2: viable[name] = candidate

    def rank(name: str):
        c = viable[name]
        wins = sum(
            _relative_wins(c, other) for other_name, other in viable.items() if other_name != name
        )
        return (wins, c.score, name == original_key)

    return max(viable, key=rank)


def _rms_envelope(
    path: Path, *, frame_ms: int = 40, hop_ms: int = 20
) -> tuple[np.ndarray, dict[str, float]]:
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    mono, frame, hop = np.mean(np.asarray(audio, dtype=np.float32), axis=1), max(1, int(sample_rate * frame_ms / 1000)), max(1, int(sample_rate * hop_ms / 1000))
    values, rms, peak = np.asarray([float(np.sqrt(np.mean(mono[position:position + frame] ** 2) + 1e-12)) for position in range(0, max(1, len(mono) - frame + 1), hop)], dtype=np.float64) if mono.size else np.asarray([], dtype=np.float64), float(np.sqrt(np.mean(mono * mono) + 1e-12)) if mono.size else 0.0, float(np.max(np.abs(mono))) if mono.size else 0.0
    return values, {
        "rms": rms,
        "peak": peak,
        "crest_factor": peak / max(1e-9, rms),
        "dc_offset": float(np.mean(mono)) if mono.size else 0.0,
        "clipped_sample_ratio": float(np.mean(np.abs(mono) >= 0.999)) if mono.size else 0.0,
    }


def analyze_vocal_residuals(
    vocals: Path,
    instrumental: Path,
    denoised: Path,
    tail_suppressed: Path,
) -> dict[str, object]:
    vocal_env, levels = _rms_envelope(vocals)
    instrumental_env, _ = _rms_envelope(instrumental)
    denoise_env, _ = _rms_envelope(denoised)
    tail_env, _ = _rms_envelope(tail_suppressed)
    size = min(len(vocal_env), len(instrumental_env), len(denoise_env), len(tail_env))
    if size < 32: return {"available": False, "reason": "audio_too_short"}
    vocal_env, instrumental_env, denoise_env, tail_env = vocal_env[:size], instrumental_env[:size], denoise_env[:size], tail_env[:size]

    def _ratio(left: np.ndarray, right: np.ndarray) -> float: return float(np.mean(left) / max(1e-09, float(np.mean(right))))

    centered = np.diff(vocal_env)
    centered -= np.mean(centered)
    denominator = float(np.dot(centered, centered))
    echo_candidates: list[tuple[float, int]] = []
    for lag in range(5, min(31, len(centered) // 4)):
        correlation = float(np.dot(centered[:-lag], centered[lag:]) / max(1e-9, denominator))
        echo_candidates.append((max(0.0, correlation), lag))
    echo_peak, echo_lag = max(echo_candidates, default=(0.0, 0))

    low, high = float(np.percentile(vocal_env, 30)), float(np.percentile(vocal_env, 70))
    threshold = low + 0.35 * max(0.0, high - low)
    decay_ratios: list[float] = []
    for index in range(1, size - 12):
        if vocal_env[index - 1] > threshold >= vocal_env[index]:
            before = float(np.mean(vocal_env[max(0, index - 4) : index]))
            after = float(np.mean(vocal_env[index + 3 : index + 12]))
            decay_ratios.append(after / max(1e-9, before))
    decay_persistence, vocal_centered, instrumental_centered = float(np.median(decay_ratios)) if decay_ratios else 0.0, vocal_env - np.mean(vocal_env), instrumental_env - np.mean(instrumental_env)
    correlation_scale = float(
        np.linalg.norm(vocal_centered) * np.linalg.norm(instrumental_centered)
    )
    envelope_correlation, denoise_attenuation, tail_attenuation, echo_score = float(np.dot(vocal_centered, instrumental_centered) / correlation_scale) if correlation_scale > 1e-12 else 0.0, max(0.0, 1.0 - _ratio(denoise_env, vocal_env)), max(0.0, 1.0 - _ratio(tail_env, vocal_env)), clamp01((echo_peak - 0.08) / 0.35)
    reverb_score, leakage_score, noise_score, clipping_score = clamp01(0.65 * decay_persistence + 0.35 * tail_attenuation), clamp01((envelope_correlation - 0.15) / 0.7), clamp01(denoise_attenuation / 0.25), clamp01(levels['clipped_sample_ratio'] / 0.002)
    return {
        "available": True,
        "levels": levels,
        "cleanup": {
            "denoise_mean_rms_attenuation_ratio": denoise_attenuation,
            "tail_gate_mean_rms_attenuation_ratio": tail_attenuation,
        },
        "proxies": {
            "envelope_echo_peak": echo_peak,
            "envelope_echo_lag_ms": echo_lag * 20,
            "post_phrase_decay_persistence": decay_persistence,
            "vocal_instrumental_envelope_correlation": envelope_correlation,
        },
        "possible_causes_percent": {
            "delay_or_echo": round(100.0 * echo_score, 1),
            "reverb_or_long_release": round(100.0 * reverb_score, 1),
            "accompaniment_leakage": round(100.0 * leakage_score, 1),
            "stationary_noise": round(100.0 * noise_score, 1),
            "clipping_or_hard_distortion": round(100.0 * clipping_score, 1),
        },
        "interpretation": (
            "Signal-only likelihood proxies. They locate suspicious residual behaviour but "
            "cannot name a studio effect with certainty without a dry vocal reference."
        ),
    }
