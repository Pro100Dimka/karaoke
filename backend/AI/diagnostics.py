from __future__ import annotations

import math
import statistics
from collections import Counter
from typing import Any

from .engines.text import tokenize
from .models import PitchFrame, StageReport, Syllable, VocalNote, Word
from .utils.numeric import clamp01


def _median(values: list[float], default: float = 0.0) -> float:
    clean = [float(v) for v in values if math.isfinite(float(v))]
    return statistics.median(clean) if clean else default


def _pitch_regions(pitch: list[PitchFrame]) -> tuple[list[tuple[float, float]], list[float]]:
    voiced = [frame for frame in pitch if frame.voiced and frame.frequency > 0.0]
    if not voiced: return [], []
    step = _median(
        [b.time - a.time for a, b in zip(voiced, voiced[1:], strict=False) if b.time > a.time],
        0.01,
    )
    join_gap = max(step * 4.0, 0.025)
    regions: list[tuple[float, float]] = []
    onsets: list[float] = []
    start, end = voiced[0].time, voiced[0].time + step
    onsets.append(start)
    for frame in voiced[1:]:
        if frame.time <= end + join_gap:
            end = max(end, frame.time + step)
        else:
            regions.append((start, end))
            start = frame.time
            end = frame.time + step
            onsets.append(start)
    regions.append((start, end))
    return regions, onsets


def _overlap_ratio(start: float, end: float, regions: list[tuple[float, float]]) -> float:
    span, overlap = max(1e-09, end - start), 0.0
    for left, right in regions:
        if right <= start: continue
        if left >= end: break
        overlap += max(0.0, min(end, right) - max(start, left))
    return clamp01(overlap / span)


def _nearest_ms(value: float, points: list[float]) -> float | None: return None if not points else min((abs(value - point) for point in points)) * 1000.0


def _timeline_metrics(items: list[Any]) -> dict[str, Any]:
    intervals = sorted(
        (
            float(item.get("start", 0.0) if isinstance(item, dict) else item.start),
            float(item.get("end", 0.0) if isinstance(item, dict) else item.end),
        )
        for item in items
    )
    overlaps: list[float] = []
    gaps: list[float] = []
    previous_end = None
    for start, end in intervals:
        if previous_end is not None:
            if start < previous_end:
                overlaps.append(previous_end - start)
            elif start > previous_end: gaps.append(start - previous_end)
        previous_end = max(end, previous_end or end)
    return {
        "count": len(intervals),
        "overlap_count": len(overlaps),
        "overlap_total_sec": sum(overlaps),
        "max_overlap_sec": max(overlaps, default=0.0),
        "gap_count": len(gaps),
        "max_gap_sec": max(gaps, default=0.0),
        "micro_interval_count": sum(1 for start, end in intervals if end - start < 0.04),
        "non_positive_interval_count": sum(1 for start, end in intervals if end <= start),
    }


def _candidate_for(candidate: dict[str, Any], kind: str) -> dict[str, float] | None:
    raw = candidate.get(kind)
    if not isinstance(raw, dict): return None
    try:
        return {
            "start": float(raw["start"]),
            "end": float(raw["end"]),
            "confidence": float(raw.get("confidence", 0.0)),
        }
    except (KeyError, TypeError, ValueError):
        return None


def build_alignment_debug(
    *,
    lyrics_text: str,
    words: list[Word],
    syllables: list[Syllable],
    pitch: list[PitchFrame],
    notes: list[VocalNote],
    duration_sec: float,
    raw_pitch: list[PitchFrame] | None = None,
    game_notes: list[VocalNote] | None = None,
    alignment_diagnostics: dict[str, Any] | None,
    reports: list[StageReport],
    note_diagnostics: dict[str, Any] | None = None,
    music_diagnostics: dict[str, Any] | None = None,
    pitch_source_diagnostics: dict[str, Any] | None = None,
    vocal_effect_diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    diag = dict(alignment_diagnostics or {})
    sources, candidates = list(diag.get('word_sources') or []), list(diag.get('word_candidates') or [])
    regions, onsets = _pitch_regions(pitch)
    durations = [max(0.0, word.end - word.start) for word in words]
    typical_duration = max(0.02, _median(durations, 0.25))

    word_rows: list[dict[str, Any]] = []
    source_counts: Counter[str] = Counter()
    rejected_reasons: Counter[str] = Counter()
    for index, word in enumerate(words):
        source = str(sources[index]) if index < len(sources) else "unknown"
        candidate = (
            candidates[index]
            if index < len(candidates) and isinstance(candidates[index], dict)
            else {}
        )
        ctc = _candidate_for(candidate, "ctc")
        qwen = _candidate_for(candidate, "qwen")
        consensus = _candidate_for(candidate, "consensus")
        if source == "unknown":
            sources = [name for name, value in (("ctc", ctc), ("qwen", qwen)) if value]
            if consensus or len(sources) == 2 and abs(
                ((ctc["start"] + ctc["end"]) - (qwen["start"] + qwen["end"])) / 2.0
            ) <= max(0.08, typical_duration * 0.65):
                source = "consensus"
            elif sources:
                source = sources[0] if len(sources) == 1 else "ctc_or_qwen"
            elif word.confidence <= 0.02:
                source = "interpolated"
        source_counts[source] += 1

        span = max(0.0, word.end - word.start)
        overlap = _overlap_ratio(word.start, word.end, regions)
        disagreement_ms = None
        if ctc and qwen:
            ctc_mid = (ctc["start"] + ctc["end"]) / 2.0
            qwen_mid = (qwen["start"] + qwen["end"]) / 2.0
            disagreement_ms = abs(ctc_mid - qwen_mid) * 1000.0

        reasons: list[str] = []
        if word.confidence < 0.08:
            reasons.append("very_low_confidence")
        elif word.confidence < 0.25: reasons.append("low_confidence")
        if span < max(0.025, typical_duration * 0.10): reasons.append("micro_duration")
        if span > max(2.5, typical_duration * 6.0): reasons.append("very_long_duration")
        if overlap < 0.10:
            reasons.append("no_vocal_activity")
        elif overlap < 0.35: reasons.append("weak_vocal_overlap")
        if disagreement_ms is not None and disagreement_ms > max(180.0, typical_duration * 700.0): reasons.append("ctc_qwen_disagreement")
        if source in {"interpolated", "unknown"}: reasons.append("no_direct_acoustic_anchor")
        if index and word.start < words[index - 1].end - 1e-6: reasons.append("timeline_overlap")

        for reason in reasons: rejected_reasons[reason] += 1

        word_rows.append(
            {
                "index": index,
                "text": word.text,
                "final": {
                    "start": word.start,
                    "end": word.end,
                    "duration": span,
                    "confidence": word.confidence,
                    "source": source,
                },
                "candidates": {"ctc": ctc, "qwen": qwen, "consensus": consensus},
                "agreement": {"ctc_qwen_delta_ms": disagreement_ms},
                "vocal": {
                    "overlap_ratio": overlap,
                    "nearest_onset_ms": _nearest_ms(word.start, onsets),
                },
                "reasons": reasons,
            }
        )

    lines: list[dict[str, Any]] = []
    cursor, lyric_lines = 0, [line.strip() for line in str(lyrics_text or '').splitlines() if line.strip()]
    if not lyric_lines and words: lyric_lines = [" ".join(word.text for word in words)]
    for line_index, line in enumerate(lyric_lines):
        count = len(tokenize(line))
        row = word_rows[cursor : cursor + count]
        cursor += count
        if not row: continue
        sources_here: Counter[str] = Counter(item["final"]["source"] for item in row)
        direct = sum(
            value for key, value in sources_here.items() if key in {"consensus", "ctc", "qwen"}
        )
        interpolated = sum(
            value for key, value in sources_here.items() if key in {"interpolated", "unknown"}
        )
        confidences = [float(item["final"]["confidence"]) for item in row]
        disagreements = [
            item["agreement"]["ctc_qwen_delta_ms"]
            for item in row
            if item["agreement"]["ctc_qwen_delta_ms"] is not None
        ]
        reasons = sorted({reason for item in row for reason in item["reasons"]})
        lines.append(
            {
                "line": line_index,
                "text": line,
                "start": row[0]["final"]["start"],
                "end": row[-1]["final"]["end"],
                "duration": max(0.0, row[-1]["final"]["end"] - row[0]["final"]["start"]),
                "word_count": len(row),
                "acoustic_word_ratio": direct / max(1, len(row)),
                "interpolated_word_ratio": interpolated / max(1, len(row)),
                "mean_confidence": sum(confidences) / max(1, len(confidences)),
                "min_confidence": min(confidences),
                "max_ctc_qwen_delta_ms": max(disagreements) if disagreements else None,
                "sources": sources_here,
                "reasons": reasons,
            }
        )

    suspicious_regions: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for item in word_rows:
        if item["reasons"]:
            if current and item["final"]["start"] - current[-1]["final"]["end"] > max(
                0.8, typical_duration * 3.0
            ):
                suspicious_regions.append(_region(current))
                current = []
            current.append(item)
        elif current:
            suspicious_regions.append(_region(current))
            current = []
    if current: suspicious_regions.append(_region(current))

    acoustic_words, mean_conf = sum((value for key, value in source_counts.items() if key in {'consensus', 'ctc', 'qwen'})), sum((word.confidence for word in words)) / max(1, len(words))
    acoustic_ratio, suspicious_ratio = acoustic_words / max(1, len(words)), sum((1 for row in word_rows if row['reasons'])) / max(1, len(word_rows))
    text_health, total_elapsed, stage_perf = round(100.0 * clamp01(0.48 * acoustic_ratio + 0.42 * mean_conf + 0.1 * (1.0 - suspicious_ratio)), 1), sum((max(0.0, float(report.elapsed_sec)) for report in reports)), [{'stage': report.stage, 'elapsed_sec': float(report.elapsed_sec), 'cached': bool(report.cached), 'engine': report.engine} for report in reports]
    stage_perf.sort(key=lambda item: item["elapsed_sec"], reverse=True)

    voiced_frames = sum(1 for frame in pitch if frame.voiced and frame.frequency > 0.0)
    pitch_mean_conf, linked_notes, pitch_changes = sum((frame.confidence for frame in pitch if frame.voiced and frame.frequency > 0.0)) / max(1, voiced_frames), sum((1 for note in notes if note.word_index is not None or note.syllable_index is not None)), {'compared_frames': 0, 'voicing_changes': 0, 'large_pitch_changes': 0, 'mean_abs_semitone_delta': 0.0}
    if raw_pitch:
        raw_by_time = {round(frame.time, 6): frame for frame in raw_pitch}
        deltas: list[float] = []
        voicing_changes = 0
        large_changes = 0
        for frame in pitch:
            original = raw_by_time.get(round(frame.time, 6))
            if original is None: continue
            pitch_changes["compared_frames"] += 1
            if bool(original.voiced) != bool(frame.voiced): voicing_changes += 1
            if original.voiced and frame.voiced and original.frequency > 0 and frame.frequency > 0:
                semitones = abs(12.0 * math.log2(frame.frequency / original.frequency))
                deltas.append(semitones)
                if semitones >= 6.0: large_changes += 1
        pitch_changes["voicing_changes"] = voicing_changes
        pitch_changes["large_pitch_changes"] = large_changes
        pitch_changes["mean_abs_semitone_delta"] = sum(deltas) / max(1, len(deltas))

    pitch_source_analysis = dict(pitch_source_diagnostics or {})
    original_source, tail_source = pitch_source_analysis.get('original'), pitch_source_analysis.get('tail_suppressed')
    if isinstance(original_source, dict) and isinstance(tail_source, dict):
        original_voiced = max(1e-9, float(original_source.get("voiced_ratio") or 0.0))
        tail_removed = clamp01(
            (original_voiced - float(tail_source.get("voiced_ratio") or 0.0)) / original_voiced
        )
        micro_reduction = clamp01(
            float(original_source.get("micro_run_rate") or 0.0)
            - float(tail_source.get("micro_run_rate") or 0.0)
        )
        jump_reduction = clamp01(
            float(original_source.get("jump_rate") or 0.0)
            - float(tail_source.get("jump_rate") or 0.0)
        )
        octave_reduction = clamp01(
            float(original_source.get("octave_flip_rate") or 0.0)
            - float(tail_source.get("octave_flip_rate") or 0.0)
        )
        pitch_source_analysis["effect_residual_indicators"] = {
            "tail_energy_removed_ratio": tail_removed,
            "short_pitched_tail_reduction": micro_reduction,
            "large_jump_reduction": jump_reduction,
            "octave_flip_reduction": octave_reduction,
            "reverb_echo_likelihood": round(
                100.0 * clamp01(0.55 * tail_removed + 0.45 * micro_reduction), 1
            ),
            "harmonic_leakage_likelihood": round(
                100.0 * clamp01(0.55 * octave_reduction + 0.45 * jump_reduction), 1
            ),
            "interpretation": ("comparative signal indicators; not a definitive effect classifier"),
        }

    game = list(game_notes or notes)
    syllable_split_events, syllable_ids, game_syllable_ids = max(0, len(game) - len(notes)), {int(item.index) for item in syllables}, [int(note.syllable_index) for note in game if note.syllable_index is not None]
    game_syllable_set = set(game_syllable_ids)
    events_per_syllable: Counter[int] = Counter(game_syllable_ids)
    game_durations = [max(0.0, float(note.end) - float(note.start)) for note in game]
    if sorted_game_durations := sorted(value for value in game_durations if value > 0.0):

        def _quantile(frac: float) -> float:
            pos = (len(sorted_game_durations) - 1) * frac
            lo, hi = int(math.floor(pos)), int(math.ceil(pos))
            if lo == hi: return sorted_game_durations[lo]
            weight = pos - lo
            return sorted_game_durations[lo] * (1.0 - weight) + sorted_game_durations[hi] * weight

        game_duration_quantiles = {
            "p05": _quantile(0.05),
            "p25": _quantile(0.25),
            "p50": _quantile(0.50),
            "p75": _quantile(0.75),
            "p95": _quantile(0.95),
        }
    else:
        game_duration_quantiles = {key: 0.0 for key in ("p05", "p25", "p50", "p75", "p95")}

    syllable_durations, timeline_integrity, direct_disagreements = sorted((max(0.0, float(item.end) - float(item.start)) for item in syllables)), {'words': _timeline_metrics(words), 'syllables': _timeline_metrics(syllables), 'acoustic_notes': _timeline_metrics(notes), 'game_notes': _timeline_metrics(game), 'lines': _timeline_metrics(lines)}, [float(row['agreement']['ctc_qwen_delta_ms']) for row in word_rows if row['agreement']['ctc_qwen_delta_ms'] is not None]
    disagreement_ratio, effect_indicators, audio_effects = sum((value > 180.0 for value in direct_disagreements)) / max(1, len(direct_disagreements)), pitch_source_analysis.get('effect_residual_indicators') or {}, dict(vocal_effect_diagnostics or {})
    audio_cause_scores = audio_effects.get("possible_causes_percent") or {}
    effect_presence_score, cleanup_metrics = clamp01(max(float(effect_indicators.get('reverb_echo_likelihood') or 0.0), float(effect_indicators.get('harmonic_leakage_likelihood') or 0.0), *(float(value or 0.0) for value in audio_cause_scores.values())) / 100.0), audio_effects.get('cleanup') or {}
    cleanup_impact, pitch_effect_impact = clamp01(max(float(cleanup_metrics.get('denoise_mean_rms_attenuation_ratio') or 0.0), float(cleanup_metrics.get('tail_gate_mean_rms_attenuation_ratio') or 0.0))), clamp01(max(float(effect_indicators.get('reverb_echo_likelihood') or 0.0), float(effect_indicators.get('harmonic_leakage_likelihood') or 0.0)) / 100.0)
    effect_score, alignment_score = clamp01(effect_presence_score * (0.15 + 0.45 * cleanup_impact + 0.4 * pitch_effect_impact)), clamp01(0.38 * suspicious_ratio + 0.27 * (1.0 - mean_conf) + 0.2 * (1.0 - acoustic_ratio) + 0.15 * disagreement_ratio)
    pitch_score, text_overlap_count = clamp01(0.55 * (1.0 - pitch_mean_conf) + 0.25 * float(pitch_changes['large_pitch_changes']) / max(1, int(pitch_changes['compared_frames'])) + 0.2 * effect_score), int(timeline_integrity['words']['overlap_count']) + int(timeline_integrity['syllables']['overlap_count'])
    timeline_score = clamp01(
        0.75 * min(1.0, text_overlap_count / max(1, len(words) * 0.02))
        + 0.25 * float(timeline_integrity["game_notes"]["micro_interval_count"]) / max(1, len(game))
    )
    cause_scores = {
        "text_alignment": round(100.0 * alignment_score, 1),
        "edited_timeline_overlap": round(100.0 * timeline_score, 1),
        "pitch_or_note_detection": round(100.0 * pitch_score, 1),
        "residual_reverb_echo_or_leakage": round(100.0 * effect_score, 1),
    }
    primary_cause = max(cause_scores, key=cause_scores.get)
    root_cause_analysis = {
        "primary_cause": primary_cause,
        "scores_percent": cause_scores,
        "evidence": {
            "mean_word_confidence": mean_conf,
            "acoustic_word_ratio": acoustic_ratio,
            "suspicious_word_ratio": suspicious_ratio,
            "interpolated_words": source_counts.get("interpolated", 0),
            "ctc_qwen_disagreement_ratio": disagreement_ratio,
            "mean_pitch_confidence": pitch_mean_conf,
            "text_timeline_overlap_count": text_overlap_count,
            "effect_indicators": effect_indicators,
            "audio_effect_proxies": audio_effects,
            "effect_presence_score_percent": round(100.0 * effect_presence_score, 1),
            "effect_measured_pipeline_impact_percent": round(100.0 * effect_score, 1),
        },
        "interpretation": (
            "Scores rank observable failure symptoms; effect labels are signal proxies, "
            "not proof of a specific studio plugin."
        ),
    }

    return {
        "version": 1,
        "summary": {
            "duration_sec": duration_sec,
            "words": len(words),
            "lines": len(lines),
            "source_counts": source_counts,
            "acoustic_word_ratio": acoustic_ratio,
            "mean_word_confidence": mean_conf,
            "suspicious_word_ratio": suspicious_ratio,
            "reason_counts": rejected_reasons,
        },
        "health": {
            "text_alignment": text_health,
            "pitch": round(100.0 * clamp01(pitch_mean_conf), 1),
            "note_linkage": round(100.0 * linked_notes / max(1, len(notes)), 1),
        },
        "model_evidence": {
            key: value
            for key, value in diag.items()
            if key not in {"word_sources", "word_candidates"}
        },
        "words": word_rows,
        "lines": lines,
        "suspicious_regions": suspicious_regions,
        "performance": {
            "total_stage_time_sec": total_elapsed,
            "audio_realtime_factor": (total_elapsed / duration_sec) if duration_sec > 0 else None,
            "slowest_stages": stage_perf[:10],
            "all_stages": stage_perf,
        },
        "pitch": {
            "frames": len(pitch),
            "voiced_frames": voiced_frames,
            "voiced_ratio": voiced_frames / max(1, len(pitch)),
            "mean_voiced_confidence": pitch_mean_conf,
            "vocal_activity_regions": len(regions),
            "postprocess_changes": pitch_changes,
        },
        "note_analysis": dict(note_diagnostics or {}),
        "music_analysis": dict(music_diagnostics or {}),
        "pitch_source_analysis": pitch_source_analysis,
        "vocal_effect_analysis": audio_effects,
        "timeline_integrity": timeline_integrity,
        "root_cause_analysis": root_cause_analysis,
        "notes": {
            "count": len(notes),
            "median_duration": _median([note.end - note.start for note in notes], 0.0),
            "acoustic_count": len(notes),
            "game_count": len(game),
            "syllable_split_events": syllable_split_events,
            "linked_to_text": linked_notes,
            "linked_ratio": linked_notes / max(1, len(notes)),
            "median_acoustic_duration": _median([note.end - note.start for note in notes], 0.0),
            "median_game_duration": _median([note.end - note.start for note in game], 0.0),
            "game_duration_quantiles": game_duration_quantiles,
            "game_events_with_syllable": len(game_syllable_ids),
            "unique_syllables_with_game_event": len(game_syllable_set),
            "max_game_events_per_syllable": max(events_per_syllable.values(), default=0),
            "median_game_events_per_syllable": _median(list(events_per_syllable.values()), 0.0),
        },
        "syllables": {
            "count": len(syllables),
            "mean_confidence": (
                sum(item.confidence for item in syllables) / max(1, len(syllables))
            ),
            "with_game_event": len(syllable_ids & game_syllable_set),
            "without_game_event": len(syllable_ids - game_syllable_set),
            "game_event_coverage": len(syllable_ids & game_syllable_set)
            / max(1, len(syllable_ids)),
            "non_positive_duration": sum(
                1 for item in syllables if float(item.end) <= float(item.start)
            ),
            "duration_quantiles": (
                {
                    "p05": syllable_durations[max(0, int((len(syllable_durations) - 1) * 0.05))],
                    "p50": _median(syllable_durations, 0.0),
                    "p95": syllable_durations[max(0, int((len(syllable_durations) - 1) * 0.95))],
                }
                if syllable_durations
                else {"p05": 0.0, "p50": 0.0, "p95": 0.0}
            ),
        },
    }


def _region(items: list[dict[str, Any]]) -> dict[str, Any]:
    reasons: Counter[str] = Counter(reason for item in items for reason in item["reasons"])
    return {
        "start": items[0]["final"]["start"],
        "end": items[-1]["final"]["end"],
        "words": len(items),
        "text": " ".join(item["text"] for item in items[:24]),
        "mean_confidence": sum(float(item["final"]["confidence"]) for item in items)
        / max(1, len(items)),
        "reasons": reasons,
    }
