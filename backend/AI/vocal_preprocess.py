from __future__ import annotations

import math
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from statistics import median

import numpy as np
import soundfile as sf

from .errors import AICoreError
from .models import PitchFrame

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
    target = Path(target)
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f"{target.name}.", suffix=".wav.tmp", dir=target.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-af",
        filter_graph,
        "-c:a",
        "pcm_s24le",
        "-f",
        "wav",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=30 * 60)
        source_info = sf.info(source)
        target_info = sf.info(temporary)
        if target_info.frames <= 0:
            raise AICoreError("Vocal preprocessing produced an empty WAV")
        if target_info.samplerate != source_info.samplerate:
            raise AICoreError("Vocal preprocessing changed the sample rate")
        duration_delta = abs(float(target_info.duration) - float(source_info.duration))
        if duration_delta > max(0.002, 1.5 / max(1, source_info.samplerate)):
            raise AICoreError(f"Vocal preprocessing changed duration by {duration_delta:.6f}s")
        os.replace(temporary, target)
    except FileNotFoundError as exc:
        raise AICoreError("FFmpeg is required for MIDI vocal preprocessing") from exc
    except subprocess.TimeoutExpired as exc:
        raise AICoreError("MIDI vocal preprocessing exceeded safety timeout") from exc
    except subprocess.CalledProcessError as exc:
        details = exc.stderr.decode("utf-8", "replace").strip()
        raise AICoreError(details or "FFmpeg vocal preprocessing failed") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return target


def _adaptive_gate_threshold(source: Path) -> float:
    """Estimate a conservative expander threshold from the actual vocal stem."""
    try:
        audio, _sr = sf.read(source, dtype="float32", always_2d=False)
        values = np.abs(np.asarray(audio, dtype=np.float32).reshape(-1))
        values = values[np.isfinite(values)]
        if values.size < 256:
            raise ValueError
        quiet = float(np.percentile(values, 35))
        body = float(np.percentile(values, 75))
        # Stay well below the sung body; the gate is only for low-level tails.
        threshold = quiet + max(0.0, body - quiet) * 0.08
        return max(0.001, min(0.03, threshold))
    except Exception:
        return 0.008


def prepare_midi_analysis_vocal(source: Path, target: Path) -> Path:
    """Backward-compatible conservative denoise analysis copy."""
    return _render_analysis_variant(
        source,
        target,
        "highpass=f=65:p=2,lowpass=f=6500:p=2,afftdn=nr=8:nf=-48:tn=1:gs=4",
    )


def prepare_midi_analysis_variants(
    source: Path,
    denoise_target: Path,
    tail_target: Path,
) -> dict[str, Path]:
    """Create time-preserving analysis variants for automatic F0 A/B/C selection.

    ``denoise`` removes stationary background leakage. ``tail`` additionally
    applies a gentle downward expander after denoise so low-level reverb/delay
    tails are attenuated while sung attacks remain intact. Neither branch uses
    pitch correction, time stretching or phase-vocoder resynthesis.
    """
    denoise = prepare_midi_analysis_vocal(source, denoise_target)
    gate_threshold = _adaptive_gate_threshold(source)
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


def _midi(freq: float) -> float:
    return 69.0 + 12.0 * math.log2(freq / 440.0)


def score_pitch_track(frames: list[PitchFrame]) -> PitchTrackQuality:
    """Score raw F0 for ghost-note risk without using lyrics or MIDI output."""
    if not frames:
        return PitchTrackQuality(-1.0, 0.0, 0.0, 1.0, 1.0, 1.0)

    voiced = [frame for frame in frames if frame.voiced and frame.frequency > 0]
    voiced_ratio = len(voiced) / len(frames)
    if len(voiced) < 3:
        return PitchTrackQuality(-0.5, voiced_ratio, 0.0, 1.0, 1.0, 1.0)

    mean_confidence = sum(frame.confidence for frame in voiced) / len(voiced)

    jumps = 0
    transitions = 0
    octave_flips = 0
    for index in range(1, len(frames)):
        left = frames[index - 1]
        right = frames[index]
        if not (left.voiced and right.voiced and left.frequency > 0 and right.frequency > 0):
            continue
        transitions += 1
        delta = abs(_midi(right.frequency) - _midi(left.frequency))
        if delta >= 5.0:
            jumps += 1
        if delta >= 10.5 and index + 2 < len(frames):
            future = frames[index + 2]
            if future.voiced and future.frequency > 0:
                returned = abs(_midi(future.frequency) - _midi(left.frequency)) <= 1.5
                if returned:
                    octave_flips += 1

    jump_rate = jumps / max(1, transitions)
    octave_flip_rate = octave_flips / max(1, transitions)

    # Count very short voiced islands.  Residual accompaniment/reverb often
    # appears as 10-30 ms islands and later becomes a ghost note.
    run_lengths: list[int] = []
    run = 0
    for frame in frames:
        if frame.voiced and frame.frequency > 0:
            run += 1
        elif run:
            run_lengths.append(run)
            run = 0
    if run:
        run_lengths.append(run)
    typical_hop = (
        median(
            [
                frames[i].time - frames[i - 1].time
                for i in range(1, len(frames))
                if frames[i].time > frames[i - 1].time
            ]
        )
        if len(frames) > 1
        else 0.01
    )
    typical_run = median(run_lengths) if run_lengths else 1
    micro_limit = max(
        1,
        int(
            round(
                max(typical_hop * 2.0, typical_run * typical_hop * 0.22) / max(0.001, typical_hop)
            )
        ),
    )
    micro_runs = sum(1 for length in run_lengths if length <= micro_limit)
    micro_run_rate = micro_runs / max(1, len(run_lengths))

    # Confidence is useful, but continuity/absence of short false islands is
    # more important for MIDI rhythm.  Do not reward simply marking everything
    # voiced, hence only a small coverage term.
    coverage_term = min(voiced_ratio, 0.80) / 0.80
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


def _quality_vector(value: PitchTrackQuality) -> tuple[float, float, float, float, float]:
    return (
        value.mean_confidence,
        -value.jump_rate,
        -value.micro_run_rate,
        -value.octave_flip_rate,
        value.voiced_ratio,
    )


def _relative_wins(candidate: PitchTrackQuality, reference: PitchTrackQuality) -> int:
    left = _quality_vector(candidate)
    right = _quality_vector(reference)
    return sum(a > b + 1e-9 for a, b in zip(left, right, strict=True)) - sum(
        a + 1e-9 < b for a, b in zip(left, right, strict=True)
    )


def prefer_cleaned_pitch(original: PitchTrackQuality, cleaned: PitchTrackQuality) -> bool:
    """Select cleanup by multi-metric dominance, not one hand-weighted score."""
    if cleaned.voiced_ratio < original.voiced_ratio * 0.70:
        return False
    if cleaned.mean_confidence < original.mean_confidence * 0.92:
        return False
    return _relative_wins(cleaned, original) >= 2


def choose_best_pitch_track(
    qualities: dict[str, PitchTrackQuality], *, original_key: str = "original"
) -> str:
    if original_key not in qualities:
        raise ValueError("original pitch quality is required")
    original = qualities[original_key]
    viable = {original_key: original}
    for name, candidate in qualities.items():
        if name == original_key:
            continue
        if candidate.voiced_ratio < original.voiced_ratio * 0.70:
            continue
        if candidate.mean_confidence < original.mean_confidence * 0.92:
            continue
        if _relative_wins(candidate, original) >= 2:
            viable[name] = candidate

    def rank(name: str):
        c = viable[name]
        wins = sum(
            _relative_wins(c, other) for other_name, other in viable.items() if other_name != name
        )
        # score remains a deterministic tie-breaker/diagnostic, not the gate.
        return (wins, c.score, name == original_key)

    return max(viable, key=rank)
