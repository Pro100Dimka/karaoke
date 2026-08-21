from __future__ import annotations

import math
import os
import re
import tempfile
from bisect import bisect_right
from collections import Counter
from collections.abc import Iterable
from dataclasses import replace
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from ..audio import duration, load_mono
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..model_registry import get_model
from ..models import Word
from ..profiler import profile_operation
from ..syllables import VOWELS
from ..utils.numeric import clamp, clamp01
from .base import Aligner, Transcriber
from .ctc_alignment import CTC_ALIGNMENT_VERSION, CTCWordAligner
from .device import fallback_torch_device, select_torch_device

_TOKEN = re.compile(r"\w+(?:[’'-]\w+)*", re.UNICODE)
_LANGUAGE_NAMES = {
    "ru": "Russian",
    "uk": "Ukrainian",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "yue": "Cantonese",
}


def tokenize(text: str) -> list[str]: return _TOKEN.findall(text)


def _normalize_match_token(value: object) -> str: return re.sub('[^\\w]+', '', str(value).casefold(), flags=re.UNICODE)


def _matched_word_indices(words, tokens: list[str]) -> list[tuple[int, Word]]:
    matcher = SequenceMatcher(
        None,
        [_normalize_match_token(word.text) for word in words],
        [_normalize_match_token(token) for token in tokens],
        autojunk=False,
    )
    return [(block.b + delta, words[block.a + delta]) for block in matcher.get_matching_blocks() for delta in range(block.size)]


def _language_name(language: str | None) -> str | None:
    if not language: return None
    value = str(language).strip()
    return None if not value else _LANGUAGE_NAMES.get(value.lower(), value)


# Qwen3-ASR's transcribe() validates `language` against this fixed allowlist and
# raises ValueError for anything outside it -- Ukrainian is one such gap, even
# though the separate Forced Aligner (resolve_alignment_language below) does
# target Ukrainian explicitly. None asks Qwen to auto-detect instead, which it
# explicitly supports, so an unsupported name is narrowed to None rather than
# crashing the whole transcription job.
_QWEN_TRANSCRIBE_LANGUAGES = frozenset(
    {
        "Chinese", "English", "Cantonese", "Arabic", "German", "French", "Spanish",
        "Portuguese", "Indonesian", "Italian", "Korean", "Russian", "Thai",
        "Vietnamese", "Japanese", "Turkish", "Hindi", "Malay", "Dutch", "Swedish",
        "Danish", "Finnish", "Polish", "Czech", "Filipino", "Persian", "Greek",
        "Romanian", "Hungarian", "Macedonian",
    }
)


def _qwen_transcribe_language(language: str | None) -> str | None:
    name = _language_name(language)
    return name if name in _QWEN_TRANSCRIBE_LANGUAGES else None


def resolve_alignment_language(text: str, language: str | None = None) -> str:
    explicit = _language_name(language)
    if explicit: return explicit

    sample = str(text or "")
    lowered = sample.lower()
    if any(ch in lowered for ch in "іїєґ"): return "Ukrainian"
    if re.search(r"[а-яё]", lowered): return "Russian"
    if re.search(r"[a-z]", lowered): return "English"
    if re.search(r"[\u4e00-\u9fff]", sample): return "Chinese"
    if re.search(r"[\u3040-\u30ff]", sample): return "Japanese"
    return 'Korean' if re.search('[\\uac00-\\ud7af]', sample) else 'Russian'

def _first(value, names, default=None):
    for name in names:
        if isinstance(value, dict) and name in value: return value[name]
        if not isinstance(value, dict) and hasattr(value, name): return getattr(value, name)
    return default


def _unwrap_single_result(result):
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], str): return {"text": result[0], "time_stamps": result[1]}
    return result[0] if isinstance(result, (list, tuple)) and result else result

def _unwrap_items(result):
    for name in ("words", "time_stamps", "timestamps", "items", "segments"):
        value = _first(result, (name,))
        if value is not None:
            if (
                isinstance(value, (list, tuple))
                and len(value) == 1
                and isinstance(value[0], (list, tuple))
            ):
                return value[0]
            return value
    return result if isinstance(result, Iterable) and (not isinstance(result, (str, bytes, dict))) else []


def _words_from_items(items) -> list[Word]:
    words: list[Word] = []
    for index, item in enumerate(items or []):
        token = _first(item, ("text", "word", "token"), "")
        start = _first(item, ("start", "start_time", "begin"))
        end = _first(item, ("end", "end_time", "finish"))
        confidence = _first(item, ("confidence", "score", "probability"), 1.0)
        if isinstance(item, (list, tuple)) and len(item) >= 3:
            if isinstance(item[0], str):
                token, start, end = item[0], item[1], item[2]
            elif isinstance(item[2], str): start, end, token = item[0], item[1], item[2]
            if len(item) >= 4: confidence = item[3]
        token = str(token or "").strip()
        if token and start is not None and end is not None:
            words.append(
                Word(
                    float(start),
                    float(end),
                    token,
                    clamp01(float(confidence)),
                    index,
                )
            )
    return words


ASR_PIPELINE_VERSION = "singing-batched-script-consensus-v15-newline-phrase-join"
LONG_TEXT_ALIGNMENT_VERSION = "v62-reject-collapsed-acoustic-anchors"
SEGMENTED_ALIGNMENT_VERSION = "v2-ctc-fallback-tier"
FALLBACK_WORD_CONFIDENCE = 0.012


def _vowel_weighted_length(cleaned_token: str) -> float: return max(1.0, float(len(cleaned_token) + 2 * sum(char in VOWELS for char in cleaned_token)))


def _normalize_singing_audio(y: np.ndarray) -> np.ndarray:
    audio = np.asarray(y, dtype=np.float32).copy()
    if audio.size == 0: return audio
    audio -= float(np.mean(audio))
    peak = float(np.max(np.abs(audio)))
    if peak <= 1e-7: return audio
    rms = float(np.sqrt(np.mean(audio * audio) + 1e-12))
    gain = min(8.0, max(1.0, 0.09 / max(rms, 1e-6)))
    audio *= gain
    peak = float(np.max(np.abs(audio)))
    if peak > 0.94: audio *= 0.94 / peak
    return np.ascontiguousarray(audio, dtype=np.float32)


def _singing_chunk_windows(
    y: np.ndarray,
    sr: int,
    activity_hints: list[tuple[float, float]] | None = None,
) -> list[tuple[np.ndarray, float, float]]:
    if y.size == 0: return []
    total_sec = len(y) / sr
    if total_sec <= 32.0: return [(_normalize_singing_audio(y), 0.0, total_sec)]

    hop = max(1, int(sr * 0.025))
    frame, count = max(hop, int(sr * 0.05)), max(1, (len(y) + hop - 1) // hop)
    rms = np.empty(count, dtype=np.float32)
    for index in range(count):
        start = index * hop
        chunk = y[start : min(len(y), start + frame)]
        rms[index] = float(np.sqrt(np.mean(chunk * chunk) + 1e-12)) if chunk.size else 0.0

    target, search, minimum, maximum, starts, cursor_sec = 16.0, 3.5, 7.0, 22.0, [0], 0.0
    while total_sec - cursor_sec > maximum:
        ideal = cursor_sec + target
        lo = max(cursor_sec + minimum, ideal - search)
        hi = min(cursor_sec + maximum, ideal + search)
        lo_i = max(0, int(lo * sr / hop))
        hi_i = min(len(rms) - 1, int(hi * sr / hop))
        region = rms[lo_i : hi_i + 1]
        floor = float(np.min(region))
        spread = max(1e-8, float(np.max(region) - floor))
        scores = (region - floor) / spread
        if activity_hints:
            ordered_hints = sorted(activity_hints)
            hint_starts = [item[0] for item in ordered_hints]
            for local_index in range(len(scores)):
                timestamp = (lo_i + local_index) * hop / sr
                pos = bisect_right(hint_starts, timestamp + 0.05) - 1
                voiced = pos >= 0 and ordered_hints[pos][1] + 0.05 >= timestamp
                if voiced: scores[local_index] += 1.20
        local = int(np.argmin(scores))
        cut_sec = (lo_i + local) * hop / sr
        cut_sample = max(starts[-1] + int(minimum * sr), min(len(y), int(cut_sec * sr)))
        starts.append(cut_sample)
        cursor_sec = cut_sample / sr

    starts.append(len(y))
    chunks: list[tuple[np.ndarray, float, float]] = []
    overlap = int(0.42 * sr)
    for chunk_index, (left, right) in enumerate(zip(starts, starts[1:], strict=False)):
        padded_left = left if chunk_index == 0 else max(0, left - overlap)
        padded_right = right if chunk_index == len(starts) - 2 else min(len(y), right + overlap)
        segment = y[padded_left:padded_right]
        if segment.size >= int(0.4 * sr):
            chunks.append(
                (
                    _normalize_singing_audio(segment),
                    padded_left / sr,
                    padded_right / sr,
                )
            )
    return chunks or [(_normalize_singing_audio(y), 0.0, total_sec)]


def _normalized_match_tokens(text: str) -> list[str]: return [_normalize_match_token(token) for token in tokenize(text)]


def _asr_line_anchor_windows(
    groups: list[str],
    segments: list[tuple[float, float, str]] | None,
) -> dict[int, tuple[float, float, float]]:
    if not groups or not segments: return {}
    lyric_tokens: list[str] = []
    line_ranges: list[tuple[int, int]] = []
    for group in groups:
        start = len(lyric_tokens)
        lyric_tokens.extend(_normalized_match_tokens(group))
        line_ranges.append((start, len(lyric_tokens)))

    asr_tokens: list[str] = []
    asr_times: list[tuple[float, float]] = []
    for raw_start, raw_end, text in sorted(segments, key=lambda item: (item[0], item[1])):
        tokens = _normalized_match_tokens(text)
        if not tokens: continue
        start = max(0.0, float(raw_start))
        end = max(start + 0.05, float(raw_end))
        span = end - start
        weights = [max(1, len(token)) for token in tokens]
        total = max(1, sum(weights))
        cursor = 0
        for token, weight in zip(tokens, weights, strict=False):
            token_start = start + span * cursor / total
            cursor += weight
            token_end = start + span * cursor / total
            asr_tokens.append(token)
            asr_times.append((token_start, token_end))
    if not lyric_tokens or not asr_tokens: return {}

    matcher = SequenceMatcher(None, lyric_tokens, asr_tokens, autojunk=False)
    token_map: dict[int, tuple[float, float]] = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            li = block.a + offset
            ai = block.b + offset
            if 0 <= ai < len(asr_times): token_map[li] = asr_times[ai]

    result: dict[int, tuple[float, float, float]] = {}
    for line_index, (left, right) in enumerate(line_ranges):
        matched = [token_map[index] for index in range(left, right) if index in token_map]
        token_count = max(1, right - left)
        score = len(matched) / token_count
        if not matched: continue
        start = min(item[0] for item in matched)
        end = max(item[1] for item in matched)

        line_tokens = tokenize(groups[line_index])
        expected_span = _expected_sung_phrase_duration(line_tokens)
        matched_span = max(0.0, end - start)
        missing_span = max(0.0, expected_span - matched_span)
        profile = _line_timing_profile(line_tokens)
        margin = max(profile["candidate_slack"], missing_span / 2.0)
        result[line_index] = (max(0.0, start - margin), end + margin, score)
    return result


def _complete_line_anchor_windows(
    groups: list[str],
    raw_windows: dict[int, tuple[float, float, float]] | None,
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
) -> tuple[dict[int, tuple[float, float, float]], dict[int, str]]:
    if not groups or duration_sec <= 0.0: return {}, {}

    baseline_words = _lossless_canonical_alignment(groups, source, sample_rate, duration_sec, None)
    if not baseline_words: return dict(raw_windows or {}), {int(idx): "asr" for idx in (raw_windows or {})}

    baseline: dict[int, tuple[float, float, float]] = {}
    cursor = 0
    for line_index, group in enumerate(groups):
        count = len(tokenize(group))
        row = baseline_words[cursor : cursor + count]
        cursor += count
        if not row: continue
        baseline[line_index] = (
            max(0.0, float(row[0].start)),
            min(duration_sec, float(row[-1].end)),
            0.75,
        )

    completed: dict[int, tuple[float, float, float]] = {}
    provenance: dict[int, str] = {}
    raw, normalized_rows = dict(raw_windows or {}), [tuple(_normalized_match_tokens(group)) for group in groups]
    ambiguous_lines: set[int] = set()
    for left_index, left_tokens in enumerate(normalized_rows):
        if not left_tokens: continue
        for right_index, right_tokens in enumerate(normalized_rows):
            if left_index == right_index or not right_tokens: continue
            if left_tokens == right_tokens:
                ambiguous_lines.add(left_index)
                break
            if len(left_tokens) <= len(right_tokens):
                width = len(left_tokens)
                if any(
                    tuple(right_tokens[pos : pos + width]) == left_tokens
                    for pos in range(len(right_tokens) - width + 1)
                ):
                    ambiguous_lines.add(left_index)
                    break

    for line_index, group in enumerate(groups):
        base = baseline.get(line_index)
        observed = raw.get(line_index)
        if base is None:
            if observed is not None:
                completed[line_index] = observed
                provenance[line_index] = "asr"
            continue
        b0, b1, bscore = base
        if observed is None:
            completed[line_index] = base
            provenance[line_index] = "vocal_baseline"
            continue

        a0, a1, ascore = observed
        profile = _line_timing_profile(tokenize(group))
        baseline_mid = (b0 + b1) / 2.0
        if line_index not in ambiguous_lines:
            completed[line_index] = (
                max(0.0, float(a0)),
                min(duration_sec, float(a1)),
                max(bscore, clamp01(float(ascore))),
            )
            provenance[line_index] = "asr_unique"
            continue
        asr_mid = (float(a0) + float(a1)) / 2.0
        baseline_span = max(1e-9, b1 - b0)
        occurrence_tolerance = max(
            baseline_span + float(profile["expected"]),
            float(profile["minimum_window"]),
        )
        if abs(asr_mid - baseline_mid) > occurrence_tolerance:
            completed[line_index] = base
            provenance[line_index] = "vocal_baseline_rejected_asr_repeat"
            continue

        reliability = clamp01(float(ascore))
        centre = baseline_mid * (1.0 - reliability) + asr_mid * reliability
        asr_span = max(1e-9, float(a1) - float(a0))
        span = max(
            baseline_span,
            min(asr_span, baseline_span + float(profile["expected"])),
        )
        start = max(0.0, centre - span / 2.0)
        end = min(duration_sec, centre + span / 2.0)
        if end <= start:
            completed[line_index] = base
            provenance[line_index] = "vocal_baseline"
        else:
            completed[line_index] = (start, end, max(bscore, reliability))
            provenance[line_index] = "asr_vocal_blend"

    for line_index in range(len(groups)):
        current = completed.get(line_index)
        if current is None: continue
        start, end, score = current
        if line_index > 0 and (prev := completed.get(line_index - 1)) is not None:
            prev_mid = (prev[0] + prev[1]) / 2.0
            start = max(start, prev_mid)
        if line_index + 1 < len(groups) and (nxt := completed.get(line_index + 1)) is not None:
            next_mid = (nxt[0] + nxt[1]) / 2.0
            end = min(end, next_mid)
        if end <= start:
            completed[line_index] = baseline.get(line_index, current)
            provenance[line_index] = "vocal_baseline_monotonic_repair"
        else:
            completed[line_index] = (start, end, score)

    return completed, provenance


def _canonical_words_match(words: list[Word], tokens: list[str]) -> bool: return False if len(words) != len(tokens) else all((_normalize_match_token(word.text) == _normalize_match_token(token) for word, token in zip(words, tokens, strict=True)))


def _activity_bounds(source: np.ndarray, sample_rate: int, duration_sec: float, minimum_span: float = 0.08) -> tuple[float, float]:
    active = _activity_quantile_times(source, sample_rate)
    start = max(0.0, float(active[0])) if active else 0.0
    end = min(duration_sec, float(active[-1])) if active else duration_sec
    return (0.0, duration_sec) if end <= start + minimum_span else (start, end)


def _extend_words(output: list[Word], words, texts=None, end_limit: float | None = None) -> None:
    offset = len(output)
    output.extend(
        Word(
            float(word.start),
            min(end_limit, float(word.end)) if end_limit is not None else float(word.end),
            texts[index] if texts is not None else word.text,
            float(word.confidence),
            offset + index,
        )
        for index, word in enumerate(words)
    )


def _empty_alignment_stats(**extra) -> dict[str, int]: return {'ctc': 0, 'qwen': 0, 'interpolated': 0, **extra}


def _alignment_failure(debug_out, reason: str, stage: str, rejection_reasons) -> tuple[list, dict[str, int]]:
    if debug_out is not None:
        debug_out.clear()
        debug_out.update(
            failure_reason=reason,
            failure_stage=stage,
            rejected_reasons=dict(rejection_reasons),
        )
    return [], _empty_alignment_stats()


def _lossless_canonical_alignment(
    groups: list[str],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
) -> list[Word]:
    line_tokens = [tokenize(group) for group in groups]
    all_tokens = [token for tokens in line_tokens for token in tokens]
    if not all_tokens or duration_sec <= 0.04: return []

    active_start, active_end = _activity_bounds(source, sample_rate, duration_sec)

    line_minimum = [max(0.08, _minimum_sung_phrase_duration(tokens)) for tokens in line_tokens]
    line_expected, available, minimum_total = [max(line_minimum[index], _expected_sung_phrase_duration(tokens)) for index, tokens in enumerate(line_tokens)], max(0.08, active_end - active_start), sum(line_minimum)

    if minimum_total > available + 1e-6:
        active_start = 0.0
        active_end = duration_sec
        available = max(0.08, duration_sec)

    expected_total = sum(line_expected)
    if expected_total <= available:
        durations = list(line_expected)
    else:
        reducible = sum(
            max(0.0, line_expected[i] - line_minimum[i]) for i in range(len(line_tokens))
        )
        shortage = expected_total - available
        ratio = min(1.0, shortage / max(1e-9, reducible))
        durations = [
            line_expected[i] - (line_expected[i] - line_minimum[i]) * ratio
            for i in range(len(line_tokens))
        ]

    used = sum(durations)
    remaining, gap_count = max(0.0, available - used), max(1, len(line_tokens) - 1)
    base_gap = min(1.15, remaining / gap_count) if len(line_tokens) > 1 else 0.0
    remaining -= base_gap * (len(line_tokens) - 1)

    extra_gaps = [0.0] * max(0, len(line_tokens) - 1)
    if remaining > 1e-6 and extra_gaps:
        regions = _vocal_activity_regions(source, sample_rate, join_gap=0.55)
        pauses = []
        for left, right in zip(regions, regions[1:], strict=False):
            gap = max(0.0, right[0] - left[1])
            if gap >= 0.70: pauses.append((gap, (left[1] + right[0]) / 2.0))
        if pauses:
            nominal_starts = []
            acc = active_start
            for duration_value in durations:
                nominal_starts.append(acc)
                acc += duration_value + base_gap
            candidate_boundaries: dict[int, float] = {}
            for gap, center in pauses:
                nearest = min(
                    range(len(extra_gaps)),
                    key=lambda idx: abs(
                        (nominal_starts[idx] + durations[idx] + base_gap / 2.0) - center
                    ),
                )
                candidate_boundaries[nearest] = max(
                    candidate_boundaries.get(nearest, 0.0),
                    gap,
                )
            total_weight = sum(candidate_boundaries.values())
            if total_weight > 0:
                for idx, weight in candidate_boundaries.items(): extra_gaps[idx] += remaining * weight / total_weight
                remaining = 0.0

        if remaining > 1e-6:
            share = remaining / len(extra_gaps)
            extra_gaps = [value + share for value in extra_gaps]

    line_windows: list[tuple[float, float]] = []
    cursor = active_start
    for index, duration_value in enumerate(durations):
        start = cursor
        end = min(active_end, start + duration_value)
        if end <= start + 0.039:
            return [
                Word(word.start, word.end, word.text, 0.005, word.index)
                for word in _proportional_words(all_tokens, duration_sec)
            ]
        line_windows.append((start, end))
        if index < len(line_tokens) - 1: cursor = end + base_gap + extra_gaps[index]

    output: list[Word] = []
    for line_index, tokens in enumerate(line_tokens):
        if not tokens: continue
        start, end = line_windows[line_index]
        token_weights = [_vowel_weighted_length(token) for token in tokens]
        total_weight = max(1, sum(token_weights))
        cursor_weight = 0.0
        for token, weight in zip(tokens, token_weights, strict=True):
            word_start = start + (end - start) * cursor_weight / total_weight
            cursor_weight += weight
            word_end = start + (end - start) * cursor_weight / total_weight
            output.append(Word(word_start, word_end, token, 0.008, len(output)))
    return output



def _line_offsets(rows: list[list[str]]) -> list[int]:
    offsets, cursor = [], 0
    for row in rows:
        offsets.append(cursor)
        cursor += len(row)
    return offsets


def _seed_alignment_result(tokens, selected):
    result: list[Word | None] = [None] * len(tokens)
    sources: list[str | None] = [None] * len(tokens)
    for index, (word, kind, _priority) in selected.items():
        result[index] = Word(word.start, word.end, tokens[index], word.confidence, index)
        sources[index] = kind
    return result, sources


def _missing_runs(result):
    position = 0
    while position < len(result):
        if result[position] is not None:
            position += 1
            continue
        start = position
        while position < len(result) and result[position] is None:
            position += 1
        yield start, position


def _weighted_gap_durations(tokens, start, end, minima, left_time, right_time):
    extra = max(0.0, (right_time - left_time) - sum(minima))
    weights = [
        _vowel_weighted_length(_normalize_match_token(tokens[index]))
        for index in range(start, end)
    ]
    total = max(1.0, sum(weights))
    return [minimum + extra * weight / total for minimum, weight in zip(minima, weights, strict=True)]




def _alignment_source_stats(
    kinds,
    *,
    dropped: int | None = None,
    consensus_counts_for_qwen: bool = False,
) -> dict[str, int]:
    consensus = sum(kind == "consensus" for kind in kinds)
    stats = {
        "ctc": sum(kind == "ctc" for kind in kinds) + consensus,
        "qwen": sum(kind == "qwen" for kind in kinds)
        + (consensus if consensus_counts_for_qwen else 0),
        "interpolated": sum(kind == "interpolated" for kind in kinds),
    }
    if consensus:
        stats["consensus"] = consensus
    reacquired = sum(kind == "reacquired" for kind in kinds)
    if reacquired:
        stats["reacquired"] = reacquired
    if dropped is not None:
        stats["dropped"] = dropped
    return stats

def _fill_weighted_gap(
    result,
    sources,
    tokens,
    start: int,
    end: int,
    minima,
    left_time: float,
    right_time: float,
    *,
    duration_limit: float | None = None,
    minimum_span: float = 0.0,
) -> None:
    cursor = left_time
    durations = _weighted_gap_durations(tokens, start, end, minima, left_time, right_time)
    for index, gap_duration in zip(range(start, end), durations, strict=True):
        word_end = min(right_time, cursor + gap_duration)
        bounded_end = min(duration_limit, word_end) if duration_limit is not None else word_end
        if minimum_span:
            bounded_end = max(cursor + minimum_span, bounded_end)
        result[index] = Word(
            cursor,
            bounded_end,
            tokens[index],
            FALLBACK_WORD_CONFIDENCE,
            index,
        )
        sources[index] = "interpolated"
        cursor = word_end

def _line_candidate_span_valid(words, minimum: float, maximum: float) -> bool:
    if any(
        right.start < left.end - 0.015
        for left, right in zip(words, words[1:], strict=False)
    ):
        return False
    span = words[-1].end - words[0].start
    return minimum * 0.65 <= span <= maximum * 1.35

def _atomic_line_acoustic_alignment(
    groups: list[str],
    ctc_lines,
    qwen_words: list[Word],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
) -> tuple[list[Word], dict[str, int]]:
    line_tokens = [tokenize(group) for group in groups]
    canonical, line_count = [token for row in line_tokens for token in row], len(line_tokens)
    if not canonical or line_count == 0 or duration_sec <= 0.04:
        return [], {
            "ctc": 0,
            "qwen": 0,
            "interpolated": 0,
            "lines": line_count,
            "line_fallbacks": line_count,
            "dropped_word_anchors": 0,
            "atomic_ctc_lines": 0,
        }

    def physical_word_minimum(token: str) -> float:
        chars = max(1, len(_normalize_match_token(token)))
        return max(0.075, min(0.42, 0.05 + 0.03 * chars))

    line_min = [
        max(
            0.12,
            _minimum_sung_phrase_duration(tokens),
            sum(physical_word_minimum(token) for token in tokens),
        )
        if tokens
        else 0.08
        for tokens in line_tokens
    ]
    line_expected = [
        max(line_min[i], _expected_sung_phrase_duration(tokens))
        for i, tokens in enumerate(line_tokens)
    ]
    line_max, typical_line_min = [min(duration_sec, max(line_expected[i] * 2.25 + line_min[i] * 0.35, line_min[i] * 2.8, line_expected[i])) for i in range(line_count)], float(np.median([value for value in line_min if value > 0.0])) if line_min else 0.0
    line_gap_floor = max(1.0 / max(1, sample_rate), typical_line_min / max(24.0, line_count * 2.0))

    candidates: dict[int, list[tuple[list[Word], str, float]]] = {}

    raw_ctc_words = 0
    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= line_count: continue
        expected = line_tokens[line_index]
        actual = list(getattr(result, "words", ()) or ())
        raw_ctc_words += len(actual)
        if not expected or len(actual) != len(expected): continue
        if [_normalize_match_token(word.text) for word in actual] != [_normalize_match_token(token) for token in expected]: continue

        words: list[Word] = []
        valid = True
        for local_index, (word, token) in enumerate(zip(actual, expected, strict=True)):
            start = float(word.start)
            end = float(word.end)
            if (
                not math.isfinite(start)
                or not math.isfinite(end)
                or start < -0.02
                or end > duration_sec + 0.10
                or end <= start + 0.009
            ):
                valid = False
                break
            words.append(
                Word(
                    max(0.0, start),
                    min(duration_sec, end),
                    token,
                    clamp01(float(word.confidence)),
                    local_index,
                )
            )
        if not valid or not words: continue
        if not _line_candidate_span_valid(words, line_min[line_index], line_max[line_index]):
            continue
        confidence = max(
            float(getattr(result, "confidence", 0.0) or 0.0),
            sum(word.confidence for word in words) / len(words),
        )
        priority = 10000.0 + 5000.0 * clamp01(confidence)
        candidates.setdefault(line_index, []).append((words, "ctc", priority))

    qwen = [word for word in (qwen_words or []) if _normalize_match_token(word.text)]
    if qwen:
        global_to_line = [(line_index, local_index) for line_index, tokens in enumerate(line_tokens) for local_index in range(len(tokens))]
        per_line: dict[int, dict[int, Word]] = {}
        for canonical_index, word in _matched_word_indices(qwen, canonical):
            if canonical_index < len(global_to_line):
                line_index, local_index = global_to_line[canonical_index]
                per_line.setdefault(line_index, {})[local_index] = word

        for li, mapping in per_line.items():
            expected = line_tokens[li]
            if not expected or len(mapping) != len(expected): continue
            words = [
                replace(
                    mapping[local],
                    start=max(0.0, float(mapping[local].start)),
                    end=min(duration_sec, float(mapping[local].end)),
                    text=expected[local], confidence=clamp01(float(mapping[local].confidence)), index=local,
                )
                for local in range(len(expected))
            ]
            if not _line_candidate_span_valid(words, line_min[li], line_max[li]):
                continue
            mean_conf = sum(word.confidence for word in words) / len(words)
            candidates.setdefault(li, []).append((words, "qwen", 1000.0 + 1000.0 * mean_conf))

    best: list[tuple[int, list[Word], str, float]] = []
    for li in sorted(candidates):
        words, kind, priority = max(candidates[li], key=lambda item: item[2])
        best.append((li, words, kind, priority))

    def skipped_minimum(left_line: int, right_line: int) -> float: return line_gap_floor if right_line <= left_line + 1 else sum(line_min[idx] for idx in range(left_line + 1, right_line)) + line_gap_floor * (right_line - left_line)

    selected: list[tuple[int, list[Word], str, float]] = []
    if best:
        scores: list[float] = []
        prev: list[int] = []
        for pos, (li, words, _kind, priority) in enumerate(best):
            best_score = priority
            best_prev = -1
            for ppos in range(pos):
                pli, pwords, pkind, ppriority = best[ppos]
                required = skipped_minimum(pli, li)
                if words[0].start < pwords[-1].end + required - 1e-6: continue
                score = scores[ppos] + priority
                if score > best_score:
                    best_score = score
                    best_prev = ppos
            scores.append(best_score)
            prev.append(best_prev)

        end_pos = max(range(len(best)), key=lambda pos: scores[pos])
        selected_positions = []
        while end_pos >= 0:
            selected_positions.append(end_pos)
            end_pos = prev[end_pos]
        selected_positions.reverse()
        selected = [best[pos] for pos in selected_positions]

    selected_by_line, active = {li: (words, kind, priority) for li, words, kind, priority in selected}, _activity_quantile_times(source, sample_rate)
    active_start, active_end = max(0.0, float(active[0])) if active else 0.0, min(duration_sec, float(active[-1])) if active else duration_sec
    if active_end <= active_start + 0.08: active_start, active_end = 0.0, duration_sec

    def edge_compatible(items):
        first_li, first_words, _kind, _priority = items[0]
        prefix_need = sum(line_min[:first_li]) + line_gap_floor * first_li
        if first_words[0].start < active_start + prefix_need - 1e-6: return False
        last_li, last_words, _kind, _priority = items[-1]
        suffix_need = sum(line_min[last_li + 1 :]) + line_gap_floor * (line_count - last_li - 1)
        return active_end >= last_words[-1].end + suffix_need - 1e-6

    while selected and not edge_compatible(selected):
        first_li, first_words, first_kind, first_priority = selected[0]
        last_li, last_words, last_kind, last_priority = selected[-1]
        prefix_need = sum(line_min[:first_li]) + line_gap_floor * first_li
        suffix_need = sum(line_min[last_li + 1 :]) + line_gap_floor * (line_count - last_li - 1)
        first_bad = first_words[0].start < active_start + prefix_need - 1e-6
        last_bad = active_end < last_words[-1].end + suffix_need - 1e-6
        if first_bad and last_bad:
            if first_priority <= last_priority:
                selected.pop(0)
            else:
                selected.pop()
        elif first_bad:
            selected.pop(0)
        else:
            selected.pop()
    selected_by_line = {li: (words, kind, priority) for li, words, kind, priority in selected}

    def synthesize_range(
        begin_line: int,
        end_line: int,
        left_time: float,
        right_time: float,
    ) -> list[list[Word]] | None:
        indices = list(range(begin_line, end_line))
        total_min, gap_count, available = sum(line_min[i] for i in indices), len(indices) + 1, right_time - left_time
        required = total_min + line_gap_floor * gap_count
        if available < required - 1e-6: return None

        desired = [line_expected[i] for i in indices]
        desired_total, max_duration_budget = sum(desired), max(total_min, available - line_gap_floor * gap_count)
        if desired_total <= max_duration_budget:
            durations = desired
        else:
            reducible = sum(
                max(0.0, desired[k] - line_min[indices[k]]) for k in range(len(indices))
            )
            shortage = desired_total - max_duration_budget
            ratio = min(1.0, shortage / max(1e-9, reducible))
            durations = [
                desired[k] - (desired[k] - line_min[indices[k]]) * ratio
                for k in range(len(indices))
            ]

        used = sum(durations)
        gap = max(line_gap_floor, (available - used) / gap_count)
        cursor = left_time + gap
        result: list[list[Word]] = []
        for pos, li in enumerate(indices):
            duration_value = durations[pos]
            line_end = min(right_time, cursor + duration_value)
            tokens = line_tokens[li]

            left_sample = max(0, int(cursor * sample_rate))
            right_sample = min(len(source), max(left_sample + 1, int(line_end * sample_rate)))
            local_audio = source[left_sample:right_sample]
            activity_words = _activity_fallback_words(tokens, local_audio, sample_rate)
            line_words: list[Word] = []
            if (
                len(activity_words) == len(tokens)
                and activity_words
                and activity_words[-1].end <= (line_end - cursor) + 0.05
            ):
                line_words = _offset_words(activity_words, tokens, cursor, line_end, 0.020)
            else:
                local = _proportional_words(tokens, max(0.04, line_end - cursor))
                line_words = _offset_words(local, tokens, cursor, line_end, 0.008)
            result.append(line_words)
            cursor = line_end + gap
        return result

    line_results: list[list[Word] | None] = [None] * line_count

    for li, (words, _kind, _priority) in selected_by_line.items():
        line_results[li] = [
            Word(word.start, word.end, line_tokens[li][idx], word.confidence, idx)
            for idx, word in enumerate(words)
        ]

    boundaries = [
        (-1, active_start, active_start),
        *((li, words[0].start, words[-1].end) for li, words, _kind, _priority in selected),
        (line_count, active_end, active_end),
    ]

    for bidx in range(len(boundaries) - 1):
        left_li, left_start, left_end = boundaries[bidx]
        right_li, right_start, right_end = boundaries[bidx + 1]
        begin = left_li + 1
        end = right_li
        if begin >= end: continue
        generated = synthesize_range(begin, end, left_end, right_start)
        if generated is None:
            baseline = _lossless_canonical_alignment(
                groups, source, sample_rate, duration_sec, anchor_windows
            )
            if not _canonical_words_match(baseline, canonical):
                return [], {
                    "ctc": 0,
                    "qwen": 0,
                    "interpolated": 0,
                    "lines": line_count,
                    "line_fallbacks": line_count,
                    "dropped_word_anchors": raw_ctc_words,
                    "atomic_ctc_lines": 0,
                }
            offsets = [0]
            for row in line_tokens: offsets.append(offsets[-1] + len(row))
            generated = [
                [Word(w.start, w.end, w.text, w.confidence, idx)
                 for idx, w in enumerate(baseline[offsets[li] : offsets[li + 1]])]
                for li in range(begin, end)
            ]
        for li, line_words in zip(range(begin, end), generated, strict=True): line_results[li] = line_words

    output: list[Word] = []
    ctc_count, qwen_count, interpolated_count, ctc_lines_kept, qwen_lines_kept = 0, 0, 0, 0, 0
    for li, tokens in enumerate(line_tokens):
        line_words = line_results[li] or []

        source_kind = selected_by_line.get(li, (None, "interpolated", 0.0))[1]
        if source_kind == "ctc":
            ctc_lines_kept += 1
            ctc_count += len(tokens)
        elif source_kind == "qwen":
            qwen_lines_kept += 1
            qwen_count += len(tokens)
        else:
            interpolated_count += len(tokens)

        _extend_words(output, line_words, tokens)

    return output, {
        "ctc": ctc_count,
        "qwen": qwen_count,
        "interpolated": interpolated_count,
        "lines": line_count,
        "line_fallbacks": line_count - ctc_lines_kept - qwen_lines_kept,
        "dropped_word_anchors": max(0, raw_ctc_words - ctc_count),
        "atomic_ctc_lines": ctc_lines_kept,
        "atomic_qwen_lines": qwen_lines_kept,
    }


def _line_aware_canonical_alignment(
    groups: list[str],
    ctc_lines,
    qwen_words: list[Word],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
) -> tuple[list[Word], dict[str, int]]:
    line_tokens = [tokenize(group) for group in groups]
    canonical = [token for row in line_tokens for token in row]
    if not canonical or duration_sec <= 0.04:
        return [], {
            "ctc": 0,
            "qwen": 0,
            "interpolated": 0,
            "lines": 0,
            "line_fallbacks": 0,
            "dropped_word_anchors": 0,
        }

    baseline_words = _lossless_canonical_alignment(
        groups,
        source,
        sample_rate,
        duration_sec,
        anchor_windows,
    )
    baseline_lines: list[list[Word]] = []
    baseline_offset, baseline_valid = 0, _canonical_words_match(baseline_words, canonical)
    for tokens in line_tokens:
        count = len(tokens)
        baseline_lines.append(
            baseline_words[baseline_offset : baseline_offset + count] if baseline_valid else []
        )
        baseline_offset += count

    def word_minimum(token: str) -> float:
        chars = max(1, len(_normalize_match_token(token)))
        return max(0.09, min(0.44, 0.055 + 0.034 * chars))

    line_minimum = [
        max(_minimum_sung_phrase_duration(tokens), sum(word_minimum(token) for token in tokens))
        if tokens
        else 0.08
        for tokens in line_tokens
    ]
    line_expected = [
        max(line_minimum[idx] * 1.15, _expected_sung_phrase_duration(tokens))
        for idx, tokens in enumerate(line_tokens)
    ]
    line_maximum = [
        min(
            duration_sec,
            max(
                line_minimum[idx] * 2.8,
                line_expected[idx] * 2.15 + line_minimum[idx] * 0.45,
                line_expected[idx],
            ),
        )
        for idx in range(len(line_tokens))
    ]

    ctc_maps: list[dict[int, Word]] = [dict() for _ in line_tokens]
    ctc_line_quality: list[float] = [0.0] * len(line_tokens)
    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= len(line_tokens): continue
        expected = line_tokens[line_index]
        actual = list(getattr(result, "words", ()) or ())
        if not expected or not actual: continue
        quality = clamp01(float(getattr(result, "confidence", 0.0) or 0.0))
        ctc_line_quality[line_index] = quality
        for local_index, word in _matched_word_indices(actual, expected):
            if math.isfinite(float(word.start)) and math.isfinite(float(word.end)) and float(word.end) > float(word.start) + 0.009:
                bounded_start = max(0.0, min(duration_sec, float(word.start)))
                bounded_end = max(0.0, min(duration_sec, float(word.end)))
                if bounded_end > bounded_start + 0.009: ctc_maps[line_index][local_index] = Word(bounded_start, bounded_end, expected[local_index], clamp01(float(word.confidence)), local_index)

    qwen_maps: list[dict[int, Word]] = [dict() for _ in line_tokens]
    qwen = [word for word in (qwen_words or []) if _normalize_match_token(word.text)]
    if qwen:
        global_to_line = [(line_index, local_index) for line_index, tokens in enumerate(line_tokens) for local_index in range(len(tokens))]
        for canonical_index, word in _matched_word_indices(qwen, canonical):
            if canonical_index >= len(global_to_line): continue
            line_index, local_index = global_to_line[canonical_index]
            bounded_start = max(0.0, min(duration_sec, float(word.start)))
            bounded_end = max(0.0, min(duration_sec, float(word.end)))
            if bounded_end > bounded_start + 0.009: qwen_maps[line_index][local_index] = Word(bounded_start, bounded_end, line_tokens[line_index][local_index], clamp01(float(word.confidence)), local_index)

    active_start, active_end = _activity_bounds(source, sample_rate, duration_sec, 0.1)

    proposals: dict[int, tuple[float, float, str]] = {}
    proposal_ends: dict[int, float] = {}
    anchors = anchor_windows or {}
    for line_index, tokens in enumerate(line_tokens):
        if not tokens: continue
        cmap = ctc_maps[line_index]
        if cmap:
            matched = sorted(cmap.values(), key=lambda word: word.start)
            ratio = len(cmap) / max(1, len(tokens))
            proposals[line_index] = (
                max(0.0, matched[0].start),
                300.0 + 600.0 * max(ctc_line_quality[line_index], ratio),
                "ctc",
            )
            proposal_ends[line_index] = min(duration_sec, max(word.end for word in matched))
            continue
        qmap = qwen_maps[line_index]
        if qmap:
            matched = sorted(qmap.values(), key=lambda word: word.start)
            ratio = len(qmap) / max(1, len(tokens))
            mean_conf = sum(word.confidence for word in matched) / len(matched)
            if ratio >= 0.34 or len(tokens) <= 2:
                proposals[line_index] = (
                    max(0.0, matched[0].start),
                    80.0 + 120.0 * max(ratio, mean_conf),
                    "qwen",
                )
                proposal_ends[line_index] = min(duration_sec, max(word.end for word in matched))
                continue
        anchor = anchors.get(line_index)
        if anchor is not None:
            left, right, score = anchor
            if score >= 0.18:
                center = (float(left) + float(right)) / 2.0
                estimated = center - line_expected[line_index] / 2.0
                proposals[line_index] = (
                    max(0.0, min(duration_sec, estimated)),
                    10.0 + 30.0 * float(score),
                    "asr",
                )

    selected_proposals, typical_line_minimum = dict(proposals), float(np.median([value for value in line_minimum if value > 0.0])) if line_minimum else 0.0
    line_gap_floor = max(
        1.0 / max(1, sample_rate), typical_line_minimum / max(18.0, len(line_tokens) * 1.5)
    )

    def required_between(left_index: int, right_index: int) -> float: return sum(line_minimum[idx] for idx in range(left_index, right_index)) + line_gap_floor * max(0, right_index - left_index)

    changed = True
    while changed and selected_proposals:
        changed = False
        ordered = sorted(selected_proposals)
        for left_idx, right_idx in zip(ordered, ordered[1:], strict=False):
            left_start, left_priority, left_kind = selected_proposals[left_idx]
            right_start, right_priority, right_kind = selected_proposals[right_idx]
            if right_start + 1e-6 >= left_start + required_between(left_idx, right_idx): continue
            if left_priority < right_priority:
                selected_proposals.pop(left_idx, None)
            elif right_priority < left_priority:
                selected_proposals.pop(right_idx, None)
            else:
                selected_proposals.pop(right_idx, None)
            changed = True
            break

    fixed: dict[int, float] = {-1: active_start, len(line_tokens): active_end}
    for index, (start, _priority, _kind) in selected_proposals.items(): fixed[index] = max(active_start, min(active_end, start))

    fixed_items = sorted(fixed.items())
    line_starts: list[float | None] = [None] * len(line_tokens)

    for pair_index in range(len(fixed_items) - 1):
        left_index, left_time = fixed_items[pair_index]
        right_index, right_time = fixed_items[pair_index + 1]
        begin = left_index + 1
        end = right_index
        if left_index >= 0: line_starts[left_index] = left_time

        missing = list(range(begin, end))
        if not missing: continue

        if left_index < 0:
            segment_start = active_start
        else:
            acoustic_end = proposal_ends.get(left_index, left_time + line_expected[left_index])
            line_end_hint = max(
                left_time + line_minimum[left_index],
                min(
                    left_time + line_maximum[left_index],
                    max(acoustic_end, left_time + line_expected[left_index] * 0.90),
                ),
            )
            segment_start = line_end_hint + line_gap_floor
        segment_end = right_time
        required = sum(line_minimum[idx] for idx in missing) + line_gap_floor * max(
            0, len(missing) - 1
        )
        if segment_end < segment_start + required: segment_start = max(active_start, segment_end - required)

        target_durations = [line_expected[idx] for idx in missing]
        target_total = sum(target_durations)
        available = max(required, segment_end - segment_start)
        duration_budget = min(
            target_total, max(sum(line_minimum[idx] for idx in missing), available * 0.82)
        )
        scale = min(1.0, duration_budget / max(1e-6, target_total))
        durations = [max(line_minimum[idx], line_expected[idx] * scale) for idx in missing]
        used = sum(durations)
        silence = max(0.0, available - used)
        gap = silence / max(1, len(missing) + 1)

        cursor = segment_start + gap
        for local_pos, line_index in enumerate(missing):
            line_starts[line_index] = cursor
            cursor += durations[local_pos] + gap

    cursor = active_start
    for line_index in range(len(line_tokens)):
        start = max(cursor, float(line_starts[line_index]))
        line_starts[line_index] = start
        cursor = start + line_minimum[line_index] + line_gap_floor

    line_windows: list[tuple[float, float]] = []
    for line_index, _tokens in enumerate(line_tokens):
        start = max(0.0, min(duration_sec, float(line_starts[line_index])))
        next_start = (
            max(start + line_minimum[line_index], float(line_starts[line_index + 1]))
            if line_index + 1 < len(line_tokens)
            else active_end
        )
        if line_index + 1 < len(line_tokens):
            boundary_span = max(0.0, next_start - start)
            boundary_pad = clamp(boundary_span * 0.005, 0.008, 0.05)
            hard_end = min(duration_sec, next_start - boundary_pad)
        else:
            hard_end = min(duration_sec, active_end)
        target_end = start + min(line_maximum[line_index], line_expected[line_index] * 1.20)

        evidence_ends: list[tuple[float, float]] = []
        if ctc_maps[line_index]:
            evidence_ends.append(
                (
                    max(word.end for word in ctc_maps[line_index].values()),
                    3.0,
                )
            )
        if qwen_maps[line_index]:
            evidence_ends.append(
                (
                    max(word.end for word in qwen_maps[line_index].values()),
                    2.0,
                )
            )
        if anchors.get(line_index):
            _a, anchor_end, score = anchors[line_index]
            if score >= 0.25: evidence_ends.append((float(anchor_end), 1.0))

        for evidence_end, _strength in evidence_ends:
            if (
                evidence_end >= start + line_minimum[line_index] * 0.75
                and evidence_end <= start + line_maximum[line_index]
            ):
                target_end = max(target_end, evidence_end)

        end = min(hard_end, target_end)
        if end < start + line_minimum[line_index]: end = min(duration_sec, start + line_minimum[line_index])
        if end <= start + 0.05: end = min(duration_sec, start + max(0.08, line_minimum[line_index]))
        line_windows.append((start, end))

    stats = {
        "consensus": 0,
        "ctc": 0,
        "qwen": 0,
        "interpolated": 0,
        "lines": len(line_tokens),
        "line_fallbacks": 0,
        "dropped_word_anchors": 0,
    }
    output: list[Word] = []

    def build_line(
        line_index: int,
        start: float,
        end: float,
    ) -> tuple[list[Word], dict[str, int]]:
        tokens = line_tokens[line_index]
        if start >= duration_sec - 0.019 or end <= start + 0.019: return [], {"ctc": 0, "qwen": 0, "interpolated": 0, "dropped": 0}

        candidates: dict[int, tuple[Word, str, float]] = {}
        consensus_tolerance = max(
            0.08,
            min(0.42, line_expected[line_index] / max(4.0, len(tokens) * 2.0)),
        )
        for local_index, ctc_word in ctc_maps[line_index].items():
            qwen_word = qwen_maps[line_index].get(local_index)
            if qwen_word is not None:
                ctc_center = (ctc_word.start + ctc_word.end) / 2.0
                qwen_center = (qwen_word.start + qwen_word.end) / 2.0
                if abs(ctc_center - qwen_center) <= consensus_tolerance:
                    if (
                        ctc_word.end >= start - consensus_tolerance
                        and ctc_word.start <= end + consensus_tolerance
                    ):
                        confidence = max(ctc_word.confidence, qwen_word.confidence)
                        candidates[local_index] = (
                            replace(
                                ctc_word, text=tokens[local_index], confidence=confidence, index=local_index
                            ),
                            "consensus",
                            1_000_000.0 + 1000.0 * confidence,
                        )
                    continue
            if ctc_word.end >= start - 0.20 and ctc_word.start <= end + 0.20: candidates[local_index] = (ctc_word, "ctc", 1000.0 + 500.0 * ctc_word.confidence)
        for local_index, word in qwen_maps[line_index].items():
            if local_index in candidates: continue
            if word.end >= start - 0.20 and word.start <= end + 0.20: candidates[local_index] = (word, "qwen", 100.0 + 100.0 * word.confidence)

        clipped: dict[int, tuple[Word, str, float]] = {}
        for local_index, (word, kind, priority) in candidates.items():
            wstart = max(start, min(end, word.start))
            wend = max(wstart + 0.02, min(end, word.end))
            if wend <= end + 1e-6 and wend > wstart + 0.019:
                clipped[local_index] = (
                    Word(wstart, min(end, wend), tokens[local_index], word.confidence, local_index),
                    kind,
                    priority,
                )
        candidates = clipped

        def min_span(begin: int, finish: int) -> float: return sum(word_minimum(tokens[idx]) for idx in range(begin, finish))

        dropped = 0
        while True:
            ordered_indices = sorted(candidates)
            conflict: tuple[int, int] | None = None
            previous_index: int | None = None
            previous_word: Word | None = None
            for local_index in ordered_indices:
                word = candidates[local_index][0]
                if previous_index is not None and previous_word is not None:
                    required = min_span(previous_index + 1, local_index)
                    if word.start < previous_word.end + required - 1e-6:
                        conflict = (previous_index, local_index)
                        break
                previous_index = local_index
                previous_word = word

            if conflict is None and ordered_indices:
                first = ordered_indices[0]
                if candidates[first][0].start < start + min_span(0, first) - 1e-6:
                    conflict = (first, first)
                else:
                    last = ordered_indices[-1]
                    if end < candidates[last][0].end + min_span(last + 1, len(tokens)) - 1e-6: conflict = (last, last)

            if conflict is None: break
            left_idx, right_idx = conflict
            if left_idx == right_idx:
                drop_idx = left_idx
            else:
                left = candidates[left_idx]
                right = candidates[right_idx]
                if left[1] != right[1]:
                    source_rank = {"consensus": 3, "ctc": 2, "qwen": 1}
                    left_rank = source_rank.get(left[1], 0)
                    right_rank = source_rank.get(right[1], 0)
                    drop_idx = left_idx if left_rank < right_rank else right_idx
                elif left[2] != right[2]:
                    drop_idx = left_idx if left[2] < right[2] else right_idx
                else:
                    drop_idx = right_idx
            candidates.pop(drop_idx, None)
            dropped += 1
            if not candidates: break

        result, kinds = _seed_alignment_result(tokens, candidates)

        if not candidates:
            left_sample = max(0, int(start * sample_rate))
            right_sample = min(len(source), max(left_sample + 1, int(end * sample_rate)))
            local_audio = source[left_sample:right_sample]
            fallback = _activity_fallback_words(tokens, local_audio, sample_rate)
            if len(fallback) == len(tokens):
                local_span = fallback[-1].end - fallback[0].start
                if (
                    local_span >= line_minimum[line_index] * 0.85
                    and fallback[-1].end <= (end - start) + 0.05
                ):
                    acoustic_words = [
                        Word(
                            start + word.start,
                            start + word.end,
                            tokens[idx],
                            0.025,
                            idx,
                        )
                        for idx, word in enumerate(fallback)
                    ]
                    return acoustic_words, {
                        "ctc": 0,
                        "qwen": 0,
                        "interpolated": len(tokens),
                        "dropped": dropped,
                    }

        for run_start, run_end in _missing_runs(result):
            left_word = result[run_start - 1] if run_start > 0 else None
            right_word = result[run_end] if run_end < len(tokens) else None
            left_time = left_word.end if left_word is not None else start
            right_time = right_word.start if right_word is not None else end
            minima = [word_minimum(tokens[idx]) for idx in range(run_start, run_end)]
            minimum_total = sum(minima)
            if right_time < left_time + minimum_total - 1e-6:
                available = max(0.0, min(end, duration_sec) - start)
                if available < 0.04:
                    return [], {
                        "ctc": 0,
                        "qwen": 0,
                        "interpolated": 0,
                        "dropped": dropped + len(candidates),
                    }
                local = _proportional_words(tokens, available)
                rebuilt: list[Word] = []
                for idx, word in enumerate(local):
                    word_start = start + word.start
                    word_end = min(duration_sec, start + word.end)
                    if word_start >= duration_sec - 0.009 or word_end <= word_start + 0.009:
                        return [], {
                            "ctc": 0,
                            "qwen": 0,
                            "interpolated": 0,
                            "dropped": dropped + len(candidates),
                        }
                    rebuilt.append(Word(word_start, word_end, tokens[idx], 0.010, idx))
                return rebuilt, {
                    "ctc": 0,
                    "qwen": 0,
                    "interpolated": len(tokens),
                    "dropped": dropped + len(candidates),
                }

            _fill_weighted_gap(
                result,
                kinds,
                tokens,
                run_start,
                run_end,
                minima,
                left_time,
                right_time,
                minimum_span=0.02,
            )

        final = [word for word in result if word is not None]
        span, monotonic, micro, interior_gap = final[-1].end - final[0].start, all((right.start >= left.end - 1e-06 for left, right in zip(final, final[1:], strict=False))), any(word.end - word.start < min(0.075, word_minimum(word.text) * 0.6) for word in final), max([right.start - left.end for left, right in zip(final, final[1:], strict=False)] or [0.0])
        if (
            not monotonic
            or micro
            or span < line_minimum[line_index] * 0.80
            or span > line_maximum[line_index] + 1e-6
            or interior_gap > 1.65
        ):
            local = _proportional_words(tokens, min(end - start, line_expected[line_index]))
            rebuilt = [
                Word(start + word.start, start + word.end, tokens[idx], 0.010, idx)
                for idx, word in enumerate(local)
            ]
            return rebuilt, {
                "ctc": 0,
                "qwen": 0,
                "interpolated": len(tokens),
                "dropped": dropped + len(candidates),
            }

        return final, _alignment_source_stats(
            kinds,
            dropped=dropped,
            consensus_counts_for_qwen=True,
        )

    def baseline_line_for(
        line_index: int,
        previous_end: float,
        hard_end: float,
    ) -> list[Word]:
        tokens, source_line = line_tokens[line_index], baseline_lines[line_index] if line_index < len(baseline_lines) else []
        if len(source_line) == len(tokens):
            source_start = source_line[0].start
            source_end = source_line[-1].end
            source_span = max(0.04, source_end - source_start)
            start = max(previous_end + (0.015 if previous_end > 0 else 0.0), source_start)
            end_limit = min(duration_sec, max(start + 0.04, hard_end))
            available = end_limit - start
            if available >= 0.04:
                target_span = min(source_span, available)
                rebuilt: list[Word] = []
                for local_index, word in enumerate(source_line):
                    rel_start = (word.start - source_start) / source_span
                    rel_end = (word.end - source_start) / source_span
                    word_start = start + target_span * rel_start
                    word_end = start + target_span * rel_end
                    rebuilt.append(
                        Word(
                            word_start,
                            min(end_limit, word_end),
                            tokens[local_index],
                            0.008,
                            local_index,
                        )
                    )
                return rebuilt

        return []

    accepted_line_stats: list[dict[str, int]] = []

    for line_index, (start, end) in enumerate(line_windows):
        tokens = line_tokens[line_index]
        if not tokens: continue
        line, line_stats = build_line(line_index, start, end)
        if len(line) != len(tokens):
            stats["line_fallbacks"] += 1
            previous_end = output[-1].end if output else 0.0
            hard_end = (
                line_windows[line_index + 1][0] - 0.02
                if line_index + 1 < len(line_windows)
                else duration_sec
            )
            line = baseline_line_for(line_index, previous_end, hard_end)
            if len(line) != len(tokens): return [], stats
            line_stats = {
                "ctc": 0,
                "qwen": 0,
                "interpolated": len(tokens),
                "dropped": 0,
            }

        _extend_words(output, line, tokens, duration_sec)
        stats["consensus"] += int(line_stats.get("consensus", 0))
        stats["ctc"] += int(line_stats.get("ctc", 0))
        stats["qwen"] += int(line_stats.get("qwen", 0))
        stats["interpolated"] += int(line_stats.get("interpolated", 0))
        stats["dropped_word_anchors"] += int(line_stats.get("dropped", 0))
        accepted_line_stats.append(
            {
                "consensus": int(line_stats.get("consensus", 0)),
                "ctc": int(line_stats.get("ctc", 0)),
                "qwen": int(line_stats.get("qwen", 0)),
                "interpolated": int(line_stats.get("interpolated", 0)),
                "dropped": int(line_stats.get("dropped", 0)),
            }
        )

    return output, stats


def _weaker_selected_anchor(
    selected: dict[int, tuple[Word, str, float]],
    left_idx: int,
    right_idx: int,
) -> int | None:
    present = [index for index in (left_idx, right_idx) if index in selected]
    if len(present) == 1: return present[0]
    if not present:
        return (
            min(
                selected,
                key=lambda index: min(abs(index - left_idx), abs(index - right_idx)),
            )
            if selected
            else None
        )

    _left_word, left_kind, left_priority = selected[left_idx]
    _right_word, right_kind, right_priority = selected[right_idx]
    source_strength = {"qwen": 1, "ctc": 2, "consensus": 3}
    if left_kind != right_kind:
        return (
            left_idx
            if source_strength.get(left_kind, 0) < source_strength.get(right_kind, 0)
            else right_idx
        )
    return left_idx if left_priority < right_priority else right_idx if abs(left_priority - right_priority) > 1e-09 else right_idx

def _anchor_preserving_canonical_alignment(
    groups: list[str],
    ctc_lines,
    qwen_words: list[Word],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
    *,
    relaxed_gap_fit: bool = False,
    debug_out: dict[str, object] | None = None,
) -> tuple[list[Word], dict[str, int]]:
    line_tokens = [tokenize(group) for group in groups]
    tokens = [token for row in line_tokens for token in row]
    if not tokens or duration_sec <= 0.04: return [], _empty_alignment_stats()

    normalized_tokens = [_normalize_match_token(token) for token in tokens]
    offsets = _line_offsets(line_tokens)

    line_ranges, token_line_index = [(offsets[index], offsets[index] + len(row)) for index, row in enumerate(line_tokens)], [line_index for line_index, row in enumerate(line_tokens) for _ in row]

    candidates: dict[int, tuple[Word, str, float]] = {}
    evidence_catalog: dict[int, dict[str, dict[str, float]]] = {}
    rejection_reasons: Counter[str] = Counter()

    def add_candidate(idx: int, word: Word, kind: str, source_quality: float | None = None) -> None:
        start, end = float(word.start), float(word.end)
        if not math.isfinite(start) or not math.isfinite(end):
            rejection_reasons["non_finite_timestamp"] += 1
            return
        if start < 0.0 or end > duration_sec + 0.10:
            rejection_reasons["out_of_song_bounds"] += 1
            return
        if end <= start + 0.009:
            rejection_reasons["micro_or_negative_span"] += 1
            return

        if anchor_windows and idx < len(token_line_index):
            line_index = token_line_index[idx]
            window = anchor_windows.get(line_index)
            if window is not None and line_index < len(line_tokens):
                anchor_start, anchor_end, anchor_score = window
                timing = _line_timing_profile(line_tokens[line_index])
                reliability = clamp01(float(anchor_score))
                adaptive_margin = (
                    float(timing["context"])
                    + float(timing["anchor_lead"])
                    + float(timing["search_window"]) * (1.0 - reliability)
                )
                midpoint = (start + end) / 2.0
                if (
                    midpoint < float(anchor_start) - adaptive_margin
                    or midpoint > float(anchor_end) + adaptive_margin
                ):
                    rejection_reasons["outside_line_anchor_window"] += 1
                    evidence_catalog.setdefault(idx, {})[f"{kind}_rejected"] = {
                        "start": start,
                        "end": min(duration_sec, end),
                        "confidence": max(
                            0.0, min(1.0, float(getattr(word, "confidence", 0.0) or 0.0))
                        ),
                    }
                    return

        confidence = clamp01(float(getattr(word, "confidence", 0.0) or 0.0))
        quality, source_tiebreak, consensus_bonus = confidence if source_quality is None else max(confidence, clamp01(float(source_quality))), {'qwen': 1.0, 'ctc': 2.0, 'consensus': 3.0}.get(kind, 0.0), 2000.0 if kind == 'consensus' else 0.0
        priority = consensus_bonus + quality * 1000.0 + source_tiebreak
        evidence_catalog.setdefault(idx, {})[kind] = {
            "start": start,
            "end": min(duration_sec, end),
            "confidence": confidence,
        }
        existing = candidates.get(idx)
        if existing is None or priority > existing[2]:
            candidates[idx] = (
                Word(start, min(duration_sec, end), tokens[idx], confidence, idx),
                kind,
                priority,
            )

    timeline_quantum = max(1.0 / max(1, sample_rate), 1e-9)

    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= len(line_tokens): continue
        expected = line_tokens[line_index]
        base = offsets[line_index]
        words = list(getattr(result, "words", ()) or ())
        if not words or not expected: continue
        line_quality = float(getattr(result, "confidence", 0.0) or 0.0)
        for local_index, word in _matched_word_indices(words, expected): add_candidate(base + local_index, word, "ctc", line_quality)

    secondary = [word for word in (qwen_words or []) if _normalize_match_token(word.text)]
    if secondary:

        def temporally_agree(left: Word, right: Word) -> bool:
            overlap = min(float(left.end), float(right.end)) - max(
                float(left.start), float(right.start)
            )
            if overlap >= 0.0: return True
            left_span, right_span, left_mid, right_mid = max(timeline_quantum, float(left.end) - float(left.start)), max(timeline_quantum, float(right.end) - float(right.start)), (float(left.start) + float(left.end)) / 2.0, (float(right.start) + float(right.end)) / 2.0
            return abs(left_mid - right_mid) <= max(left_span, right_span)

        indexed_secondary = [
            word
            for word in secondary
            if 0 <= int(getattr(word, "index", -1)) < len(tokens)
            and _normalize_match_token(word.text) == normalized_tokens[int(word.index)]
        ]
        indexed_ids = {id(word) for word in indexed_secondary}
        mapped_secondary: list[tuple[int, Word]] = [
            (int(word.index), word) for word in indexed_secondary
        ]
        unindexed = [word for word in secondary if id(word) not in indexed_ids]
        if unindexed: mapped_secondary.extend(_matched_word_indices(unindexed, tokens))

        for idx, qwen_word in mapped_secondary:
            existing = candidates.get(idx)
            if existing is not None and existing[1] in {"ctc", "consensus"}:
                evidence_catalog.setdefault(idx, {})["qwen"] = {
                    "start": float(qwen_word.start),
                    "end": min(duration_sec, float(qwen_word.end)),
                    "confidence": clamp01(float(qwen_word.confidence)),
                }
                ctc_word = existing[0]
                if float(
                    getattr(qwen_word, "confidence", 0.0) or 0.0
                ) > FALLBACK_WORD_CONFIDENCE and temporally_agree(ctc_word, qwen_word):
                    combined_quality = max(
                        float(ctc_word.confidence),
                        float(getattr(qwen_word, "confidence", 0.0) or 0.0),
                    )
                    add_candidate(idx, ctc_word, "consensus", combined_quality)
                elif float(getattr(qwen_word, "confidence", 0.0) or 0.0) > float(
                    ctc_word.confidence
                ):
                    add_candidate(idx, qwen_word, "qwen")
                continue
            add_candidate(idx, qwen_word, "qwen")

    if not candidates:
        return _alignment_failure(
            debug_out, "no_valid_acoustic_candidates", "candidate_collection", rejection_reasons
        )

    adaptive_base_floors = [
        max(timeline_quantum, float(_line_timing_profile([token])["min_word_duration"]))
        for token in tokens
    ]
    adaptive_floor_total = sum(adaptive_base_floors)
    adaptive_floor_scale = (
        min(1.0, duration_sec / adaptive_floor_total) if adaptive_floor_total > 0.0 else 1.0
    )

    def minimum_word_span(token: str, idx: int) -> float:
        if relaxed_gap_fit: return max(timeline_quantum, adaptive_base_floors[idx] * adaptive_floor_scale)
        chars = max(1, len(_normalize_match_token(token)))
        return max(0.10, min(0.48, 0.065 + 0.038 * chars))

    def minimum_run_span(begin: int, end: int) -> float: return sum(minimum_word_span(tokens[pos], pos) for pos in range(begin, end))

    duration_filtered: dict[int, tuple[Word, str, float]] = {}
    for idx, candidate in candidates.items():
        acoustic_floor = max(
            1e-9,
            min(0.055, minimum_word_span(tokens[idx], idx) * 0.60),
        )
        if candidate[0].end - candidate[0].start + 1e-9 < acoustic_floor:
            reason = (
                "weak_qwen_micro_anchor"
                if relaxed_gap_fit and candidate[1] == "qwen"
                else "collapsed_acoustic_anchor"
            )
            rejection_reasons[reason] += 1
            continue
        duration_filtered[idx] = candidate
    candidates = duration_filtered
    if not candidates:
        return _alignment_failure(
            debug_out, "no_duration_valid_candidates", "candidate_filtering", rejection_reasons
        )

    anchor_boundary_tolerance, anchor_min_duration = duration_sec if relaxed_gap_fit else 0.22, min(adaptive_base_floors) if relaxed_gap_fit and adaptive_base_floors else 0.055

    if relaxed_gap_fit:
        filtered_candidates: dict[int, tuple[Word, str, float]] = {}
        for idx, candidate in candidates.items():
            if candidate[1] == "qwen":
                if (candidate[0].end - candidate[0].start) + 1e-9 < minimum_word_span(
                    tokens[idx], idx
                ):
                    rejection_reasons["weak_qwen_micro_anchor"] += 1
                    continue
                prefix_need = sum(adaptive_base_floors[:idx]) * adaptive_floor_scale
                suffix_need = sum(adaptive_base_floors[idx + 1 :]) * adaptive_floor_scale
                if (
                    candidate[0].start + 1e-9 < prefix_need
                    or duration_sec - candidate[0].end + 1e-9 < suffix_need
                ):
                    rejection_reasons["weak_qwen_edge_capacity"] += 1
                    continue
            filtered_candidates[idx] = candidate
        candidates = filtered_candidates
        if not candidates:
            return _alignment_failure(
                debug_out, "no_valid_relaxed_candidates", "candidate_filtering", rejection_reasons
            )

    ordered = sorted(candidates.items())
    dp_score: list[float] = []
    dp_prev: list[int] = []
    for pos, (idx, (word, _kind, priority)) in enumerate(ordered):
        best_score = priority
        best_prev = -1
        for prev_pos in range(pos):
            prev_idx, (prev_word, _prev_kind, _prev_priority) = ordered[prev_pos]
            missing = max(0, idx - prev_idx - 1)
            if relaxed_gap_fit:
                if word.start < prev_word.end - 1e-6: continue
            else:
                required = minimum_run_span(prev_idx + 1, idx) if missing else 0.0
                shortage = (prev_word.end + required) - word.start
                if shortage > (anchor_boundary_tolerance * 2.0) + 1e-6: continue
            score = dp_score[prev_pos] + priority
            if score > best_score:
                best_score = score
                best_prev = prev_pos
        dp_score.append(best_score)
        dp_prev.append(best_prev)

    end_pos = max(range(len(ordered)), key=lambda pos: dp_score[pos])
    selected_positions: list[int] = []
    while end_pos >= 0:
        selected_positions.append(end_pos)
        end_pos = dp_prev[end_pos]
    selected_positions.reverse()
    selected: dict[int, tuple[Word, str, float]] = {
        ordered[pos][0]: (
            ordered[pos][1][0],
            ordered[pos][1][1],
            ordered[pos][1][2],
        )
        for pos in selected_positions
    }
    rejection_reasons["not_in_initial_monotonic_chain"] += max(0, len(ordered) - len(selected))

    active_start, active_end = _activity_bounds(source, sample_rate, duration_sec)

    activity_regions = _vocal_activity_regions(source, sample_rate, join_gap=0.45)

    def nudge_conflicting_pair(left_idx: int, right_idx: int, required_gap: float) -> bool:
        left_word, left_kind, left_priority = selected[left_idx]
        right_word, right_kind, right_priority = selected[right_idx]
        shortage, left_room, right_room = left_word.end + required_gap - right_word.start, min(anchor_boundary_tolerance, max(0.0, left_word.end - left_word.start - anchor_min_duration)), min(anchor_boundary_tolerance, max(0.0, right_word.end - right_word.start - anchor_min_duration))
        if shortage > left_room + right_room + 1e-6: return False

        if left_priority + 1e-6 < right_priority:
            trim_left = min(shortage, left_room)
            trim_right = shortage - trim_left
        elif right_priority + 1e-6 < left_priority:
            trim_right = min(shortage, right_room)
            trim_left = shortage - trim_right
        else:
            trim_left = min(left_room, shortage / 2.0)
            trim_right = shortage - trim_left
            if trim_right > right_room:
                extra = trim_right - right_room
                trim_right = right_room
                trim_left += extra

        selected[left_idx] = (
            replace(
                left_word,
                end=max(left_word.start + anchor_min_duration, left_word.end - trim_left),
            ),
            left_kind,
            left_priority,
        )
        selected[right_idx] = (
            replace(
                right_word,
                start=min(right_word.end - anchor_min_duration, right_word.start + trim_right),
            ),
            right_kind,
            right_priority,
        )
        return True

    def activity_gap_words(
        run_start: int,
        run_end: int,
        left_time: float,
        right_time: float,
    ) -> list[Word] | None:
        count, wall_span, minimum_span = run_end - run_start, right_time - left_time, minimum_run_span(run_start, run_end)
        lexical_scale = max(
            minimum_span,
            sum(
                float(_line_timing_profile([tokens[pos]])["expected"])
                for pos in range(run_start, run_end)
            ),
        )
        if wall_span < max(minimum_span, lexical_scale) * 1.65: return None

        regions = []
        for start, end in activity_regions:
            start = max(left_time, float(start))
            end = min(right_time, float(end))
            region_floor = max(
                timeline_quantum,
                min(
                    (minimum_word_span(tokens[pos], pos) for pos in range(run_start, run_end)),
                    default=timeline_quantum,
                ),
            )
            if end - start >= region_floor: regions.append((start, end))
        if len(regions) < 2: return None

        minima, capacities = [minimum_word_span(tokens[pos], pos) for pos in range(run_start, run_end)], [end - start for start, end in regions]
        if sum(capacities) + 1e-6 < sum(minima): return None

        prefix = [0.0]
        for value in minima: prefix.append(prefix[-1] + value)
        total_capacity = max(1e-9, sum(capacities))
        states: dict[int, tuple[float, list[int]]] = {0: (0.0, [])}
        for region_index, capacity in enumerate(capacities):
            next_states: dict[int, tuple[float, list[int]]] = {}
            target_fraction = capacity / total_capacity
            for token_index, (cost, allocation) in states.items():
                remaining = count - token_index
                for take in range(0, remaining + 1):
                    needed = prefix[token_index + take] - prefix[token_index]
                    if needed > capacity + 1e-6: break
                    if region_index == len(capacities) - 1 and take != remaining: continue
                    fraction = take / max(1, count)
                    new_cost = cost + (fraction - target_fraction) ** 2
                    end_index = token_index + take
                    previous = next_states.get(end_index)
                    if previous is None or new_cost < previous[0]: next_states[end_index] = (new_cost, allocation + [take])
            states = next_states
            if not states: return None

        final_state = states[count]
        allocation = final_state[1]

        output: list[Word] = []
        token_index = run_start
        for (region_start, region_end), take in zip(regions, allocation, strict=True):
            if take <= 0: continue
            positions = list(range(token_index, token_index + take))
            local_minima = [minimum_word_span(tokens[pos], pos) for pos in positions]
            minimum_total = sum(local_minima)
            extra = max(0.0, (region_end - region_start) - minimum_total)
            weights = [_vowel_weighted_length(_normalize_match_token(tokens[pos])) for pos in positions]
            total_weight = max(1.0, sum(weights))
            cursor = region_start
            for pos, minimum, weight in zip(positions, local_minima, weights, strict=True):
                duration = minimum + extra * weight / total_weight
                end = min(region_end, cursor + duration)
                output.append(Word(cursor, end, tokens[pos], 0.018, pos))
                cursor = end
            token_index += take

        return output if len(output) == count else None

    def reacquire_complete_lines(
        result: list[Word | None],
        source_kind: list[str | None],
        run_start: int,
        run_end: int,
        left_time: float,
        right_time: float,
    ) -> bool:
        if not anchor_windows or run_end <= run_start: return False

        reacquired: dict[int, Word] = {}
        for line_index, (line_start, line_end) in enumerate(line_ranges):
            if line_end <= run_start or line_start >= run_end: continue
            if line_start < run_start or line_end > run_end: continue
            window = anchor_windows.get(line_index)
            if window is None: continue

            hinted_start, hinted_end, hint_score = window
            local_start = max(left_time, 0.0, float(hinted_start))
            local_end = min(right_time, duration_sec, float(hinted_end))
            tokens_for_line = tokens[line_start:line_end]
            minimum_span = minimum_run_span(line_start, line_end)
            if not tokens_for_line or local_end - local_start < minimum_span: continue

            sample_left = max(0, min(len(source), int(round(local_start * sample_rate))))
            sample_right = max(sample_left, min(len(source), int(round(local_end * sample_rate))))
            local_audio = source[sample_left:sample_right]
            local_words = _activity_fallback_words(
                tokens_for_line,
                local_audio,
                sample_rate,
            )
            if len(local_words) != len(tokens_for_line): continue

            absolute_words: list[Word] = []
            previous_end = local_start
            valid = True
            reacquired_confidence = max(0.02, min(0.30, float(hint_score) * 0.30))
            for local_index, local_word in enumerate(local_words):
                start = local_start + float(local_word.start)
                end = local_start + float(local_word.end)
                start = max(previous_end, start)
                end = min(local_end, end)
                if end <= start + 0.009:
                    valid = False
                    break
                absolute_words.append(
                    Word(
                        start,
                        end,
                        tokens_for_line[local_index],
                        reacquired_confidence,
                        line_start + local_index,
                    )
                )
                previous_end = end
            if not valid or len(absolute_words) != len(tokens_for_line): continue

            reacquired.update((word.index, word) for word in absolute_words)

        # The caller skips fallback filling when this returns True. Commit only
        # when the complete missing run was recovered; otherwise a full-line
        # island could leave partial boundary lines unset.
        if any(index not in reacquired for index in range(run_start, run_end)):
            return False
        for index in range(run_start, run_end):
            result[index] = reacquired[index]
            source_kind[index] = "reacquired"
        return True

    last_built_sources: list[str] = []

    def try_build() -> tuple[list[Word] | None, tuple[int, int] | None]:
        nonlocal last_built_sources
        result, source_kind = _seed_alignment_result(tokens, selected)

        anchor_indices = sorted(selected)
        for left_idx, right_idx in zip(anchor_indices, anchor_indices[1:], strict=False):
            left_word = result[left_idx]
            right_word = result[right_idx]
            assert left_word is not None and right_word is not None
            missing = right_idx - left_idx - 1
            required = (
                0.0
                if relaxed_gap_fit
                else (minimum_run_span(left_idx + 1, right_idx) if missing > 0 else 0.0)
            )
            if right_word.start < left_word.end + required - 1e-6:
                if nudge_conflicting_pair(left_idx, right_idx, required): return None, (-1, -1)
                return None, (left_idx, right_idx)

        for run_start, run_end in _missing_runs(result):
            count = run_end - run_start
            left_idx = run_start - 1 if run_start > 0 else None
            right_idx = run_end if run_end < len(tokens) else None
            left_word = result[left_idx] if left_idx is not None else None
            right_word = result[right_idx] if right_idx is not None else None

            left_time = float(left_word.end) if left_word is not None else 0.0
            right_time = float(right_word.start) if right_word is not None else duration_sec

            minimum_span = (
                timeline_quantum * max(1, count)
                if relaxed_gap_fit
                else minimum_run_span(run_start, run_end)
            )
            if left_word is None:
                hinted = max(0.0, active_start)
                if right_time - hinted >= minimum_span: left_time = hinted
            if right_word is None:
                hinted = min(duration_sec, active_end)
                if hinted - left_time >= minimum_span: right_time = hinted

            if right_time < left_time + minimum_span - 1e-6:
                if left_idx is not None and right_idx is not None: return None, (left_idx, right_idx)
                if right_idx is not None: return None, (right_idx, right_idx)
                if left_idx is not None: return None, (left_idx, left_idx)
                return None, None

            if reacquire_complete_lines(
                result, source_kind, run_start, run_end, left_time, right_time
            ):
                continue

            activity_words = activity_gap_words(
                run_start,
                run_end,
                left_time,
                right_time,
            )
            if activity_words is not None:
                for word in activity_words:
                    result[word.index] = word
                    source_kind[word.index] = "interpolated"
            else:
                minima = [minimum_word_span(tokens[pos], pos) for pos in range(run_start, run_end)]
                minimum_total = sum(minima)
                available_span = max(timeline_quantum * max(1, count), right_time - left_time)
                if relaxed_gap_fit and minimum_total > available_span and minimum_total > 0.0:
                    scale = max(timeline_quantum, available_span) / minimum_total
                    minima = [max(timeline_quantum, value * scale) for value in minima]
                    minimum_total = sum(minima)
                _fill_weighted_gap(
                    result,
                    source_kind,
                    tokens,
                    run_start,
                    run_end,
                    minima,
                    left_time,
                    right_time,
                    duration_limit=duration_sec,
                )

        final = [word for word in result if word is not None]
        if len(final) != len(tokens):
            rejection_reasons["incomplete_gap_fill"] += len(tokens) - len(final)
            return None, None
        last_built_sources = [str(kind or "interpolated") for kind in source_kind]
        return final, None

    while True:
        built, conflict = try_build()
        if built is not None:
            kinds = list(last_built_sources)
            assert len(kinds) == len(tokens)
            stats = _alignment_source_stats(kinds)
            if debug_out is not None:
                debug_out.clear()
                accepted_direct = sum(1 for kind in kinds if kind in {"consensus", "ctc", "qwen"})
                debug_out["word_sources"] = kinds
                debug_out["word_candidates"] = [
                    {"index": idx, "text": tokens[idx], **evidence_catalog.get(idx, {})}
                    for idx in range(len(tokens))
                ]
                debug_out["candidate_acoustic_words"] = len(candidates)
                debug_out["accepted_acoustic_words"] = accepted_direct
                debug_out["rejected_acoustic_words"] = max(0, len(candidates) - accepted_direct)
                debug_out["rejected_reasons"] = dict(rejection_reasons)
            return built, stats

        if conflict is None:
            return _alignment_failure(
                debug_out, "canonical_text_exceeds_song_duration", "gap_fitting", rejection_reasons
            )
        else:
            left_idx, right_idx = conflict
            if left_idx == -1 and right_idx == -1: continue
            if left_idx == right_idx:
                drop_idx = left_idx
            else:
                drop_idx = _weaker_selected_anchor(selected, left_idx, right_idx)
                if drop_idx is None: return [], _empty_alignment_stats()
        if conflict[0] == conflict[1]:
            rejection_reasons["edge_capacity_conflict"] += 1
        else:
            rejection_reasons["overlap_or_insufficient_gap"] += 1
        selected.pop(drop_idx, None)


def _group_lyric_text(text: str, maximum_words: int = 35) -> list[str]:
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if not lines: return []

    if len(lines) > 1: return lines

    tokens = tokenize(lines[0])
    if not tokens: return []
    return [' '.join(tokens)] if len(tokens) <= maximum_words else [' '.join(tokens[start:start + maximum_words]) for start in range(0, len(tokens), maximum_words)]

def _activity_quantile_times(audio: np.ndarray, sample_rate: int) -> list[float]:
    hop = max(1, int(sample_rate * 0.04))
    frame = max(hop, int(sample_rate * 0.08))
    if audio.size < frame: return [0.0, len(audio) / max(1, sample_rate)]
    values, times = [], []
    for start in range(0, max(1, len(audio) - frame + 1), hop):
        chunk = audio[start : start + frame]
        values.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
        times.append((start + frame / 2) / sample_rate)
    rms = np.asarray(values, dtype=np.float32)
    threshold = max(float(np.percentile(rms, 25)) * 1.8, float(np.percentile(rms, 90)) * 0.10)
    active = [time for time, value in zip(times, rms, strict=True) if value >= threshold]
    return active if len(active) >= 2 else [0.0, len(audio) / sample_rate]


def _pathological_alignment(words: list[Word], span: float) -> bool:
    if not words: return True
    durations = [max(0.0, word.end - word.start) for word in words]
    collapsed, compressed, implausible_long_word, implausible_held_word, overlaps, token_count, total_span = sum(duration <= 0.025 for duration in durations), sum(duration <= 0.09 for duration in durations), any((len(tokenize(word.text)[0]) >= 4 and duration <= 0.09 for word, duration in zip(words, durations, strict=True) if tokenize(word.text))), any((duration > min(3.2, max(1.8, 0.42 + len(tokenize(word.text)[0]) * 0.22)) for word, duration in zip(words, durations, strict=True) if tokenize(word.text))), sum((right.start < left.end - 0.015 for left, right in zip(words, words[1:], strict=False))), sum(max(1, len(tokenize(word.text))) for word in words), max(0.0, words[-1].end - words[0].start)
    return (
        min(durations) < 0.02
        or max(durations) > max(4.5, span * 0.62)
        or implausible_held_word
        or collapsed > max(2, len(words) // 4)
        or compressed > max(2, len(words) // 3)
        or implausible_long_word
        or overlaps > max(1, len(words) // 5)
        or (token_count >= 2 and total_span < token_count * 0.115)
    )


def _invalid_acoustic_timestamp_reason(words: list[Word], span: float) -> str | None:
    """Return a structural error without judging how a singer phrases a word."""
    if not math.isfinite(span) or span <= 0:
        return "invalid audio duration"
    if not words:
        return "no timed words"
    previous_end = 0.0
    for index, word in enumerate(words):
        start, end = float(word.start), float(word.end)
        if not math.isfinite(start) or not math.isfinite(end):
            return f"word {index} is non-finite"
        if start < -1e-6 or end <= start:
            return f"word {index} has an invalid interval"
        if end > span + 1e-3:
            return f"word {index} ends outside vocals"
        if index and start < previous_end - 1e-6:
            return f"word {index} overlaps word {index - 1}"
        previous_end = end
    return None


def _proportional_words(tokens: list[str], span: float) -> list[Word]:
    weights = [max(2.0, _vowel_weighted_length(token)) for token in tokens]
    total, offset, output = sum(weights), 0.0, []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = span * offset / total
        offset += weight
        word_end = span * offset / total
        output.append(Word(word_start, word_end, token, 0.05, index))
    return output


def _vocal_activity_regions(
    audio: np.ndarray, sample_rate: int, *, join_gap: float = 0.30
) -> list[tuple[float, float]]:
    source, hop = np.asarray(audio, dtype=np.float32), max(1, int(sample_rate * 0.04))
    frame = max(hop, int(sample_rate * 0.08))
    if source.size < frame: return []
    values = np.asarray(
        [
            float(np.sqrt(np.mean(source[start : start + frame] ** 2) + 1e-12))
            for start in range(0, source.size - frame + 1, hop)
        ],
        dtype=np.float32,
    )
    threshold = max(
        float(np.percentile(values, 25)) * 1.8,
        float(np.percentile(values, 90)) * 0.10,
    )
    regions: list[tuple[float, float]] = []
    region_start: float | None = None
    last_active: float | None = None
    for index, value in enumerate(values):
        timestamp = (index * hop + frame / 2) / sample_rate
        if value >= threshold:
            if region_start is None: region_start = timestamp
            last_active = timestamp
        elif (
            region_start is not None
            and last_active is not None
            and timestamp - last_active > join_gap
        ):
            if last_active - region_start >= 0.12: regions.append((region_start, last_active))
            region_start = None
            last_active = None
    if region_start is not None and last_active is not None and last_active - region_start >= 0.12: regions.append((region_start, last_active))
    return regions


def _offset_words(words: list[Word], tokens: list[str], cursor: float, line_end: float, confidence: float) -> list[Word]: return [Word(cursor + word.start, min(line_end, cursor + word.end), tokens[index], confidence, index) for index, word in enumerate(words)]


def _activity_fallback_words(
    tokens: list[str],
    audio: np.ndarray,
    sample_rate: int,
    hint_words: list[Word] | None = None,
    minimum_start: float | None = None,
) -> list[Word]:
    regions = _vocal_activity_regions(audio, sample_rate)
    if minimum_start is not None:
        unused_regions = [
            (max(region[0], minimum_start), region[1])
            for region in regions
            if region[1] >= minimum_start + 0.02
        ]
        if unused_regions: regions = unused_regions
    if not regions: return _proportional_words(tokens, max(0.08, len(audio) / sample_rate))

    clusters: list[list[tuple[float, float]]] = []
    for region in regions:
        if clusters and region[0] - clusters[-1][-1][1] <= 1.50:
            clusters[-1].append(region)
        else:
            clusters.append([region])
    if len(tokens) >= 10:
        selected = regions
    elif hint_words and len(tokens) <= 3:
        hint_start = hint_words[0].start
        selected = min(
            clusters,
            key=lambda cluster: min(
                abs(cluster[0][0] - hint_start),
                abs(cluster[-1][1] - hint_start),
                0.0 if cluster[0][0] <= hint_start <= cluster[-1][1] else float("inf"),
            ),
        )
        maximum_span = sum(min(3.2, max(0.7, 0.42 + len(token) * 0.22)) for token in tokens)
        cluster_start = selected[0][0]
        cluster_end = selected[-1][1]
        if cluster_end - cluster_start > maximum_span:
            clipped_end = cluster_start + maximum_span
            selected = [
                (start, min(end, clipped_end)) for start, end in selected if start < clipped_end
            ]
    elif hint_words:
        hint_center = (hint_words[0].start + hint_words[-1].end) / 2
        selected = min(
            clusters,
            key=lambda cluster: abs((cluster[0][0] + cluster[-1][1]) / 2 - hint_center),
        )
    else:
        selected = clusters[0]

    weights = [max(1, len(token)) for token in tokens]
    total_weight, active_duration = max(1, sum(weights)), sum((max(0.0, end - start) for start, end in selected))
    if active_duration <= 0.02:
        start, end = selected[0][0], selected[-1][1]
        local = _proportional_words(tokens, max(0.08, end - start))
        return [
            Word(start + word.start, start + word.end, word.text, word.confidence, word.index)
            for word in local
        ]

    def active_offset_to_time(offset: float) -> float:
        remaining = max(0.0, min(active_duration, offset))
        for start, end in selected[:-1]:
            span = max(0.0, end - start)
            if remaining <= span: return start + remaining
            remaining -= span
        start, end = selected[-1]
        return min(end, start + remaining)

    output: list[Word] = []
    consumed = 0
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        start = active_offset_to_time(active_duration * consumed / total_weight)
        consumed += weight
        end = active_offset_to_time(active_duration * consumed / total_weight)
        output.append(Word(start, max(start + 0.02, end), token, 0.05, index))
    return output


def _segment_alignment_is_usable(words: list[Word], tokens: list[str], span: float) -> bool:
    if not words or not tokens or len(words) != len(tokens): return False
    span = max(0.0, float(span))
    if span <= 0.04 or _pathological_alignment(words, span): return False

    expected, actual = [token.casefold() for token in tokens], []
    for word in words:
        parts = tokenize(word.text)
        if len(parts) != 1: return False
        actual.append(parts[0].casefold())
    if actual != expected: return False

    previous_end = -1e-6
    for word in words:
        start = float(word.start)
        end = float(word.end)
        if start < -0.05 or end > span + 0.05 or end <= start + 0.009: return False
        if start < previous_end - 0.02: return False
        previous_end = end
    return True


def _phrase_duration(tokens: list[str], empty: float, floor: float, token_weight: float, character_weight: float) -> float: return max(floor, token_weight * len(tokens) + character_weight * sum(map(len, tokens))) if tokens else empty


def _minimum_sung_phrase_duration(tokens: list[str]) -> float: return _phrase_duration(tokens, 0.0, 0.28, 0.135, 0.0065)


def _expected_sung_phrase_duration(tokens: list[str]) -> float: return _phrase_duration(tokens, 0.5, 0.65, 0.34, 0.024)


def _line_timing_profile(tokens: list[str]) -> dict[str, float]:
    minimum, expected = _minimum_sung_phrase_duration(tokens), _expected_sung_phrase_duration(tokens)
    context, cursor_backtrack, anchor_lead, candidate_slack, overlap_slack, min_word_duration = clamp(expected * 0.45, 0.75, 2.2), clamp(expected * 0.08, 0.1, 0.32), clamp(expected * 0.24, 0.35, 0.95), clamp(expected * 0.035, 0.05, 0.14), clamp(expected * 0.01, 0.012, 0.03), clamp(minimum / max(1, len(tokens)) * 0.18, 0.014, 0.03)
    minimum_window = max(
        expected * 1.85 + context,
        minimum * 2.4 + context,
        3.8,
    )
    search_window = clamp(
        expected * 2.7 + context * 2.0,
        minimum_window,
        14.0,
    )
    return {
        "minimum": minimum,
        "expected": expected,
        "context": context,
        "cursor_backtrack": cursor_backtrack,
        "anchor_lead": anchor_lead,
        "candidate_slack": candidate_slack,
        "overlap_slack": overlap_slack,
        "min_word_duration": min_word_duration,
        "minimum_window": minimum_window,
        "search_window": search_window,
    }


def _lrc_window_is_plausible(tokens: list[str], span: float) -> bool: return float(span) + 1e-06 >= _minimum_sung_phrase_duration(tokens)


def enforce_segmented_timing_safety(
    words: list[Word],
    segments: list[tuple[float, float, str]] | tuple[tuple[float, float, str], ...],
    duration_sec: float,
) -> list[Word]:
    if not words or not segments: return words

    output: list[Word] = []
    offset, cursor, duration_sec = 0, 0.0, max(0.0, float(duration_sec))

    for segment in sorted(segments, key=lambda item: (float(item[0]), float(item[1]))):
        anchor_start, _anchor_end, text = segment
        tokens = tokenize(text)
        if not tokens: continue
        count = len(tokens)
        group = words[offset : offset + count]
        offset += count
        if len(group) != count: break

        token_match = all(
            tokenize(word.text) and tokenize(word.text)[0].casefold() == token.casefold()
            for word, token in zip(group, tokens, strict=True)
        )
        line_span = max(0.0, float(group[-1].end) - float(group[0].start))
        minimum = _minimum_sung_phrase_duration(tokens)
        has_micro_train = sum((word.end - word.start) <= 0.025 for word in group) > max(
            1, count // 4
        )
        monotonic = all(
            right.start >= left.end - 0.02 for left, right in zip(group, group[1:], strict=False)
        )
        valid = token_match and monotonic and line_span + 1e-6 >= minimum and not has_micro_train

        if valid:
            safe_group = []
            for word in group:
                start = max(cursor, float(word.start))
                end = min(duration_sec, float(word.end)) if duration_sec > 0 else float(word.end)
                if end <= start + 0.019:
                    valid = False
                    break
                safe_group.append(Word(start, end, word.text, word.confidence, 0))
            if valid:
                _extend_words(output, safe_group)
                cursor = output[-1].end
                continue

        start = max(cursor, max(0.0, float(anchor_start)))
        expected = _expected_sung_phrase_duration(tokens)
        target = max(minimum * 1.35, expected * 1.12)
        if duration_sec > 0: target = min(target, max(0.08, duration_sec - start))
        rebuilt = _proportional_words(tokens, max(0.08, target))
        for word in rebuilt:
            end = start + word.end
            if duration_sec > 0: end = min(duration_sec, end)
            output.append(
                Word(
                    start + word.start,
                    max(start + word.start + 0.02, end),
                    word.text,
                    0.03,
                    len(output),
                )
            )
        if rebuilt: cursor = output[-1].end

    if offset < len(words):
        for word in words[offset:]:
            start = max(cursor, float(word.start))
            end = max(start + 0.02, float(word.end))
            if duration_sec > 0: end = min(duration_sec, end)
            if end > start:
                output.append(Word(start, end, word.text, word.confidence, len(output)))
                cursor = end
    return output or words


def _timed_segment_fallback_words(tokens: list[str], span: float) -> list[Word]:
    span = max(0.08, float(span))
    if not tokens: return []
    characters = sum(len(token) for token in tokens)
    expected = 0.34 * len(tokens) + 0.024 * characters
    usable = min(span, max(0.55, min(expected * 1.35, expected + 1.15)))
    return _proportional_words(tokens, usable)


def _long_text_line_fallback(
    tokens: list[str],
    search_span: float,
    *,
    candidate_words: list[Word] | None = None,
    minimum_start: float = 0.0,
    audio: np.ndarray | None = None,
    sample_rate: int | None = None,
) -> list[Word]:
    if not tokens: return []
    search_span = max(0.08, float(search_span))
    minimum_start = max(0.0, min(search_span, float(minimum_start)))

    start = minimum_start
    if candidate_words:
        candidate_start = float(candidate_words[0].start)
        if minimum_start - 0.20 <= candidate_start <= search_span - 0.05: start = max(minimum_start, candidate_start)
    elif audio is not None and sample_rate:
        regions = _vocal_activity_regions(audio, int(sample_rate))
        for region_start, region_end in regions:
            if region_end >= minimum_start + 0.02:
                start = max(minimum_start, region_start)
                break

    minimum, expected = _minimum_sung_phrase_duration(tokens), _expected_sung_phrase_duration(tokens)
    target, available = max(minimum * 1.35, expected * 1.12), max(0.08, search_span - start)
    span = min(available, target)
    return [
        Word(start + word.start, start + word.end, word.text, 0.03, word.index)
        for word in _proportional_words(tokens, span)
    ]


def _speech_focus_variant(audio: np.ndarray) -> np.ndarray:
    source = np.asarray(audio, dtype=np.float32)
    if source.size < 3: return source
    emphasized = source.copy()
    emphasized[1:] = source[1:] - 0.91 * source[:-1]
    mixed = source * 0.78 + emphasized * 0.22
    return _normalize_singing_audio(mixed)


def _script_ratio(text: str, language: str | None) -> float:
    letters = [ch for ch in text.casefold() if ch.isalpha()]
    if not letters: return 0.0
    language = (_language_name(language) or "").casefold()
    if language in {"russian", "ukrainian"}:
        matching = sum(bool(re.match(r"[а-яёіїєґ]", ch)) for ch in letters)
    elif language == "english":
        matching = sum("a" <= ch <= "z" for ch in letters)
    else:
        return 1.0
    return matching / len(letters)


def _transcript_quality(text: str, duration_sec: float, language: str | None) -> float:
    value = _clean_transcript_part(text)
    tokens = tokenize(value)
    if not tokens: return 0.0
    duration_sec = max(0.5, float(duration_sec))
    rate, score = len(tokens) / duration_sec, 1.0
    if rate < 0.12:
        score -= min(0.42, (0.12 - rate) * 2.5)
    elif rate > 4.0: score -= min(0.42, (rate - 4.0) * 0.18)
    long_tokens = sum(len(token) > 28 for token in tokens)
    score -= min(0.25, long_tokens * 0.08)
    repeated = sum(a.casefold() == b.casefold() for a, b in zip(tokens, tokens[1:], strict=False))
    if len(tokens) >= 4: score -= min(0.22, repeated / max(1, len(tokens) - 1) * 0.5)
    score -= max(0.0, 0.82 - _script_ratio(value, language)) * 0.45
    return clamp01(score)


def _token_key(token: str) -> str: return str(token or '').casefold().replace('ё', 'е').replace('’', "'").replace('ʼ', "'").strip('.,!?;:()[]{}')


def _candidate_agreement(text: str, candidates: list[str]) -> float:
    tokens = " ".join(_token_key(token) for token in tokenize(text))
    if not tokens or len(candidates) <= 1: return 0.0
    peers, skipped_self, target_clean = [], False, _clean_transcript_part(text)
    for item in candidates:
        clean = _clean_transcript_part(item)
        if not skipped_self and clean == target_clean:
            skipped_self = True
            continue
        peer = " ".join(_token_key(token) for token in tokenize(item))
        if peer: peers.append(peer)
    if not peers: return 0.0
    scores = [SequenceMatcher(None, tokens, peer).ratio() for peer in peers]
    return sum(scores) / len(scores)


def _select_candidate(candidates: list[str], duration_sec: float, language: str | None) -> str:
    cleaned = [_clean_transcript_part(item) for item in candidates if _clean_transcript_part(item)]
    if not cleaned: return ""
    best, best_score = cleaned[0], -1.0
    for item in cleaned:
        quality = _transcript_quality(item, duration_sec, language)
        consensus = _candidate_agreement(item, cleaned)
        score = quality * 0.68 + consensus * 0.32
        if score > best_score: best, best_score = item, score
    return best


def _clean_transcript_part(text: str) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if not value: return ""
    tokens = value.split()
    for width in range(min(8, len(tokens) // 3), 2, -1):
        index = 0
        cleaned: list[str] = []
        while index < len(tokens):
            block = tokens[index : index + width]
            repeats = 1
            cursor = index + width
            while tokens[cursor : cursor + width] == block:
                repeats += 1
                cursor += width
            cleaned.extend(block)
            if repeats >= 3:
                index = cursor
            else:
                index += width
        if len(cleaned) < len(tokens): tokens = cleaned
    return " ".join(tokens).strip()


def _trim_transcript_overlaps(parts: list[str]) -> list[str]:
    merged: list[str] = []
    trimmed: list[str] = []
    for part in parts:
        tokens = _clean_transcript_part(part).split()
        if not tokens:
            trimmed.append("")
            continue
        overlap = 0
        maximum = min(10, len(merged), len(tokens))
        for size in range(maximum, 0, -1):
            left = [_token_key(item) for item in merged[-size:]]
            right = [_token_key(item) for item in tokens[:size]]
            if left == right:
                overlap = size
                break
            if size >= 2:
                similarities = [
                    SequenceMatcher(None, a, b).ratio() for a, b in zip(left, right, strict=False)
                ]
                if min(similarities) >= 0.80 and sum(similarities) / size >= 0.90:
                    overlap = size
                    break
        owned = tokens[overlap:]
        trimmed.append(" ".join(owned))
        merged.extend(owned)
    return trimmed


def _majority_language(values: list[str | None], requested: str | None) -> str | None:
    explicit = _language_name(requested)
    if explicit: return explicit
    normalized = [_language_name(value) for value in values if value]
    normalized = [value for value in normalized if value]
    return Counter(normalized).most_common(1)[0][0] if normalized else None


def _consensus_language(
    texts: list[str], detected: list[str | None], requested: str | None
) -> str | None:
    explicit = _language_name(requested)
    if explicit: return explicit
    combined = " ".join(texts).casefold()
    cyrillic, latin = len(re.findall('[а-яёіїєґ]', combined)), len(re.findall('[a-z]', combined))
    if cyrillic >= 24 and cyrillic >= latin * 1.25:
        if any(character in combined for character in "іїєґ"): return "Ukrainian"
        return "Russian"
    return 'English' if latin >= 24 and latin >= cyrillic * 1.25 else _majority_language(detected, None)


def _normalize_generation_config(model) -> None:
    current = model
    seen: set[int] = set()
    for _ in range(5):
        if current is None or id(current) in seen: break
        seen.add(id(current))
        generation_config = getattr(current, "generation_config", None)
        if generation_config is not None:
            if getattr(generation_config, "pad_token_id", None) is None:
                eos_token_id = getattr(generation_config, "eos_token_id", None)
                if eos_token_id is not None: generation_config.pad_token_id = eos_token_id
            if not bool(getattr(generation_config, "do_sample", False)) and hasattr(
                generation_config, "temperature"
            ):
                generation_config.temperature = None
        current = getattr(current, "model", None)


def _load_qwen_pretrained(model_class, model_name: str, role: str, operation: str, *, cuda_kwargs=None, cpu_kwargs=None):
    import torch

    device = select_torch_device(torch, role)
    cuda_kwargs, cpu_kwargs = cuda_kwargs or {}, cpu_kwargs or {}
    kwargs = {
        **(cuda_kwargs if device.startswith("cuda") else cpu_kwargs),
        "device_map": device,
        "dtype": torch.float16 if device.startswith("cuda") else torch.float32,
    }
    with profile_operation(operation):
        try:
            model = model_class.from_pretrained(model_name, **kwargs)
        except Exception as exc:
            fallback = fallback_torch_device(role, device, exc)
            if fallback is None: raise
            device = fallback
            model = model_class.from_pretrained(
                model_name, device_map="cpu", dtype=torch.float32, **cpu_kwargs
            )
    return model, device


class Qwen3Transcriber(Transcriber):
    name = "qwen3-asr"

    def __init__(self, model=get_model("asr").repo_id):
        self.model_name = model
        self._model = None
        self._device = "cpu"
        self._call_batch_size = 1
        self.last_language: str | None = None
        self.last_segments: list[tuple[float, float, str]] = []
        self._activity_hints: list[tuple[float, float]] = []

    def set_pitch_activity(self, frames) -> None:
        intervals: list[tuple[float, float]] = []
        start, last = None, None
        for frame in sorted(frames or [], key=lambda item: item.time):
            active = bool(frame.voiced and frame.frequency > 0 and frame.confidence >= 0.35)
            if active:
                if start is None: start = frame.time
                last = frame.time
            elif start is not None and last is not None:
                intervals.append((max(0.0, start - 0.02), last + 0.04))
                start = last = None
        if start is not None and last is not None: intervals.append((max(0.0, start - 0.02), last + 0.04))
        self._activity_hints = intervals

    def _load(self):
        try:
            from qwen_asr import Qwen3ASRModel
        except ImportError as exc:
            raise EngineUnavailableError("Install the official qwen-asr package") from exc
        if self._model is None:
            self._model, self._device = _load_qwen_pretrained(
                Qwen3ASRModel,
                self.model_name,
                "asr",
                "model.load.qwen_asr",
                cuda_kwargs={"max_inference_batch_size": 2, "max_new_tokens": 256},
                cpu_kwargs={"max_inference_batch_size": 1, "max_new_tokens": 256},
            )
            self._call_batch_size = 2 if self._device.startswith("cuda") else 1
            _normalize_generation_config(self._model)
        return self._model

    @staticmethod
    def _parse_batch(result, count: int):
        if count == 1: return [_unwrap_single_result(result) if result is not None else {}]
        values = list(result) if isinstance(result, (list, tuple)) else [result]
        if len(values) < count: values.extend([None] * (count - len(values)))
        return [
            _unwrap_single_result(value) if value is not None else {} for value in values[:count]
        ]

    def _transcribe_batch_once(self, model, audios, language):
        language, kwargs = _qwen_transcribe_language(language), {'audio': audios if len(audios) > 1 else audios[0]}
        if len(audios) > 1:
            kwargs["language"] = [language] * len(audios) if language else [None] * len(audios)
        elif language: kwargs["language"] = language
        try:
            with profile_operation("inference.qwen_asr"): result = model.transcribe(**kwargs)
            with profile_operation("postprocess.qwen_asr"): return self._parse_batch(result, len(audios))
        except (TypeError, ValueError):
            output = []
            for item_audio in audios:
                item_kwargs = {"audio": item_audio}
                if language: item_kwargs["language"] = language
                with profile_operation("inference.qwen_asr"): result = model.transcribe(**item_kwargs)
                with profile_operation("postprocess.qwen_asr"): output.append(_unwrap_single_result(result))
            return output

    def _transcribe_batch(self, model, audios, language):
        if not audios: return []
        try:
            return self._transcribe_batch_once(model, audios, language)
        except Exception as exc:
            fallback = fallback_torch_device("asr", self._device, exc)
            if fallback is None: raise
            self._model = None
            return self._transcribe_batch_once(self._load(), audios, language)

    def transcribe(self, audio, language):
        model = self._load()
        self.last_segments = []
        requested_language, audio_path = _language_name(language), Path(audio) if isinstance(audio, (str, Path)) else None
        if audio_path is not None and not audio_path.is_file():
            kwargs = {"audio": str(audio)}
            qwen_language = _qwen_transcribe_language(requested_language)
            if qwen_language: kwargs["language"] = qwen_language
            with profile_operation("inference.qwen_asr"): result = model.transcribe(**kwargs)
            with profile_operation("postprocess.qwen_asr"): item = _unwrap_single_result(result)
            text = _clean_transcript_part(str(_first(item, ("text", "transcription"), "") or ""))
            self.last_language = (
                _language_name(_first(item, ("language", "lang"), None)) or requested_language
            )
            return text, _words_from_items(_unwrap_items(item))

        y, sr = load_mono(audio, 16000)
        windows = _singing_chunk_windows(y, sr, self._activity_hints)
        chunks = [chunk for chunk, _start, _end in windows]

        inputs, results = [(chunk, sr) for chunk in chunks], []
        for start in range(0, len(inputs), self._call_batch_size):
            results.extend(
                self._transcribe_batch(
                    model,
                    inputs[start : start + self._call_batch_size],
                    requested_language,
                )
            )
        if len(results) < len(inputs): results.extend([None] * (len(inputs) - len(results)))

        initial_parts: list[str] = []
        detected: list[str | None] = []
        direct_words: list[Word] = []
        parsed_items = []
        for raw in results[: len(inputs)]:
            item = _unwrap_single_result(raw) if raw is not None else {}
            parsed_items.append(item)
            part = str(_first(item, ("text", "transcription"), "") or "").strip()
            initial_parts.append(_clean_transcript_part(part))
            detected.append(_first(item, ("language", "lang"), None))
            if len(inputs) == 1: direct_words = _words_from_items(_unwrap_items(item))

        consensus_language, chosen_parts = _consensus_language(initial_parts, detected, requested_language), list(initial_parts)

        suspicious: list[tuple[float, int]] = []
        for index, (chunk, part, detected_language) in enumerate(
            zip(chunks, initial_parts, detected, strict=False)
        ):
            chunk_duration = len(chunk) / sr
            quality = _transcript_quality(part, chunk_duration, consensus_language)
            language_mismatch = bool(
                consensus_language
                and detected_language
                and _language_name(detected_language) != consensus_language
            )
            if quality < 0.78 or language_mismatch or not part:
                priority = quality - (0.30 if language_mismatch else 0.0)
                suspicious.append((priority, index))

        mismatched = {
            index
            for index, language in enumerate(detected)
            if consensus_language and language and _language_name(language) != consensus_language
        }
        weakest = [index for _, index in sorted(suspicious) if index not in mismatched][:5]
        retry_indices = sorted(mismatched | set(weakest))
        retry_audio = [(_speech_focus_variant(chunks[index]), sr) for index in retry_indices]
        retry_items = self._transcribe_batch(model, retry_audio, consensus_language)
        candidate_map: dict[int, list[str]] = {
            index: [initial_parts[index]] for index in retry_indices
        }
        for index, item in zip(retry_indices, retry_items, strict=False):
            candidate_map[index].append(
                str(_first(item, ("text", "transcription"), "") or "").strip()
            )

        second_round = [
            index
            for index in retry_indices
            if _transcript_quality(
                _select_candidate(candidate_map[index], len(chunks[index]) / sr, consensus_language),
                len(chunks[index]) / sr,
                consensus_language,
            ) < 0.72
        ][:2]
        second_audio = []
        for index in second_round:
            chunk, trim = chunks[index], int(0.10 * sr)
            second_audio.append((_normalize_singing_audio(chunk[trim:-trim] if len(chunk) > 2 * trim else chunk), sr))
        second_items = self._transcribe_batch(model, second_audio, consensus_language)
        for index, item in zip(second_round, second_items, strict=False):
            candidate_map[index].append(
                str(_first(item, ("text", "transcription"), "") or "").strip()
            )

        for index in retry_indices:
            chosen_parts[index] = _select_candidate(
                candidate_map[index], len(chunks[index]) / sr, consensus_language
            )

        owned_parts = _trim_transcript_overlaps(chosen_parts)
        text = "\n".join(part for part in owned_parts if part).strip()
        self.last_segments = [
            (start, end, part)
            for (_chunk, start, end), part in zip(windows, owned_parts, strict=False)
            if part
        ]
        if len(inputs) == 1 and chosen_parts != initial_parts: direct_words = []
        self.last_language = resolve_alignment_language(text, consensus_language)
        return text, direct_words

    def release(self) -> None:
        self._model = None
        try:
            import torch

            if torch.cuda.is_available(): torch.cuda.empty_cache()
        except ImportError:
            pass


def _adaptive_qwen_batch_size(clip_durations: list[float] | None = None) -> int:
    configured = os.getenv("KARAOKE_AI_ALIGN_BATCH_SIZE", "").strip()
    if configured:
        try:
            return max(1, min(16, int(configured)))
        except ValueError:
            pass
    longest = max((float(x) for x in (clip_durations or []) if float(x) > 0), default=6.0)
    try:
        import torch

        if torch.cuda.is_available():
            free, _total = torch.cuda.mem_get_info()
            free_gb = float(free) / (1024.0**3)
            if free_gb >= 7.0 and longest <= 8.0: return 8
            if free_gb >= 4.0 and longest <= 12.0: return 4
            if free_gb >= 2.2: return 2
            return 1
    except Exception:
        pass
    return 2


def _write_alignment_clip(sf, root, name, source, sample_rate, start, end):
    left = max(0, int(start * sample_rate))
    right = min(len(source), max(left + 1, int(end * sample_rate)))
    path = root / name
    sf.write(path, source[left:right], sample_rate, subtype="PCM_16")
    return path, source[left:right]


def _batched_alignment_results(align_many, jobs, batch_size, language):
    for pos in range(0, len(jobs), batch_size):
        batch = jobs[pos : pos + batch_size]
        results = align_many([job["path"] for job in batch], [str(job["text"]) for job in batch], language)
        yield from zip(batch, results, strict=True)


def _merge_debug_summary(debug: dict[str, object]) -> dict[str, object]: return {'failure_reason': str(debug.get('failure_reason') or ''), 'failure_stage': str(debug.get('failure_stage') or ''), 'candidate_acoustic_words': int(debug.get('candidate_acoustic_words', 0) or 0), 'accepted_acoustic_words': int(debug.get('accepted_acoustic_words', 0) or 0), 'rejected_reasons': dict(debug.get('rejected_reasons') or {})}


def _record_merge_candidate(name, words, stats, canonical_tokens, attempts, candidates, debug=None):
    debug = debug or {}
    ok = _canonical_words_match(words, canonical_tokens)
    attempts[name] = {"canonical": ok, "words": len(words), "stats": dict(stats)}
    if debug: attempts[name].update(_merge_debug_summary(debug))
    if ok: candidates.append((name, words, stats, debug))
    return ok


def _merge_stat_counts(stats, word_count=0): return {key: int(stats.get(key, word_count if key == 'interpolated' else 0) or 0) for key in ('consensus', 'ctc', 'qwen', 'reacquired', 'interpolated')}


def _merge_evidence_rank(item):
    _name, words, stats, _debug = item
    counts = _merge_stat_counts(stats, len(words))
    return (
        counts["ctc"] + counts["qwen"], counts["consensus"], counts["ctc"],
        counts["qwen"], counts["reacquired"], -counts["interpolated"],
        int(round(sum(float(word.confidence) for word in words) * 1000.0)),
    )


def _publish_merge_diagnostics(diagnostics, mode, words, stats, debug, candidates, raw_ctc_words):
    counts = _merge_stat_counts(stats, len(words))
    diagnostics.update({
        "alignment_merge_mode": mode,
        "alignment_merge_candidates": {
            name: _merge_stat_counts(candidate_stats, len(candidate_words))
            for name, candidate_words, candidate_stats, _ in candidates
        },
        "preserved_consensus_words": counts["consensus"],
        "preserved_ctc_words": counts["ctc"],
        "preserved_qwen_words": counts["qwen"],
        "reacquired_words": counts["reacquired"],
        "interpolated_words": counts["interpolated"],
        "acoustic_candidate_stats": {
            "candidate_acoustic_words": int(debug.get("candidate_acoustic_words", 0) or 0),
            "accepted_acoustic_words": int(debug.get("accepted_acoustic_words", 0) or 0),
            "rejected_acoustic_words": int(debug.get("rejected_acoustic_words", 0) or 0),
            "rejected_reasons": dict(debug.get("rejected_reasons") or {}),
        },
        "line_aware_lines": int(stats.get("lines", 0) or 0),
        "line_fallbacks": int(stats.get("line_fallbacks", 0) or 0),
        "dropped_word_anchors": int(stats.get("dropped_word_anchors", 0) or 0),
        "atomic_ctc_lines": int(stats.get("atomic_ctc_lines", 0) or 0),
        "atomic_qwen_lines": int(stats.get("atomic_qwen_lines", 0) or 0),
        "suspicious_regions": _low_confidence_regions(words),
    })
    if debug.get("word_sources"): diagnostics["word_sources"] = list(debug.get("word_sources") or [])
    if debug.get("word_candidates"): diagnostics["word_candidates"] = list(debug.get("word_candidates") or [])
    if raw_ctc_words > 0 and counts["ctc"] <= 0: diagnostics["ctc_all_anchors_rejected"] = True


class Qwen3ForcedAligner(Aligner):
    name = "ctc-qwen-hybrid-aligner"

    def __init__(self, model=get_model("aligner").repo_id):
        self.model_name = model
        self._model = None
        self._device = "cpu"
        self._ctc = CTCWordAligner.from_environment()
        self.last_alignment_diagnostics: dict[str, object] = {}

    def _load(self):
        try:
            from qwen_asr import Qwen3ForcedAligner
        except ImportError as exc:
            raise EngineUnavailableError(
                "Install the official qwen-asr package with forced aligner support"
            ) from exc
        if self._model is None:
            self._model, self._device = _load_qwen_pretrained(
                Qwen3ForcedAligner, self.model_name, "aligner", "model.load.qwen_aligner"
            )
        return self._model

    def _run_alignment(self, **kwargs):
        try:
            return self._load().align(**kwargs)
        except Exception as exc:
            fallback = fallback_torch_device("aligner", self._device, exc)
            if fallback is None: raise
            self._model = None
            return self._load().align(**kwargs)

    def align(self, audio, text, language):
        resolved_language = resolve_alignment_language(text, language)
        with profile_operation("inference.qwen_aligner"):
            result = self._run_alignment(
                audio=str(audio),
                text=text,
                language=resolved_language,
            )
        item = _unwrap_single_result(result)
        words = _words_from_items(item if isinstance(item, (list, tuple)) else _unwrap_items(item))
        if not words: raise InvalidArtifactError("Forced aligner returned no timed words")

        try:
            span = duration(audio)
        except (OSError, RuntimeError, ValueError):
            return words
        if _pathological_alignment(words, span):
            source, sample_rate = load_mono(audio, 16000)
            tokens = tokenize(text)
            repaired = _activity_fallback_words(
                tokens,
                source,
                sample_rate,
                words,
            )
            if repaired: words = repaired
        return words

    def _align_many(self, audios, texts, language):
        if not audios: return []
        if len(audios) == 1:
            try:
                return [self.align(audios[0], texts[0], language)]
            except (InvalidArtifactError, RuntimeError, ValueError):
                return [[]]

        resolved_language = resolve_alignment_language(" ".join(texts), language)
        try:
            with profile_operation("inference.qwen_aligner"):
                raw_results = self._run_alignment(
                    audio=[str(item) for item in audios],
                    text=list(texts),
                    language=[resolved_language] * len(audios),
                )
        except (EngineUnavailableError, TypeError, ValueError):
            output = []
            for audio_item, text_item in zip(audios, texts, strict=True):
                try:
                    output.append(self.align(audio_item, text_item, language))
                except (InvalidArtifactError, RuntimeError, ValueError):
                    output.append([])
            return output

        results = list(raw_results) if isinstance(raw_results, (list, tuple)) else [raw_results]
        if len(results) < len(audios): results.extend([None] * (len(audios) - len(results)))

        parsed: list[list[Word]] = []
        for raw in results[: len(audios)]:
            if raw is None:
                parsed.append([])
                continue
            item = _unwrap_single_result(raw)
            words = _words_from_items(
                item if isinstance(item, (list, tuple)) else _unwrap_items(item)
            )
            parsed.append(words)
        return parsed

    def align_segments(self, audio, segments, language):
        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailableError("soundfile is required for segmented alignment") from exc

        source, sample_rate = load_mono(audio, 16000)
        duration_sec = len(source) / sample_rate
        output: list[Word] = []
        word_sources: list[str] = []
        cursor, ordered = 0.0, sorted(segments, key=lambda item: (float(item[0]), float(item[1])))

        clip_hints = [
            max(0.05, float(end) - float(start)) for start, end, text in ordered if tokenize(text)
        ]
        batch_size, ctc_line_results, ctc_available = _adaptive_qwen_batch_size(clip_hints), [None] * len(ordered), callable(getattr(self._ctc, 'available_for', None))
        if ctc_available and self._ctc.available_for(
            language, "\n".join(text for _, _, text in ordered)
        ):
            ctc_anchor_windows = {
                i: (
                    max(0.0, float(start)),
                    min(duration_sec, max(float(start) + 0.04, float(end))),
                    0.9,
                )
                for i, (start, end, text) in enumerate(ordered)
                if tokenize(text)
            }
            try:
                ctc_line_results = self._ctc.align_lines(
                    audio, [text for _, _, text in ordered], language, ctc_anchor_windows
                )
            except (EngineUnavailableError, InvalidArtifactError, RuntimeError, ValueError):
                ctc_line_results = [None] * len(ordered)
            finally:
                self._ctc.release()

        with tempfile.TemporaryDirectory(prefix="karaoke-align-") as temp_dir:
            root = Path(temp_dir)
            index = 0
            while index < len(ordered):
                prepared = []
                batch_cursor = cursor
                for segment_index in range(index, min(len(ordered), index + batch_size)):
                    start, end, text = ordered[segment_index]
                    tokens = tokenize(text)
                    if not tokens:
                        prepared.append(None)
                        continue

                    anchor_start = max(0.0, float(start))
                    if anchor_start >= duration_sec - 0.01:
                        prepared.append(None)
                        continue
                    anchor_end = min(duration_sec, max(anchor_start + 0.04, float(end)))
                    anchor_span = max(0.0, anchor_end - anchor_start)
                    plausible_anchor = _lrc_window_is_plausible(tokens, anchor_span)
                    expected = _expected_sung_phrase_duration(tokens)

                    pre_roll = 0.0 if plausible_anchor else 1.25
                    post_roll = (
                        max(0.85, expected * 0.55) if plausible_anchor else max(5.0, expected * 2.4)
                    )
                    search_start = max(0.0, anchor_start - pre_roll)
                    search_start = max(search_start, max(0.0, batch_cursor - 0.18))
                    search_end = min(
                        duration_sec,
                        max(
                            anchor_end + post_roll,
                            search_start + expected * (2.1 if plausible_anchor else 3.6) + 1.5,
                        ),
                    )
                    left = max(0, min(len(source) - 1, int(search_start * sample_rate)))
                    right = max(left + 1, min(len(source), int(search_end * sample_rate)))
                    path = root / f"segment-{segment_index:03d}.wav"
                    sf.write(path, source[left:right], sample_rate, subtype="PCM_16")
                    prepared.append(
                        {
                            "segment_index": segment_index,
                            "path": path,
                            "text": text,
                            "tokens": tokens,
                            "anchor_start": anchor_start,
                            "anchor_end": anchor_end,
                            "anchor_span": anchor_span,
                            "plausible_anchor": plausible_anchor,
                            "expected": expected,
                            "search_start": search_start,
                            "search_end": search_end,
                        }
                    )

                active = [item for item in prepared if item is not None]
                candidates = self._align_many(
                    [item["path"] for item in active],
                    [item["text"] for item in active],
                    language,
                )
                candidate_by_index = {
                    item["segment_index"]: candidate
                    for item, candidate in zip(active, candidates, strict=True)
                }

                for offset, item in enumerate(prepared):
                    segment_index = index + offset
                    if item is None: continue
                    tokens = item["tokens"]
                    anchor_start = item["anchor_start"]
                    anchor_end = item["anchor_end"]
                    anchor_span = item["anchor_span"]
                    plausible_anchor = item["plausible_anchor"]
                    expected = item["expected"]
                    search_start = item["search_start"]
                    search_end = item["search_end"]
                    search_span = search_end - search_start
                    candidate = candidate_by_index.get(segment_index, [])

                    local_words: list[Word] = []
                    line_source = "interpolated"
                    candidate_ok = _segment_alignment_is_usable(candidate, tokens, search_span)
                    if candidate_ok:
                        absolute_start = search_start + candidate[0].start
                        absolute_end = search_start + candidate[-1].end
                        candidate_duration = absolute_end - absolute_start
                        candidate_ok = (
                            absolute_start >= cursor - 0.20
                            and absolute_end <= search_end + 0.05
                            and candidate_duration >= _minimum_sung_phrase_duration(tokens)
                        )
                        if plausible_anchor:
                            candidate_ok = candidate_ok and (
                                absolute_start >= anchor_start - 0.85
                                and absolute_start <= anchor_end + 1.25
                            )
                    if candidate_ok:
                        local_words = candidate
                        line_source = "qwen"

                    ctc_result = ctc_line_results[segment_index]
                    if not local_words and ctc_result is not None and len(ctc_result.words) == len(tokens):
                        local_words = list(ctc_result.words)
                        search_start = 0.0
                        search_end = duration_sec
                        line_source = "ctc"

                    if not local_words:
                        line_source = "interpolated"
                        if plausible_anchor:
                            local_words = _timed_segment_fallback_words(tokens, anchor_span)
                            search_start = anchor_start
                            search_end = anchor_end
                        else:
                            fallback_start = max(cursor, anchor_start)
                            room = max(0.08, search_end - fallback_start)
                            target = max(
                                _minimum_sung_phrase_duration(tokens) * 1.35,
                                expected * 1.12,
                            )
                            safe_span = min(room, target)
                            local_words = _proportional_words(tokens, safe_span)
                            search_start = fallback_start

                    line_words: list[Word] = []
                    for word in local_words:
                        word_start = max(cursor, search_start + float(word.start))
                        word_end = min(duration_sec, search_start + float(word.end))
                        if word_end <= word_start + 0.009:
                            line_words = []
                            break
                        line_words.append(Word(word_start, word_end, word.text, word.confidence, 0))

                    line_duration = line_words[-1].end - line_words[0].start if line_words else 0.0
                    if len(line_words) != len(
                        tokens
                    ) or line_duration < _minimum_sung_phrase_duration(tokens):
                        fallback_start = max(cursor, anchor_start)
                        available = max(0.08, search_end - fallback_start)
                        safe_span = min(
                            available,
                            max(
                                _minimum_sung_phrase_duration(tokens) * 1.35,
                                expected * 1.12,
                            ),
                        )
                        line_words = [
                            Word(
                                fallback_start + word.start,
                                fallback_start + word.end,
                                word.text,
                                0.03,
                                0,
                            )
                            for word in _proportional_words(tokens, safe_span)
                        ]
                        line_source = "interpolated"

                    for word in line_words:
                        output.append(
                            Word(word.start, word.end, word.text, word.confidence, len(output))
                        )
                        word_sources.append(line_source)
                    if line_words: cursor = max(cursor, line_words[-1].end)

                index += batch_size

        if not output: raise InvalidArtifactError("Segmented forced aligner returned no timed words")
        self.last_alignment_diagnostics = {
            "word_sources": word_sources,
            "ctc_lines_used": sum(1 for item in word_sources if item == "ctc"),
            "qwen_lines_used": sum(1 for item in word_sources if item == "qwen"),
            "interpolated_lines_used": sum(1 for item in word_sources if item == "interpolated"),
        }
        return enforce_segmented_timing_safety(output, ordered, duration_sec)

    def align_long_text(self, audio, text, language):
        tokens = tokenize(text)
        if not tokens:
            raise InvalidArtifactError("Long-text alignment requires lyrics")

        source, sample_rate = load_mono(audio, 16000)
        duration_sec = len(source) / sample_rate
        if duration_sec <= 0.04:
            raise InvalidArtifactError("Vocal track is too short for alignment")

        ctc_available = False
        ctc_failure = ""
        try:
            ctc_available = self._ctc.available_for(language, text)
            if ctc_available:
                with profile_operation("inference.ctc_full_song_alignment"):
                    result = self._ctc.align_window(source, sample_rate, tokens, language)
                if result is None:
                    ctc_failure = "CTC returned no words"
                else:
                    words = [
                        Word(
                            float(word.start),
                            float(word.end),
                            token,
                            float(word.confidence),
                            index,
                        )
                        for index, (word, token) in enumerate(
                            zip(result.words, tokens, strict=True)
                        )
                    ]
                    if not _canonical_words_match(words, tokens):
                        ctc_failure = "CTC violated canonical lyric invariant"
                    elif reason := _invalid_acoustic_timestamp_reason(words, duration_sec):
                        ctc_failure = f"CTC returned invalid timestamps ({reason})"
                    else:
                        self.last_alignment_diagnostics = {
                            "alignment_mode": "full-song-ctc",
                            "audio_reference": "vocals",
                            "ctc_version": CTC_ALIGNMENT_VERSION,
                            "word_count": len(words),
                            "confidence": float(result.confidence),
                            "interpolated_words": 0,
                        }
                        return words
        except (EngineUnavailableError, InvalidArtifactError, RuntimeError, ValueError) as exc:
            ctc_failure = f"{type(exc).__name__}: {exc}"
        finally:
            self._ctc.release()

        def vocal_activity_fallback(qwen_failure: str) -> list[Word]:
            groups = [line.strip() for line in text.splitlines() if tokenize(line)] or [text]
            fallback = _lossless_canonical_alignment(
                groups, source, sample_rate, duration_sec, None
            )
            reason = _invalid_acoustic_timestamp_reason(fallback, duration_sec)
            if not _canonical_words_match(fallback, tokens) or reason:
                raise InvalidArtifactError(
                    "Full-song vocal alignment failed: "
                    f"{ctc_failure or 'CTC model unavailable'}; Qwen: {qwen_failure}; "
                    f"vocal activity: {reason or 'canonical lyric invariant'}"
                )
            self.last_alignment_diagnostics = {
                "alignment_mode": "vocal-activity-fallback",
                "audio_reference": "vocals",
                "word_count": len(fallback),
                "interpolated_words": len(fallback),
                "ctc_failure_reason": ctc_failure or "CTC model unavailable",
                "qwen_failure_reason": qwen_failure,
            }
            return fallback

        try:
            with profile_operation("inference.qwen_full_song_alignment"):
                raw = self._run_alignment(
                    audio=str(audio),
                    text=text,
                    language=resolve_alignment_language(text, language),
                )
        except Exception as exc:
            return vocal_activity_fallback(f"{type(exc).__name__}: {exc}")

        item = _unwrap_single_result(raw)
        raw_words = _words_from_items(
            item if isinstance(item, (list, tuple)) else _unwrap_items(item)
        )
        words = [
            Word(
                float(word.start),
                float(word.end),
                token,
                float(word.confidence),
                index,
            )
            for index, (word, token) in enumerate(zip(raw_words, tokens, strict=False))
        ]
        if not _canonical_words_match(words, tokens):
            return vocal_activity_fallback("canonical lyric invariant")
        if reason := _invalid_acoustic_timestamp_reason(words, duration_sec):
            return vocal_activity_fallback(f"invalid timestamps ({reason})")

        self.last_alignment_diagnostics = {
            "alignment_mode": "full-song-qwen",
            "audio_reference": "vocals",
            "word_count": len(words),
            "interpolated_words": 0,
            "ctc_failure_reason": ctc_failure or "CTC model unavailable",
        }
        return words


def _low_confidence_regions(words: list[Word]) -> list[dict[str, object]]:
    if not words: return []
    confidences = np.asarray([float(w.confidence) for w in words], dtype=np.float32)
    positive = confidences[confidences > 0]
    if positive.size == 0: return []
    typical = float(np.median(positive))
    floor, regions, current = max(0.015, typical * 0.3), [], []
    for word in words:
        if float(word.confidence) <= floor:
            current.append(word)
        elif current:
            regions.append(current)
            current = []
    if current: regions.append(current)
    return [
        {
            "start": float(group[0].start),
            "end": float(group[-1].end),
            "words": len(group),
            "mean_confidence": float(sum(w.confidence for w in group) / len(group)),
            "text": " ".join(w.text for w in group[:8]),
        }
        for group in regions[:24]
    ]


class UniformTextFallback(Transcriber, Aligner):
    name = "uniform-text-fallback"

    def transcribe(self, audio, language): return ('', [])

    def align(self, audio, text, language):
        tokens, total_duration = tokenize(text), duration(audio)
        if not tokens: return []
        weights = [max(1, len(token)) for token in tokens]
        total_weight, cursor, output = sum(weights), 0.0, []
        for index, (token, weight) in enumerate(zip(tokens, weights, strict=False)):
            start = total_duration * cursor / total_weight
            cursor += weight
            end = total_duration * cursor / total_weight
            output.append(Word(start, end, token, 0.05, index))
        return output
