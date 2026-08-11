from __future__ import annotations

import math
import statistics
from typing import Any

from .engines.text import tokenize
from .models import PitchFrame, Syllable, VocalNote, Word, StageReport


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


def _median(values: list[float], default: float = 0.0) -> float:
    clean = [float(v) for v in values if math.isfinite(float(v))]
    return statistics.median(clean) if clean else default


def _pitch_regions(pitch: list[PitchFrame]) -> tuple[list[tuple[float, float]], list[float]]:
    voiced = [frame for frame in pitch if frame.voiced and frame.frequency > 0.0]
    if not voiced:
        return [], []
    step = _median(
        [b.time - a.time for a, b in zip(voiced, voiced[1:], strict=False) if b.time > a.time],
        0.01,
    )
    join_gap = max(step * 4.0, 0.025)
    regions: list[tuple[float, float]] = []
    onsets: list[float] = []
    start = voiced[0].time
    end = voiced[0].time + step
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
    span = max(1e-9, end - start)
    overlap = 0.0
    for left, right in regions:
        if right <= start:
            continue
        if left >= end:
            break
        overlap += max(0.0, min(end, right) - max(start, left))
    return _clamp(overlap / span)


def _nearest_ms(value: float, points: list[float]) -> float | None:
    if not points:
        return None
    return min(abs(value - point) for point in points) * 1000.0


def _candidate_for(candidate: dict[str, Any], kind: str) -> dict[str, float] | None:
    raw = candidate.get(kind)
    if not isinstance(raw, dict):
        return None
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
) -> dict[str, Any]:
    diag = dict(alignment_diagnostics or {})
    sources = list(diag.get("word_sources") or [])
    candidates = list(diag.get("word_candidates") or [])
    regions, onsets = _pitch_regions(pitch)
    durations = [max(0.0, word.end - word.start) for word in words]
    typical_duration = max(0.02, _median(durations, 0.25))

    word_rows: list[dict[str, Any]] = []
    source_counts: dict[str, int] = {}
    rejected_reasons: dict[str, int] = {}
    for index, word in enumerate(words):
        source = str(sources[index]) if index < len(sources) else "unknown"
        candidate = candidates[index] if index < len(candidates) and isinstance(candidates[index], dict) else {}
        ctc = _candidate_for(candidate, "ctc")
        qwen = _candidate_for(candidate, "qwen")
        consensus = _candidate_for(candidate, "consensus")
        if source == "unknown":
            if consensus:
                source = "consensus"
            elif ctc and qwen:
                source = "consensus" if abs(((ctc["start"]+ctc["end"])-(qwen["start"]+qwen["end"]))/2.0) <= max(0.08, typical_duration * 0.65) else "ctc_or_qwen"
            elif ctc:
                source = "ctc"
            elif qwen:
                source = "qwen"
            elif word.confidence <= 0.02:
                source = "interpolated"
        source_counts[source] = source_counts.get(source, 0) + 1

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
        elif word.confidence < 0.25:
            reasons.append("low_confidence")
        if span < max(0.025, typical_duration * 0.10):
            reasons.append("micro_duration")
        if span > max(2.5, typical_duration * 6.0):
            reasons.append("very_long_duration")
        if overlap < 0.10:
            reasons.append("no_vocal_activity")
        elif overlap < 0.35:
            reasons.append("weak_vocal_overlap")
        if disagreement_ms is not None and disagreement_ms > max(180.0, typical_duration * 700.0):
            reasons.append("ctc_qwen_disagreement")
        if source in {"interpolated", "unknown"}:
            reasons.append("no_direct_acoustic_anchor")
        if index and word.start < words[index - 1].end - 1e-6:
            reasons.append("timeline_overlap")

        for reason in reasons:
            rejected_reasons[reason] = rejected_reasons.get(reason, 0) + 1

        word_rows.append({
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
        })

    # Map canonical lyric lines to the final word stream without changing it.
    lines: list[dict[str, Any]] = []
    cursor = 0
    lyric_lines = [line.strip() for line in str(lyrics_text or "").splitlines() if line.strip()]
    if not lyric_lines and words:
        lyric_lines = [" ".join(word.text for word in words)]
    for line_index, line in enumerate(lyric_lines):
        count = len(tokenize(line))
        row = word_rows[cursor: cursor + count]
        cursor += count
        if not row:
            continue
        sources_here: dict[str, int] = {}
        for item in row:
            kind = item["final"]["source"]
            sources_here[kind] = sources_here.get(kind, 0) + 1
        direct = sum(value for key, value in sources_here.items() if key in {"consensus", "ctc", "qwen"})
        interpolated = sum(value for key, value in sources_here.items() if key in {"interpolated", "unknown"})
        confidences = [float(item["final"]["confidence"]) for item in row]
        disagreements = [item["agreement"]["ctc_qwen_delta_ms"] for item in row if item["agreement"]["ctc_qwen_delta_ms"] is not None]
        reasons = sorted({reason for item in row for reason in item["reasons"]})
        lines.append({
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
        })

    suspicious_regions: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for item in word_rows:
        suspicious = bool(item["reasons"])
        if suspicious:
            if current and item["final"]["start"] - current[-1]["final"]["end"] > max(0.8, typical_duration * 3.0):
                suspicious_regions.append(_region(current))
                current = []
            current.append(item)
        elif current:
            suspicious_regions.append(_region(current))
            current = []
    if current:
        suspicious_regions.append(_region(current))

    acoustic_words = sum(value for key, value in source_counts.items() if key in {"consensus", "ctc", "qwen"})
    mean_conf = sum(word.confidence for word in words) / max(1, len(words))
    acoustic_ratio = acoustic_words / max(1, len(words))
    suspicious_ratio = sum(1 for row in word_rows if row["reasons"]) / max(1, len(word_rows))
    text_health = round(100.0 * _clamp(0.48 * acoustic_ratio + 0.42 * mean_conf + 0.10 * (1.0 - suspicious_ratio)), 1)

    total_elapsed = sum(max(0.0, float(report.elapsed_sec)) for report in reports)
    stage_perf = [
        {
            "stage": report.stage,
            "elapsed_sec": float(report.elapsed_sec),
            "cached": bool(report.cached),
            "engine": report.engine,
        }
        for report in reports
    ]
    stage_perf.sort(key=lambda item: item["elapsed_sec"], reverse=True)

    voiced_frames = sum(1 for frame in pitch if frame.voiced and frame.frequency > 0.0)
    pitch_mean_conf = (
        sum(frame.confidence for frame in pitch if frame.voiced and frame.frequency > 0.0) / max(1, voiced_frames)
    )
    linked_notes = sum(1 for note in notes if note.word_index is not None or note.syllable_index is not None)

    pitch_changes = {"compared_frames": 0, "voicing_changes": 0, "large_pitch_changes": 0, "mean_abs_semitone_delta": 0.0}
    if raw_pitch:
        raw_by_time = {round(frame.time, 6): frame for frame in raw_pitch}
        deltas: list[float] = []
        voicing_changes = 0
        large_changes = 0
        for frame in pitch:
            original = raw_by_time.get(round(frame.time, 6))
            if original is None:
                continue
            pitch_changes["compared_frames"] += 1
            if bool(original.voiced) != bool(frame.voiced):
                voicing_changes += 1
            if original.voiced and frame.voiced and original.frequency > 0 and frame.frequency > 0:
                semitones = abs(12.0 * math.log2(frame.frequency / original.frequency))
                deltas.append(semitones)
                if semitones >= 6.0:
                    large_changes += 1
        pitch_changes["voicing_changes"] = voicing_changes
        pitch_changes["large_pitch_changes"] = large_changes
        pitch_changes["mean_abs_semitone_delta"] = sum(deltas) / max(1, len(deltas))

    game = list(game_notes or notes)
    syllable_split_events = max(0, len(game) - len(notes))
    syllable_ids = {int(item.index) for item in syllables}
    game_syllable_ids = [
        int(note.syllable_index)
        for note in game
        if note.syllable_index is not None
    ]
    game_syllable_set = set(game_syllable_ids)
    events_per_syllable: dict[int, int] = {}
    for syllable_id in game_syllable_ids:
        events_per_syllable[syllable_id] = events_per_syllable.get(syllable_id, 0) + 1
    game_durations = [max(0.0, float(note.end) - float(note.start)) for note in game]
    sorted_game_durations = sorted(value for value in game_durations if value > 0.0)
    if sorted_game_durations:
        def _quantile(frac: float) -> float:
            pos = (len(sorted_game_durations) - 1) * frac
            lo = int(math.floor(pos)); hi = int(math.ceil(pos))
            if lo == hi:
                return sorted_game_durations[lo]
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
            "pitch": round(100.0 * _clamp(pitch_mean_conf), 1),
            "note_linkage": round(100.0 * linked_notes / max(1, len(notes)), 1),
        },
        "model_evidence": {
            key: value for key, value in diag.items()
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
        "pitch_source_analysis": dict(pitch_source_diagnostics or {}),
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
            "game_event_coverage": len(syllable_ids & game_syllable_set) / max(1, len(syllable_ids)),
            "non_positive_duration": sum(1 for item in syllables if float(item.end) <= float(item.start)),
            "duration_quantiles": (
                {
                    "p05": sorted([max(0.0, float(item.end)-float(item.start)) for item in syllables])[max(0, int((len(syllables)-1)*0.05))],
                    "p50": _median([max(0.0, float(item.end)-float(item.start)) for item in syllables], 0.0),
                    "p95": sorted([max(0.0, float(item.end)-float(item.start)) for item in syllables])[max(0, int((len(syllables)-1)*0.95))],
                }
                if syllables else {"p05": 0.0, "p50": 0.0, "p95": 0.0}
            ),
        },
    }


def _region(items: list[dict[str, Any]]) -> dict[str, Any]:
    reasons: dict[str, int] = {}
    for item in items:
        for reason in item["reasons"]:
            reasons[reason] = reasons.get(reason, 0) + 1
    return {
        "start": items[0]["final"]["start"],
        "end": items[-1]["final"]["end"],
        "words": len(items),
        "text": " ".join(item["text"] for item in items[:24]),
        "mean_confidence": sum(float(item["final"]["confidence"]) for item in items) / max(1, len(items)),
        "reasons": reasons,
    }
