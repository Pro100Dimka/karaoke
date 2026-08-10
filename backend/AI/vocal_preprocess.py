from __future__ import annotations

import math
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from statistics import median

import soundfile as sf

from .errors import AICoreError
from .models import PitchFrame

VOCAL_ANALYSIS_PREPROCESS_VERSION = "v2-multivariant-denoise-tail-20260810"


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
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(source), "-vn", "-af", filter_graph,
        "-c:a", "pcm_s24le", "-f", "wav", str(temporary),
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
            raise AICoreError(
                f"Vocal preprocessing changed duration by {duration_delta:.6f}s"
            )
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
    tail = _render_analysis_variant(
        source,
        tail_target,
        (
            "highpass=f=65:p=2,lowpass=f=6500:p=2,"
            "afftdn=nr=6:nf=-50:tn=1:gs=3,"
            "agate=threshold=0.012:ratio=2.0:attack=8:release=85:knee=2"
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
    typical_hop = median(
        [frames[i].time - frames[i - 1].time for i in range(1, len(frames)) if frames[i].time > frames[i - 1].time]
    ) if len(frames) > 1 else 0.01
    micro_limit = max(1, int(round(0.045 / max(0.001, typical_hop))))
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


def prefer_cleaned_pitch(
    original: PitchTrackQuality,
    cleaned: PitchTrackQuality,
) -> bool:
    """Choose cleanup only when it is materially better and did not erase vocals."""
    if cleaned.voiced_ratio < max(0.04, original.voiced_ratio * 0.68):
        return False
    if cleaned.mean_confidence + 0.04 < original.mean_confidence:
        return False
    return cleaned.score >= original.score + 0.012



def choose_best_pitch_track(
    qualities: dict[str, PitchTrackQuality],
    *,
    original_key: str = "original",
) -> str:
    """Pick the safest pitch-analysis source among original and cleanup variants."""
    if original_key not in qualities:
        raise ValueError("original pitch quality is required")
    original = qualities[original_key]
    winner = original_key
    winner_score = original.score
    for name, candidate in qualities.items():
        if name == original_key:
            continue
        if candidate.voiced_ratio < max(0.04, original.voiced_ratio * 0.68):
            continue
        if candidate.mean_confidence + 0.04 < original.mean_confidence:
            continue
        # A cleanup branch must materially beat the untouched stem. Between two
        # cleanup branches, keep the highest score once that safety margin clears.
        if candidate.score >= original.score + 0.012 and candidate.score > winner_score:
            winner = name
            winner_score = candidate.score
    return winner
