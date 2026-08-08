from __future__ import annotations

import statistics
from dataclasses import dataclass

from .models import PitchFrame, Syllable, VocalNote, Word


@dataclass(frozen=True)
class QualityReport:
    pitch_coverage: float
    pitch_confidence: float
    word_coverage: float
    alignment_confidence: float
    syllable_confidence: float
    note_coverage: float
    overall: float
    warnings: tuple[str, ...]


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def evaluate_quality(
    duration: float,
    pitch: list[PitchFrame],
    words: list[Word],
    syllables: list[Syllable],
    notes: list[VocalNote],
) -> QualityReport:
    duration = max(1e-6, duration)
    voiced = [f for f in pitch if f.voiced and f.frequency > 0]
    pitch_coverage = _clamp(len(voiced) / max(1, len(pitch)))
    pitch_confidence = _clamp(statistics.mean([f.confidence for f in voiced]) if voiced else 0.0)
    word_time = sum(max(0, w.end - w.start) for w in words)
    word_coverage = _clamp(word_time / duration)
    alignment_confidence = _clamp(statistics.mean([w.confidence for w in words]) if words else 0.0)
    syllable_confidence = _clamp(
        statistics.mean([s.confidence for s in syllables]) if syllables else 0.0
    )
    note_time = sum(max(0, n.end - n.start) for n in notes)
    note_coverage = _clamp(note_time / max(word_time, 1e-6))
    # Singing often has 20–70% voiced coverage. Do not punish natural instrumental gaps.
    pitch_score = _clamp(pitch_coverage / 0.35) * 0.45 + pitch_confidence * 0.55
    alignment_score = alignment_confidence * 0.7 + _clamp(word_coverage / 0.7) * 0.3
    note_score = _clamp(note_coverage / 0.75)
    overall = _clamp(
        0.42 * pitch_score + 0.33 * alignment_score + 0.15 * syllable_confidence + 0.10 * note_score
    )
    warnings = []
    if pitch_confidence < 0.45:
        warnings.append("Low pitch confidence; vocal separation or F0 estimation may be unreliable")
    if not words:
        warnings.append("No timed words were produced")
    elif alignment_confidence < 0.5:
        warnings.append("Word alignment confidence is low")
    if syllables and syllable_confidence < 0.55:
        warnings.append("Syllable boundaries are mostly estimated")
    if words and not notes:
        warnings.append("No vocal notes were derived from timed lyrics")
    return QualityReport(
        pitch_coverage,
        pitch_confidence,
        word_coverage,
        alignment_confidence,
        syllable_confidence,
        note_coverage,
        overall,
        tuple(warnings),
    )
