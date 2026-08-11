from __future__ import annotations

import re
import os
import math
import tempfile
from bisect import bisect_right
from collections import Counter
from collections.abc import Iterable
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from ..audio import duration, load_mono
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..models import Word
from ..model_registry import get_model
from .base import Aligner, Transcriber
from .device import select_torch_device
from .ctc_alignment import CTC_ALIGNMENT_VERSION, CTCWordAligner, _language_code

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


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text)


def _language_name(language: str | None) -> str | None:
    if not language:
        return None
    value = str(language).strip()
    if not value:
        return None
    return _LANGUAGE_NAMES.get(value.lower(), value)


def resolve_alignment_language(text: str, language: str | None = None) -> str:
    """Return a non-empty language name suitable for Qwen Forced Aligner.

    Qwen3-ASR accepts language=None for automatic language detection, but the
    official Forced Aligner calls ``language.lower()`` internally and therefore
    cannot accept None.  Prefer an explicit/detected language and only infer
    from the transcript when no language metadata is available.
    """
    explicit = _language_name(language)
    if explicit:
        return explicit

    sample = str(text or "")
    lowered = sample.lower()
    if any(ch in lowered for ch in "іїєґ"):
        return "Ukrainian"
    if re.search(r"[а-яё]", lowered):
        return "Russian"
    if re.search(r"[a-z]", lowered):
        return "English"
    if re.search(r"[\u4e00-\u9fff]", sample):
        return "Chinese"
    if re.search(r"[\u3040-\u30ff]", sample):
        return "Japanese"
    if re.search(r"[\uac00-\ud7af]", sample):
        return "Korean"
    # Qwen's forced aligner requires a string. Russian is the safest default
    # for this application's primary Cyrillic karaoke workflow.
    return "Russian"


def _first(value, names, default=None):
    for name in names:
        if isinstance(value, dict) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    return default


def _unwrap_single_result(result):
    # Some qwen-asr releases return a batch list, while wrappers may return
    # (text, timestamps). Preserve the latter tuple as a structured result.
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], str):
        return {"text": result[0], "time_stamps": result[1]}
    if isinstance(result, (list, tuple)) and result:
        return result[0]
    return result


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
    if isinstance(result, Iterable) and not isinstance(result, (str, bytes, dict)):
        return result
    return []


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
            elif isinstance(item[2], str):
                start, end, token = item[0], item[1], item[2]
            if len(item) >= 4:
                confidence = item[3]
        token = str(token or "").strip()
        if token and start is not None and end is not None:
            words.append(
                Word(
                    float(start),
                    float(end),
                    token,
                    max(0.0, min(1.0, float(confidence))),
                    index,
                )
            )
    return words


ASR_PIPELINE_VERSION = "singing-batched-script-consensus-v14-duration-guard"
LONG_TEXT_ALIGNMENT_VERSION = "v41-atomic-acoustic-line-anchors"


def _normalize_singing_audio(y: np.ndarray) -> np.ndarray:
    audio = np.asarray(y, dtype=np.float32).copy()
    if audio.size == 0:
        return audio
    audio -= float(np.mean(audio))
    peak = float(np.max(np.abs(audio)))
    if peak <= 1e-7:
        return audio
    rms = float(np.sqrt(np.mean(audio * audio) + 1e-12))
    # Separated vocals can be very quiet. Lift them without hard clipping.
    gain = min(8.0, max(1.0, 0.09 / max(rms, 1e-6)))
    audio *= gain
    peak = float(np.max(np.abs(audio)))
    if peak > 0.94:
        audio *= 0.94 / peak
    return np.ascontiguousarray(audio, dtype=np.float32)


def _singing_chunk_windows(
    y: np.ndarray,
    sr: int,
    activity_hints: list[tuple[float, float]] | None = None,
) -> list[tuple[np.ndarray, float, float]]:
    """Split long singing audio near energy valleys, not at fixed seconds."""
    if y.size == 0:
        return []
    total_sec = len(y) / sr
    if total_sec <= 32.0:
        return [(_normalize_singing_audio(y), 0.0, total_sec)]

    hop = max(1, int(sr * 0.025))
    frame = max(hop, int(sr * 0.05))
    count = max(1, (len(y) + hop - 1) // hop)
    rms = np.empty(count, dtype=np.float32)
    for index in range(count):
        start = index * hop
        chunk = y[start : min(len(y), start + frame)]
        rms[index] = float(np.sqrt(np.mean(chunk * chunk) + 1e-12)) if chunk.size else 0.0

    target = 16.0
    search = 3.5
    minimum = 7.0
    maximum = 22.0
    starts = [0]
    cursor_sec = 0.0
    while total_sec - cursor_sec > maximum:
        ideal = cursor_sec + target
        lo = max(cursor_sec + minimum, ideal - search)
        hi = min(cursor_sec + maximum, ideal + search)
        lo_i = max(0, int(lo * sr / hop))
        hi_i = min(len(rms) - 1, int(hi * sr / hop))
        if hi_i <= lo_i:
            cut_sec = min(total_sec, cursor_sec + target)
        else:
            region = rms[lo_i : hi_i + 1]
            # Prefer a low-energy valley which is also outside FCPE voiced activity.
            # Pitch was already computed by the pipeline, so this signal is free.
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
                    if voiced:
                        scores[local_index] += 1.20
            local = int(np.argmin(scores))
            cut_sec = (lo_i + local) * hop / sr
        cut_sample = max(starts[-1] + int(minimum * sr), min(len(y), int(cut_sec * sr)))
        starts.append(cut_sample)
        cursor_sec = cut_sample / sr

    starts.append(len(y))
    chunks: list[tuple[np.ndarray, float, float]] = []
    overlap = int(0.42 * sr)
    for chunk_index, (left, right) in enumerate(zip(starts, starts[1:], strict=False)):
        # Give the ASR a little context on both sides of every energy-valley cut.
        # `_merge_transcript_parts` removes the duplicated words afterwards.
        # This is much safer for sung consonants than a hard boundary.
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


def _singing_chunks(
    y: np.ndarray,
    sr: int,
    activity_hints: list[tuple[float, float]] | None = None,
) -> list[np.ndarray]:
    """Compatibility wrapper used by focused unit tests and older callers."""
    return [audio for audio, _start, _end in _singing_chunk_windows(y, sr, activity_hints)]



def _normalized_match_tokens(text: str) -> list[str]:
    return [re.sub(r"[^\w]+", "", token.casefold(), flags=re.UNICODE) for token in tokenize(text)]


def _asr_line_anchor_windows(
    groups: list[str],
    segments: list[tuple[float, float, str]] | None,
) -> dict[int, tuple[float, float, float]]:
    """Map trusted lyric lines onto coarse ASR segment time using global token order.

    ASR text is used only as a navigation signal. Qwen Forced Aligner still owns
    final word boundaries. SequenceMatcher over the whole song makes repeated
    choruses resolve monotonically instead of jumping to an earlier occurrence.
    """
    if not groups or not segments:
        return {}
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
        if not tokens:
            continue
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
    if not lyric_tokens or not asr_tokens:
        return {}

    matcher = SequenceMatcher(None, lyric_tokens, asr_tokens, autojunk=False)
    token_map: dict[int, tuple[float, float]] = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            li = block.a + offset
            ai = block.b + offset
            if 0 <= ai < len(asr_times):
                token_map[li] = asr_times[ai]

    result: dict[int, tuple[float, float, float]] = {}
    for line_index, (left, right) in enumerate(line_ranges):
        matched = [token_map[index] for index in range(left, right) if index in token_map]
        token_count = max(1, right - left)
        score = len(matched) / token_count
        if not matched or score < 0.18:
            continue
        start = min(item[0] for item in matched)
        end = max(item[1] for item in matched)
        margin = 1.8 if len(matched) == 1 else 1.0
        result[line_index] = (max(0.0, start - margin), end + margin, score)
    return result



def _canonical_words_match(words: list[Word], tokens: list[str]) -> bool:
    if len(words) != len(tokens):
        return False
    return all(
        re.sub(r"[^\w]+", "", word.text.casefold(), flags=re.UNICODE)
        == re.sub(r"[^\w]+", "", token.casefold(), flags=re.UNICODE)
        for word, token in zip(words, tokens, strict=True)
    )


def _lossless_canonical_alignment(
    groups: list[str],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
) -> list[Word]:
    """Complete physically-valid canonical baseline.

    This function is deliberately independent from ASR timing. ASR anchors are
    useful navigation hints for acoustic alignment, but they must never be able
    to compress the canonical fallback timeline. Every lyric line receives at
    least its physical sung minimum; remaining song time is distributed as
    bounded line duration and inter-line silence.
    """
    line_tokens = [tokenize(group) for group in groups]
    all_tokens = [token for tokens in line_tokens for token in tokens]
    if not all_tokens or duration_sec <= 0.04:
        return []

    active = _activity_quantile_times(source, sample_rate)
    active_start = max(0.0, float(active[0])) if active else 0.0
    active_end = min(duration_sec, float(active[-1])) if active else duration_sec
    if active_end <= active_start + 0.08:
        active_start, active_end = 0.0, duration_sec

    line_minimum = [
        max(0.08, _minimum_sung_phrase_duration(tokens))
        for tokens in line_tokens
    ]
    line_expected = [
        max(line_minimum[index], _expected_sung_phrase_duration(tokens))
        for index, tokens in enumerate(line_tokens)
    ]
    available = max(0.08, active_end - active_start)
    minimum_total = sum(line_minimum)

    # If the active envelope itself is too narrow (pathological VAD), fall back
    # to the complete audio range rather than compressing lyric lines.
    if minimum_total > available + 1e-6:
        active_start = 0.0
        active_end = duration_sec
        available = max(0.08, duration_sec)

    # Allocate line durations. Expected sung durations are preferred, but the
    # sum may exceed a short song; shrink only down to each line's hard minimum.
    expected_total = sum(line_expected)
    if expected_total <= available:
        durations = list(line_expected)
    else:
        reducible = sum(
            max(0.0, line_expected[i] - line_minimum[i])
            for i in range(len(line_tokens))
        )
        shortage = expected_total - available
        ratio = min(1.0, shortage / max(1e-9, reducible))
        durations = [
            line_expected[i]
            - (line_expected[i] - line_minimum[i]) * ratio
            for i in range(len(line_tokens))
        ]

    used = sum(durations)
    remaining = max(0.0, available - used)

    # Leave real pauses between written lines instead of inflating word
    # durations. Cap ordinary baseline gaps so a fallback line cannot wander
    # tens of seconds away from its neighbors. Any excess is distributed as
    # larger phrase breaks using activity quantiles below.
    gap_count = max(1, len(line_tokens) - 1)
    base_gap = min(1.15, remaining / gap_count) if len(line_tokens) > 1 else 0.0
    remaining -= base_gap * (len(line_tokens) - 1)

    # When there is still substantial unused time, distribute it only at a few
    # broad phrase boundaries inferred from activity gaps. This keeps the
    # baseline complete while preserving instrumental/breath sections.
    extra_gaps = [0.0] * max(0, len(line_tokens) - 1)
    if remaining > 1e-6 and extra_gaps:
        regions = _vocal_activity_regions(source, sample_rate, join_gap=0.55)
        pauses = []
        for left, right in zip(regions, regions[1:], strict=False):
            gap = max(0.0, right[0] - left[1])
            if gap >= 0.70:
                pauses.append((gap, (left[1] + right[0]) / 2.0))
        if pauses:
            # Map pause positions to approximate line boundaries using nominal
            # cumulative time, then spread leftover time across unique boundaries.
            nominal_total = max(1e-6, sum(durations))
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
                        (nominal_starts[idx] + durations[idx] + base_gap / 2.0)
                        - center
                    ),
                )
                candidate_boundaries[nearest] = max(
                    candidate_boundaries.get(nearest, 0.0),
                    gap,
                )
            total_weight = sum(candidate_boundaries.values())
            if total_weight > 0:
                for idx, weight in candidate_boundaries.items():
                    extra_gaps[idx] += remaining * weight / total_weight
                remaining = 0.0

        # No reliable activity pause: distribute leftover evenly. This is still
        # safe because every line already has a bounded physical duration.
        if remaining > 1e-6:
            share = remaining / len(extra_gaps)
            extra_gaps = [value + share for value in extra_gaps]

    line_windows: list[tuple[float, float]] = []
    cursor = active_start
    for index, duration_value in enumerate(durations):
        start = cursor
        end = min(active_end, start + duration_value)
        if end <= start + 0.039:
            # This should only happen with degenerate audio; use the full file
            # proportional fallback below instead of constructing invalid spans.
            return [
                Word(word.start, word.end, word.text, 0.005, word.index)
                for word in _proportional_words(all_tokens, duration_sec)
            ]
        line_windows.append((start, end))
        if index < len(line_tokens) - 1:
            cursor = end + base_gap + extra_gaps[index]

    # Numerical overflow protection: scale the complete baseline once, preserving
    # every line/gap ratio. Never collapse individual lines to micro durations.
    if line_windows and line_windows[-1][1] > active_end + 1e-6:
        origin = active_start
        total_span = line_windows[-1][1] - origin
        scale = (active_end - origin) / max(1e-9, total_span)
        if scale <= 0.0:
            return []
        scaled: list[tuple[float, float]] = []
        for start, end in line_windows:
            scaled.append(
                (
                    origin + (start - origin) * scale,
                    origin + (end - origin) * scale,
                )
            )
        line_windows = scaled

    output: list[Word] = []
    for line_index, tokens in enumerate(line_tokens):
        if not tokens:
            continue
        start, end = line_windows[line_index]
        token_weights = [max(1, len(token)) for token in tokens]
        total_weight = max(1, sum(token_weights))
        cursor_weight = 0
        for token, weight in zip(tokens, token_weights, strict=True):
            word_start = start + (end - start) * cursor_weight / total_weight
            cursor_weight += weight
            word_end = start + (end - start) * cursor_weight / total_weight
            if word_end <= word_start + 0.019:
                word_end = min(end, word_start + 0.02)
            if word_end <= word_start:
                return []
            output.append(
                Word(word_start, word_end, token, 0.008, len(output))
            )

    if len(output) != len(all_tokens):
        return []
    if any(
        right.start < left.end - 1e-6
        for left, right in zip(output, output[1:], strict=False)
    ):
        return []
    return output


def _atomic_line_acoustic_alignment(
    groups: list[str],
    ctc_lines,
    qwen_words: list[Word],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
    anchor_windows: dict[int, tuple[float, float, float]] | None = None,
) -> tuple[list[Word], dict[str, int]]:
    """Build a complete canonical timeline around whole acoustic lyric lines.

    CTC already aligns a complete canonical line. Treat that result as an atomic
    acoustic observation instead of clipping/re-matching its individual words
    against a separately estimated line window. Compatible acoustic lines are
    selected globally; only the missing line ranges are synthesized.
    """
    from difflib import SequenceMatcher

    line_tokens = [tokenize(group) for group in groups]
    canonical = [token for row in line_tokens for token in row]
    line_count = len(line_tokens)
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

    def norm(value: object) -> str:
        return re.sub(r"[^\w]+", "", str(value).casefold(), flags=re.UNICODE)

    def physical_word_minimum(token: str) -> float:
        chars = max(1, len(norm(token)))
        return max(0.075, min(0.42, 0.05 + 0.03 * chars))

    line_min = [
        max(
            0.12,
            _minimum_sung_phrase_duration(tokens),
            sum(physical_word_minimum(token) for token in tokens),
        )
        if tokens else 0.08
        for tokens in line_tokens
    ]
    line_expected = [
        max(line_min[i], _expected_sung_phrase_duration(tokens))
        for i, tokens in enumerate(line_tokens)
    ]
    line_max = [
        min(8.5, max(line_expected[i] * 2.25 + 0.35, line_min[i] * 2.8, 1.1))
        for i in range(line_count)
    ]
    line_gap_floor = 0.025

    # Candidate: line_index -> list[(words, source, priority)]
    candidates: dict[int, list[tuple[list[Word], str, float]]] = {}

    # Raw CTC results are already canonical full-line alignments. Validate only
    # their text/order/physics; do not rematch or clip individual words.
    raw_ctc_words = 0
    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= line_count:
            continue
        expected = line_tokens[line_index]
        actual = list(getattr(result, "words", ()) or ())
        raw_ctc_words += len(actual)
        if not expected or len(actual) != len(expected):
            continue
        if [norm(word.text) for word in actual] != [norm(token) for token in expected]:
            continue

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
                    max(0.0, min(1.0, float(word.confidence))),
                    local_index,
                )
            )
        if not valid or not words:
            continue
        if any(
            right.start < left.end - 0.015
            for left, right in zip(words, words[1:], strict=False)
        ):
            continue

        span = words[-1].end - words[0].start
        # Reject only physically impossible line results. A real sung line can
        # be substantially longer than the text-duration estimate.
        if span < line_min[line_index] * 0.65 or span > line_max[line_index] * 1.35:
            continue
        confidence = max(
            float(getattr(result, "confidence", 0.0) or 0.0),
            sum(word.confidence for word in words) / len(words),
        )
        priority = 10000.0 + 5000.0 * max(0.0, min(1.0, confidence))
        candidates.setdefault(line_index, []).append((words, "ctc", priority))

    # Secondary Qwen words may form a complete canonical line. Only complete
    # line matches are promoted to atomic anchors; partial Qwen output remains
    # merely fallback evidence and can never displace CTC.
    qwen = [word for word in (qwen_words or []) if norm(word.text)]
    if qwen:
        qnorm = [norm(word.text) for word in qwen]
        cnorm = [norm(token) for token in canonical]
        matcher = SequenceMatcher(None, qnorm, cnorm, autojunk=False)
        global_to_line: list[tuple[int, int]] = []
        for line_index, tokens in enumerate(line_tokens):
            for local_index in range(len(tokens)):
                global_to_line.append((line_index, local_index))

        per_line: dict[int, dict[int, Word]] = {}
        for block in matcher.get_matching_blocks():
            for delta in range(block.size):
                cidx = block.b + delta
                qidx = block.a + delta
                if 0 <= cidx < len(global_to_line):
                    li, local = global_to_line[cidx]
                    per_line.setdefault(li, {})[local] = qwen[qidx]

        for li, mapping in per_line.items():
            expected = line_tokens[li]
            if not expected or len(mapping) != len(expected):
                continue
            words = []
            for local in range(len(expected)):
                source_word = mapping[local]
                words.append(
                    Word(
                        max(0.0, float(source_word.start)),
                        min(duration_sec, float(source_word.end)),
                        expected[local],
                        max(0.0, min(1.0, float(source_word.confidence))),
                        local,
                    )
                )
            if any(
                right.start < left.end - 0.015
                for left, right in zip(words, words[1:], strict=False)
            ):
                continue
            span = words[-1].end - words[0].start
            if span < line_min[li] * 0.65 or span > line_max[li] * 1.35:
                continue
            mean_conf = sum(word.confidence for word in words) / len(words)
            candidates.setdefault(li, []).append(
                (words, "qwen", 1000.0 + 1000.0 * mean_conf)
            )

    # Flatten one best candidate per line (CTC always outranks Qwen).
    best: list[tuple[int, list[Word], str, float]] = []
    for li in sorted(candidates):
        words, kind, priority = max(candidates[li], key=lambda item: item[2])
        best.append((li, words, kind, priority))

    def skipped_minimum(left_line: int, right_line: int) -> float:
        if right_line <= left_line + 1:
            return line_gap_floor
        return (
            sum(line_min[idx] for idx in range(left_line + 1, right_line))
            + line_gap_floor * (right_line - left_line)
        )

    # Weighted monotonic chain over whole-line acoustic anchors.
    # A candidate is compatible only if every skipped canonical line can still
    # physically fit between the two observed line intervals.
    selected: list[tuple[int, list[Word], str, float]] = []
    if best:
        scores: list[float] = []
        prev: list[int] = []
        for pos, (li, words, kind, priority) in enumerate(best):
            best_score = priority
            best_prev = -1
            for ppos in range(pos):
                pli, pwords, pkind, ppriority = best[ppos]
                required = skipped_minimum(pli, li)
                if words[0].start < pwords[-1].end + required - 1e-6:
                    continue
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

    selected_by_line = {li: (words, kind, priority) for li, words, kind, priority in selected}

    active = _activity_quantile_times(source, sample_rate)
    active_start = max(0.0, float(active[0])) if active else 0.0
    active_end = min(duration_sec, float(active[-1])) if active else duration_sec
    if active_end <= active_start + 0.08:
        active_start, active_end = 0.0, duration_sec

    # Ensure edges have enough physical room. If a chosen edge anchor makes the
    # prefix/suffix impossible, drop only that edge anchor and retry selection.
    def edge_compatible(items):
        if not items:
            return True
        first_li, first_words, _kind, _priority = items[0]
        prefix_need = sum(line_min[:first_li]) + line_gap_floor * first_li
        if first_words[0].start < active_start + prefix_need - 1e-6:
            return False
        last_li, last_words, _kind, _priority = items[-1]
        suffix_need = sum(line_min[last_li + 1:]) + line_gap_floor * (line_count - last_li - 1)
        if active_end < last_words[-1].end + suffix_need - 1e-6:
            return False
        return True

    # Edge pruning is rare; recompute selected map after removing only offending
    # first/last anchors. Internal compatibility was already guaranteed by DP.
    while selected and not edge_compatible(selected):
        first_li, first_words, first_kind, first_priority = selected[0]
        last_li, last_words, last_kind, last_priority = selected[-1]
        prefix_need = sum(line_min[:first_li]) + line_gap_floor * first_li
        suffix_need = sum(line_min[last_li + 1:]) + line_gap_floor * (line_count - last_li - 1)
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

    # Fill a consecutive unanchored line range inside [left_time, right_time].
    def synthesize_range(
        begin_line: int,
        end_line: int,
        left_time: float,
        right_time: float,
    ) -> list[list[Word]] | None:
        indices = list(range(begin_line, end_line))
        if not indices:
            return []
        total_min = sum(line_min[i] for i in indices)
        gap_count = len(indices) + 1
        available = right_time - left_time
        required = total_min + line_gap_floor * gap_count
        if available < required - 1e-6:
            return None

        desired = [line_expected[i] for i in indices]
        desired_total = sum(desired)
        max_duration_budget = max(total_min, available - line_gap_floor * gap_count)
        if desired_total <= max_duration_budget:
            durations = desired
        else:
            reducible = sum(max(0.0, desired[k] - line_min[indices[k]]) for k in range(len(indices)))
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

            # Prefer activity-derived word placement only inside this bounded
            # line window. It may refine word distribution but cannot move the
            # line itself to another vocal island.
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
                for local_idx, word in enumerate(activity_words):
                    line_words.append(
                        Word(
                            cursor + word.start,
                            min(line_end, cursor + word.end),
                            tokens[local_idx],
                            0.020,
                            local_idx,
                        )
                    )
            else:
                local = _proportional_words(tokens, max(0.04, line_end - cursor))
                for local_idx, word in enumerate(local):
                    line_words.append(
                        Word(
                            cursor + word.start,
                            min(line_end, cursor + word.end),
                            tokens[local_idx],
                            0.008,
                            local_idx,
                        )
                    )
            if len(line_words) != len(tokens):
                return None
            result.append(line_words)
            cursor = line_end + gap
        return result

    line_results: list[list[Word] | None] = [None] * line_count

    # Copy acoustic anchor lines byte-for-byte in timing/confidence.
    for li, (words, kind, _priority) in selected_by_line.items():
        line_results[li] = [
            Word(word.start, word.end, line_tokens[li][idx], word.confidence, idx)
            for idx, word in enumerate(words)
        ]

    # Fill prefix, interior gaps and suffix.
    boundaries = [(-1, active_start, active_start)]
    for li, words, kind, priority in selected:
        boundaries.append((li, words[0].start, words[-1].end))
    boundaries.append((line_count, active_end, active_end))

    for bidx in range(len(boundaries) - 1):
        left_li, left_start, left_end = boundaries[bidx]
        right_li, right_start, right_end = boundaries[bidx + 1]
        begin = left_li + 1
        end = right_li
        if begin >= end:
            continue
        generated = synthesize_range(begin, end, left_end, right_start)
        if generated is None:
            # This should be prevented by chain compatibility. If numerical
            # rounding still makes the range impossible, use the known-good
            # physical canonical baseline for this range only.
            baseline = _lossless_canonical_alignment(
                groups, source, sample_rate, duration_sec, anchor_windows
            )
            if not _canonical_words_match(baseline, canonical):
                return [], {
                    "ctc": 0, "qwen": 0, "interpolated": 0,
                    "lines": line_count, "line_fallbacks": line_count,
                    "dropped_word_anchors": raw_ctc_words,
                    "atomic_ctc_lines": 0,
                }
            offsets = [0]
            for row in line_tokens:
                offsets.append(offsets[-1] + len(row))
            generated = []
            for li in range(begin, end):
                generated.append([
                    Word(w.start, w.end, w.text, w.confidence, idx)
                    for idx, w in enumerate(baseline[offsets[li]:offsets[li+1]])
                ])
        for li, line_words in zip(range(begin, end), generated, strict=True):
            line_results[li] = line_words

    output: list[Word] = []
    ctc_count = 0
    qwen_count = 0
    interpolated_count = 0
    ctc_lines_kept = 0
    qwen_lines_kept = 0
    for li, tokens in enumerate(line_tokens):
        line_words = line_results[li]
        if line_words is None or len(line_words) != len(tokens):
            return [], {
                "ctc": ctc_count,
                "qwen": qwen_count,
                "interpolated": interpolated_count,
                "lines": line_count,
                "line_fallbacks": line_count - ctc_lines_kept - qwen_lines_kept,
                "dropped_word_anchors": max(0, raw_ctc_words - ctc_count),
                "atomic_ctc_lines": ctc_lines_kept,
            }

        source_kind = selected_by_line.get(li, (None, "interpolated", 0.0))[1]
        if source_kind == "ctc":
            ctc_lines_kept += 1
            ctc_count += len(tokens)
        elif source_kind == "qwen":
            qwen_lines_kept += 1
            qwen_count += len(tokens)
        else:
            interpolated_count += len(tokens)

        for local_idx, word in enumerate(line_words):
            output.append(
                Word(
                    float(word.start),
                    float(word.end),
                    tokens[local_idx],
                    float(word.confidence),
                    len(output),
                )
            )

    if len(output) != len(canonical) or not _canonical_words_match(output, canonical):
        return [], {
            "ctc": ctc_count,
            "qwen": qwen_count,
            "interpolated": interpolated_count,
            "lines": line_count,
            "line_fallbacks": line_count - ctc_lines_kept - qwen_lines_kept,
            "dropped_word_anchors": max(0, raw_ctc_words - ctc_count),
            "atomic_ctc_lines": ctc_lines_kept,
        }
    if any(
        right.start < left.end - 1e-6
        for left, right in zip(output, output[1:], strict=False)
    ):
        return [], {
            "ctc": ctc_count,
            "qwen": qwen_count,
            "interpolated": interpolated_count,
            "lines": line_count,
            "line_fallbacks": line_count - ctc_lines_kept - qwen_lines_kept,
            "dropped_word_anchors": max(0, raw_ctc_words - ctc_count),
            "atomic_ctc_lines": ctc_lines_kept,
        }

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
    """Canonical lyric alignment with line-level timing as the primary invariant.

    Previous revisions merged all words into one global acoustic chain. A sparse
    pair of anchors could therefore make one written lyric line span many remote
    vocal islands. This merger first solves a monotonic window for every *line*,
    then preserves CTC/Qwen word anchors only inside that line and fills local
    holes. Inter-line silence is never consumed by words from the previous line.
    """
    from difflib import SequenceMatcher

    line_tokens = [tokenize(group) for group in groups]
    canonical = [token for row in line_tokens for token in row]
    if not canonical or duration_sec <= 0.04:
        return [], {
            "ctc": 0, "qwen": 0, "interpolated": 0,
            "lines": 0, "line_fallbacks": 0, "dropped_word_anchors": 0,
        }

    # Complete line-level safety map.  Acoustic alignment is allowed to improve
    # any line, but it is no longer allowed to make the whole song incomplete.
    # The baseline is canonical, monotonic and line-aware by construction.
    baseline_words = _lossless_canonical_alignment(
        groups,
        source,
        sample_rate,
        duration_sec,
        anchor_windows,
    )
    baseline_lines: list[list[Word]] = []
    baseline_offset = 0
    baseline_valid = _canonical_words_match(baseline_words, canonical)
    for tokens in line_tokens:
        count = len(tokens)
        baseline_lines.append(
            baseline_words[baseline_offset : baseline_offset + count]
            if baseline_valid else []
        )
        baseline_offset += count

    def norm(value: object) -> str:
        return re.sub(r"[^\w]+", "", str(value).casefold(), flags=re.UNICODE)

    def word_minimum(token: str) -> float:
        chars = max(1, len(norm(token)))
        return max(0.09, min(0.44, 0.055 + 0.034 * chars))

    line_minimum = [
        max(_minimum_sung_phrase_duration(tokens), sum(word_minimum(token) for token in tokens))
        if tokens else 0.08
        for tokens in line_tokens
    ]
    line_expected = [
        max(line_minimum[idx] * 1.15, _expected_sung_phrase_duration(tokens))
        for idx, tokens in enumerate(line_tokens)
    ]
    line_maximum = [
        min(
            8.0,
            max(
                line_minimum[idx] * 2.8,
                line_expected[idx] * 2.15 + 0.45,
                1.25,
            ),
        )
        for idx in range(len(line_tokens))
    ]

    offsets: list[int] = []
    cursor_index = 0
    for tokens in line_tokens:
        offsets.append(cursor_index)
        cursor_index += len(tokens)

    # Map raw CTC words directly to local canonical positions line by line.
    ctc_maps: list[dict[int, Word]] = [dict() for _ in line_tokens]
    ctc_line_quality: list[float] = [0.0] * len(line_tokens)
    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= len(line_tokens):
            continue
        expected = line_tokens[line_index]
        actual = list(getattr(result, "words", ()) or ())
        if not expected or not actual:
            continue
        expected_norm = [norm(token) for token in expected]
        actual_norm = [norm(word.text) for word in actual]
        quality = max(0.0, min(1.0, float(getattr(result, "confidence", 0.0) or 0.0)))
        ctc_line_quality[line_index] = quality
        matcher = SequenceMatcher(None, actual_norm, expected_norm, autojunk=False)
        for block in matcher.get_matching_blocks():
            for delta in range(block.size):
                local_index = block.b + delta
                word = actual[block.a + delta]
                if (
                    math.isfinite(float(word.start))
                    and math.isfinite(float(word.end))
                    and float(word.end) > float(word.start) + 0.009
                ):
                    ctc_maps[line_index][local_index] = Word(
                        max(0.0, float(word.start)),
                        min(duration_sec, float(word.end)),
                        expected[local_index],
                        max(0.0, min(1.0, float(word.confidence))),
                        local_index,
                    )

    # Map the already-published Qwen/local pass back to canonical positions.
    qwen_maps: list[dict[int, Word]] = [dict() for _ in line_tokens]
    qwen = [word for word in (qwen_words or []) if norm(word.text)]
    if qwen:
        canonical_norm = [norm(token) for token in canonical]
        qwen_norm = [norm(word.text) for word in qwen]
        matcher = SequenceMatcher(None, qwen_norm, canonical_norm, autojunk=False)
        global_to_line: list[tuple[int, int]] = []
        for line_index, tokens in enumerate(line_tokens):
            for local_index in range(len(tokens)):
                global_to_line.append((line_index, local_index))
        for block in matcher.get_matching_blocks():
            for delta in range(block.size):
                canonical_index = block.b + delta
                if 0 <= canonical_index < len(global_to_line):
                    line_index, local_index = global_to_line[canonical_index]
                    word = qwen[block.a + delta]
                    qwen_maps[line_index][local_index] = Word(
                        max(0.0, float(word.start)),
                        min(duration_sec, float(word.end)),
                        line_tokens[line_index][local_index],
                        max(0.0, min(1.0, float(word.confidence))),
                        local_index,
                    )

    active = _activity_quantile_times(source, sample_rate)
    active_start = max(0.0, float(active[0])) if active else 0.0
    active_end = min(duration_sec, float(active[-1])) if active else duration_sec
    if active_end <= active_start + 0.1:
        active_start, active_end = 0.0, duration_sec

    # One proposed start per line. CTC is strongest, then Qwen, then ASR.
    # ASR windows contain margins, so use their center rather than the left edge.
    proposals: dict[int, tuple[float, float, str]] = {}
    proposal_ends: dict[int, float] = {}
    anchors = anchor_windows or {}
    for line_index, tokens in enumerate(line_tokens):
        if not tokens:
            continue
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

    # Remove line-start anchors that make the written line sequence physically
    # impossible. This is line-level pruning, so a bad word anchor can never
    # stretch a neighboring line over 10-30 seconds.
    selected_proposals = dict(proposals)
    line_gap_floor = 0.055

    def required_between(left_index: int, right_index: int) -> float:
        # Time from start(left line) to start(right line).
        if right_index <= left_index:
            return 0.0
        return (
            sum(line_minimum[idx] for idx in range(left_index, right_index))
            + line_gap_floor * max(0, right_index - left_index)
        )

    changed = True
    while changed and selected_proposals:
        changed = False
        ordered = sorted(selected_proposals)
        for left_idx, right_idx in zip(ordered, ordered[1:], strict=False):
            left_start, left_priority, left_kind = selected_proposals[left_idx]
            right_start, right_priority, right_kind = selected_proposals[right_idx]
            if right_start + 1e-6 >= left_start + required_between(left_idx, right_idx):
                continue
            # Drop weaker evidence. CTC line anchors are only removed when they
            # are the weaker of two conflicting CTC lines.
            if left_priority < right_priority:
                selected_proposals.pop(left_idx, None)
            elif right_priority < left_priority:
                selected_proposals.pop(right_idx, None)
            else:
                selected_proposals.pop(right_idx, None)
            changed = True
            break

    # Add stable song-edge sentinels and generate line starts piecewise. Extra
    # room becomes inter-line silence rather than inflating individual lines.
    fixed: dict[int, float] = {-1: active_start, len(line_tokens): active_end}
    for index, (start, _priority, _kind) in selected_proposals.items():
        fixed[index] = max(active_start, min(active_end, start))

    fixed_items = sorted(fixed.items())
    line_starts: list[float | None] = [None] * len(line_tokens)

    for pair_index in range(len(fixed_items) - 1):
        left_index, left_time = fixed_items[pair_index]
        right_index, right_time = fixed_items[pair_index + 1]
        begin = left_index + 1
        end = right_index
        if left_index >= 0:
            line_starts[left_index] = left_time

        missing = list(range(begin, end))
        if not missing:
            continue

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
        required = (
            sum(line_minimum[idx] for idx in missing)
            + line_gap_floor * max(0, len(missing) - 1)
        )
        if segment_end < segment_start + required:
            # A surviving fixed line still leaves too little room at a song
            # edge. Compress only towards physical minima; never below them.
            segment_start = max(active_start, segment_end - required)

        target_durations = [line_expected[idx] for idx in missing]
        target_total = sum(target_durations)
        available = max(required, segment_end - segment_start)
        duration_budget = min(target_total, max(sum(line_minimum[idx] for idx in missing), available * 0.82))
        scale = min(1.0, duration_budget / max(1e-6, target_total))
        durations = [
            max(line_minimum[idx], line_expected[idx] * scale)
            for idx in missing
        ]
        used = sum(durations)
        silence = max(0.0, available - used)
        gap = silence / max(1, len(missing) + 1)

        cursor = segment_start + gap
        for local_pos, line_index in enumerate(missing):
            line_starts[line_index] = cursor
            cursor += durations[local_pos] + gap

    # Fill any unresolved line start defensively from its predecessor.
    cursor = active_start
    for line_index in range(len(line_tokens)):
        start = line_starts[line_index]
        if start is None:
            start = cursor
            line_starts[line_index] = start
        start = max(cursor, float(start))
        line_starts[line_index] = start
        cursor = start + line_minimum[line_index] + line_gap_floor

    # Compute bounded line ends. A strong CTC/Qwen last-word end may extend the
    # window, but never into the next line and never beyond a sane line maximum.
    line_windows: list[tuple[float, float]] = []
    for line_index, tokens in enumerate(line_tokens):
        start = max(0.0, min(duration_sec, float(line_starts[line_index])))
        next_start = (
            max(start + line_minimum[line_index], float(line_starts[line_index + 1]))
            if line_index + 1 < len(line_tokens)
            else active_end
        )
        if line_index + 1 < len(line_tokens):
            boundary_span = max(0.0, next_start - start)
            boundary_pad = _clamp_timing(boundary_span * 0.005, 0.008, 0.05)
            hard_end = min(duration_sec, next_start - boundary_pad)
        else:
            hard_end = min(duration_sec, active_end)
        target_end = start + min(line_maximum[line_index], line_expected[line_index] * 1.20)

        evidence_ends: list[tuple[float, float]] = []
        if ctc_maps[line_index]:
            evidence_ends.append((
                max(word.end for word in ctc_maps[line_index].values()),
                3.0,
            ))
        if qwen_maps[line_index]:
            evidence_ends.append((
                max(word.end for word in qwen_maps[line_index].values()),
                2.0,
            ))
        if anchors.get(line_index):
            _a, anchor_end, score = anchors[line_index]
            if score >= 0.25:
                evidence_ends.append((float(anchor_end), 1.0))

        for evidence_end, _strength in evidence_ends:
            if (
                evidence_end >= start + line_minimum[line_index] * 0.75
                and evidence_end <= start + line_maximum[line_index]
            ):
                target_end = max(target_end, evidence_end)

        end = min(hard_end, target_end)
        if end < start + line_minimum[line_index]:
            end = min(duration_sec, start + line_minimum[line_index])
        if end <= start + 0.05:
            end = min(duration_sec, start + max(0.08, line_minimum[line_index]))
        line_windows.append((start, end))

    stats = {
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
        if not tokens:
            return [], {"ctc": 0, "qwen": 0, "interpolated": 0, "dropped": 0}
        if start >= duration_sec - 0.019 or end <= start + 0.019:
            return [], {"ctc": 0, "qwen": 0, "interpolated": 0, "dropped": 0}

        candidates: dict[int, tuple[Word, str, float]] = {}
        for local_index, word in ctc_maps[line_index].items():
            if word.end >= start - 0.20 and word.start <= end + 0.20:
                candidates[local_index] = (word, "ctc", 1000.0 + 500.0 * word.confidence)
        for local_index, word in qwen_maps[line_index].items():
            if local_index in candidates:
                continue
            if word.end >= start - 0.20 and word.start <= end + 0.20:
                candidates[local_index] = (word, "qwen", 100.0 + 100.0 * word.confidence)

        # Clip tiny frame-level overshoot to the local line window only.
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

        def min_span(begin: int, finish: int) -> float:
            return sum(word_minimum(tokens[idx]) for idx in range(begin, finish))

        # Iteratively remove only a conflicting weak word anchor. Never fail the
        # whole line and never affect a neighboring lyric line.
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

            # Prefix/suffix must also have enough physical room.
            if conflict is None and ordered_indices:
                first = ordered_indices[0]
                if candidates[first][0].start < start + min_span(0, first) - 1e-6:
                    conflict = (first, first)
                else:
                    last = ordered_indices[-1]
                    if end < candidates[last][0].end + min_span(last + 1, len(tokens)) - 1e-6:
                        conflict = (last, last)

            if conflict is None:
                break
            left_idx, right_idx = conflict
            if left_idx == right_idx:
                drop_idx = left_idx
            else:
                left = candidates[left_idx]
                right = candidates[right_idx]
                if left[1] != right[1]:
                    drop_idx = left_idx if left[1] == "qwen" else right_idx
                elif left[2] != right[2]:
                    drop_idx = left_idx if left[2] < right[2] else right_idx
                else:
                    drop_idx = right_idx
            candidates.pop(drop_idx, None)
            dropped += 1
            if not candidates:
                break

        result: list[Word | None] = [None] * len(tokens)
        kinds: list[str | None] = [None] * len(tokens)
        for local_index, (word, kind, _priority) in candidates.items():
            result[local_index] = Word(
                word.start, word.end, tokens[local_index], word.confidence, local_index
            )
            kinds[local_index] = kind

        # When no trustworthy word anchor survives, use acoustic activity inside
        # *this line window only*. This keeps a lyric phrase coherent.
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
                        "ctc": 0, "qwen": 0,
                        "interpolated": len(tokens), "dropped": dropped,
                    }

        # Fill only local gaps between local anchors.
        position = 0
        while position < len(tokens):
            if result[position] is not None:
                position += 1
                continue
            run_start = position
            while position < len(tokens) and result[position] is None:
                position += 1
            run_end = position
            left_word = result[run_start - 1] if run_start > 0 else None
            right_word = result[run_end] if run_end < len(tokens) else None
            left_time = left_word.end if left_word is not None else start
            right_time = right_word.start if right_word is not None else end
            minima = [word_minimum(tokens[idx]) for idx in range(run_start, run_end)]
            minimum_total = sum(minima)
            if right_time < left_time + minimum_total - 1e-6:
                # This can only happen after a numerical edge case: abandon word
                # anchors for this one line, not the whole song.
                available = max(0.0, min(end, duration_sec) - start)
                if available < 0.04:
                    return [], {
                        "ctc": 0, "qwen": 0,
                        "interpolated": 0, "dropped": dropped + len(candidates),
                    }
                local = _proportional_words(tokens, available)
                rebuilt: list[Word] = []
                for idx, word in enumerate(local):
                    word_start = start + word.start
                    word_end = min(duration_sec, start + word.end)
                    if word_start >= duration_sec - 0.009 or word_end <= word_start + 0.009:
                        return [], {
                            "ctc": 0, "qwen": 0,
                            "interpolated": 0, "dropped": dropped + len(candidates),
                        }
                    rebuilt.append(
                        Word(word_start, word_end, tokens[idx], 0.010, idx)
                    )
                return rebuilt, {
                    "ctc": 0, "qwen": 0,
                    "interpolated": len(tokens), "dropped": dropped + len(candidates),
                }

            extra = max(0.0, (right_time - left_time) - minimum_total)
            weights = [max(1.0, float(len(norm(tokens[idx])))) for idx in range(run_start, run_end)]
            weight_total = max(1.0, sum(weights))
            cursor = left_time
            for local_index, minimum, weight in zip(
                range(run_start, run_end), minima, weights, strict=True
            ):
                duration = minimum + extra * weight / weight_total
                word_end = min(right_time, cursor + duration)
                result[local_index] = Word(
                    cursor,
                    max(cursor + 0.02, word_end),
                    tokens[local_index],
                    0.012,
                    local_index,
                )
                kinds[local_index] = "interpolated"
                cursor = word_end

        final = [word for word in result if word is not None]
        if len(final) != len(tokens):
            return [], {"ctc": 0, "qwen": 0, "interpolated": 0, "dropped": dropped}

        # Final per-line invariants: no remote-island scatter, no micro words,
        # no backwards overlap and no absurdly long line span.
        span = final[-1].end - final[0].start
        monotonic = all(
            right.start >= left.end - 1e-6
            for left, right in zip(final, final[1:], strict=False)
        )
        micro = any(
            (word.end - word.start) < min(0.075, word_minimum(word.text) * 0.60)
            for word in final
        )
        interior_gap = max(
            [right.start - left.end for left, right in zip(final, final[1:], strict=False)]
            or [0.0]
        )
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
                "ctc": 0, "qwen": 0,
                "interpolated": len(tokens), "dropped": dropped + len(candidates),
            }

        return final, {
            "ctc": sum(kind == "ctc" for kind in kinds),
            "qwen": sum(kind == "qwen" for kind in kinds),
            "interpolated": sum(kind == "interpolated" for kind in kinds),
            "dropped": dropped,
        }

    def baseline_line_for(
        line_index: int,
        previous_end: float,
        hard_end: float,
    ) -> list[Word]:
        """Return one complete fallback line without touching accepted lines."""
        tokens = line_tokens[line_index]
        source_line = baseline_lines[line_index] if line_index < len(baseline_lines) else []
        if len(source_line) == len(tokens):
            source_start = source_line[0].start
            source_end = source_line[-1].end
            source_span = max(0.04, source_end - source_start)
            start = max(previous_end + (0.015 if previous_end > 0 else 0.0), source_start)
            end_limit = min(duration_sec, max(start + 0.04, hard_end))
            available = end_limit - start
            if available >= 0.04:
                target_span = min(source_span, available)
                # Preserve the baseline's internal relative word durations.
                rebuilt: list[Word] = []
                for local_index, word in enumerate(source_line):
                    rel_start = (word.start - source_start) / source_span
                    rel_end = (word.end - source_start) / source_span
                    word_start = start + target_span * rel_start
                    word_end = start + target_span * rel_end
                    if word_end <= word_start + 0.009:
                        word_end = min(end_limit, word_start + 0.01)
                    if word_end <= word_start:
                        return []
                    rebuilt.append(
                        Word(
                            word_start,
                            min(end_limit, word_end),
                            tokens[local_index],
                            0.008,
                            local_index,
                        )
                    )
                if len(rebuilt) == len(tokens):
                    return rebuilt

        # Absolute per-line fallback inside the line window.
        start = max(
            previous_end + (0.015 if previous_end > 0 else 0.0),
            line_windows[line_index][0],
        )
        end = min(duration_sec, max(start + 0.04, hard_end))
        available = end - start
        if available < 0.04:
            return []
        local = _proportional_words(tokens, available)
        result: list[Word] = []
        for local_index, word in enumerate(local):
            word_start = start + word.start
            word_end = min(end, start + word.end)
            if word_end <= word_start + 0.009:
                return []
            result.append(
                Word(word_start, word_end, tokens[local_index], 0.008, local_index)
            )
        return result


    accepted_line_stats: list[dict[str, int]] = []

    def complete_with_baseline_tail(next_line_index: int) -> tuple[list[Word], dict[str, int]]:
        """Keep the longest safe acoustic prefix and replace only the tail.

        A late impossible line must never erase acoustic anchors accepted for
        earlier lines. Walk backwards over line boundaries until the canonical
        baseline tail fits after the retained acoustic prefix.
        """
        if not baseline_valid:
            return [], stats

        line_offsets = [0]
        for row in line_tokens:
            line_offsets.append(line_offsets[-1] + len(row))

        max_cut = min(next_line_index, len(accepted_line_stats), len(line_tokens))
        for cut in range(max_cut, -1, -1):
            prefix_count = line_offsets[cut]
            prefix = output[:prefix_count]
            tail = baseline_words[prefix_count:]
            if not tail:
                rebuilt = [
                    Word(w.start, w.end, w.text, w.confidence, i)
                    for i, w in enumerate(prefix)
                ]
            else:
                if prefix and tail[0].start < prefix[-1].end + 0.015:
                    continue
                rebuilt = [
                    Word(w.start, w.end, w.text, w.confidence, i)
                    for i, w in enumerate(prefix + tail)
                ]

            if len(rebuilt) != len(canonical):
                continue
            if not _canonical_words_match(rebuilt, canonical):
                continue
            if any(
                right.start < left.end - 1e-6
                for left, right in zip(rebuilt, rebuilt[1:], strict=False)
            ):
                continue

            kept_stats = accepted_line_stats[:cut]
            ctc_count = sum(int(item.get("ctc", 0)) for item in kept_stats)
            qwen_count = sum(int(item.get("qwen", 0)) for item in kept_stats)
            interpolated_count = (
                sum(int(item.get("interpolated", 0)) for item in kept_stats)
                + sum(len(row) for row in line_tokens[cut:])
            )
            dropped_count = sum(int(item.get("dropped", 0)) for item in kept_stats)
            return rebuilt, {
                **stats,
                "ctc": ctc_count,
                "qwen": qwen_count,
                "interpolated": interpolated_count,
                "dropped_word_anchors": dropped_count,
                "line_fallbacks": int(stats.get("line_fallbacks", 0)) + (len(line_tokens) - cut),
                "tail_rollback_from_line": cut,
            }

        return baseline_words, {
            **stats,
            "ctc": 0,
            "qwen": 0,
            "interpolated": len(canonical),
            "line_fallbacks": int(stats.get("line_fallbacks", 0)) + len(line_tokens),
            "tail_rollback_from_line": 0,
        }

    for line_index, (start, end) in enumerate(line_windows):
        tokens = line_tokens[line_index]
        if not tokens:
            continue
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
            if len(line) != len(tokens):
                # Do not abort an otherwise usable acoustic alignment. The
                # complete canonical baseline will be used below as the final
                # song-level safety net.
                return complete_with_baseline_tail(line_index)
            line_stats = {
                "ctc": 0, "qwen": 0,
                "interpolated": len(tokens), "dropped": 0,
            }

        # Keep lines monotonic without changing their internal acoustic structure.
        if output and line[0].start < output[-1].end:
            shift = output[-1].end - line[0].start + 0.015
            if line[-1].end + shift <= duration_sec and shift <= 0.30:
                line = [
                    Word(
                        word.start + shift,
                        word.end + shift,
                        word.text,
                        word.confidence,
                        word.index,
                    )
                    for word in line
                ]
            else:
                # Rebuild just this line after the previous line, never retime
                # previously accepted acoustic lines.
                new_start = output[-1].end + 0.02
                remaining = duration_sec - new_start
                if remaining <= 0.04:
                    return complete_with_baseline_tail(line_index)
                available = min(
                    line_maximum[line_index],
                    max(0.04, min(line_minimum[line_index], remaining)),
                )
                local = _proportional_words(tokens, available)
                line = [
                    Word(
                        new_start + word.start,
                        min(duration_sec, new_start + word.end),
                        token,
                        0.009,
                        idx,
                    )
                    for idx, (word, token) in enumerate(zip(local, tokens, strict=True))
                    if new_start + word.start < duration_sec
                ]
                if len(line) != len(tokens):
                    previous_end = output[-1].end if output else 0.0
                    hard_end = (
                        line_windows[line_index + 1][0] - 0.02
                        if line_index + 1 < len(line_windows)
                        else duration_sec
                    )
                    line = baseline_line_for(line_index, previous_end, hard_end)
                    if len(line) != len(tokens):
                        return complete_with_baseline_tail(line_index)
                line_stats = {
                    "ctc": 0, "qwen": 0,
                    "interpolated": len(tokens), "dropped": line_stats.get("dropped", 0),
                }
                stats["line_fallbacks"] += 1

        for local_index, word in enumerate(line):
            output.append(
                Word(
                    word.start,
                    min(duration_sec, word.end),
                    tokens[local_index],
                    word.confidence,
                    len(output),
                )
            )
        stats["ctc"] += int(line_stats.get("ctc", 0))
        stats["qwen"] += int(line_stats.get("qwen", 0))
        stats["interpolated"] += int(line_stats.get("interpolated", 0))
        stats["dropped_word_anchors"] += int(line_stats.get("dropped", 0))
        accepted_line_stats.append({
            "ctc": int(line_stats.get("ctc", 0)),
            "qwen": int(line_stats.get("qwen", 0)),
            "interpolated": int(line_stats.get("interpolated", 0)),
            "dropped": int(line_stats.get("dropped", 0)),
        })

    if len(output) != len(canonical) or not _canonical_words_match(output, canonical):
        return complete_with_baseline_tail(len(accepted_line_stats))
    if any(
        right.start < left.end - 1e-6
        for left, right in zip(output, output[1:], strict=False)
    ):
        return complete_with_baseline_tail(len(accepted_line_stats))

    return output, stats


def _anchor_preserving_canonical_alignment(
    groups: list[str],
    ctc_lines,
    qwen_words: list[Word],
    source: np.ndarray,
    sample_rate: int,
    duration_sec: float,
) -> tuple[list[Word], dict[str, int]]:
    """Build a complete canonical timeline while preserving acoustic anchors.

    Raw CTC line results are mapped directly to canonical token indices.
    Surviving CTC/Qwen anchors are kept whenever physically possible.  If two
    anchors leave too little room for the canonical words between them, only the
    weaker conflicting anchor is discarded and the merge is retried.  Missing
    words are then interpolated *only* inside the remaining gaps.
    """
    from difflib import SequenceMatcher

    line_tokens = [tokenize(group) for group in groups]
    tokens = [token for row in line_tokens for token in row]
    if not tokens or duration_sec <= 0.04:
        return [], {"ctc": 0, "qwen": 0, "interpolated": 0}

    def normalize(value: object) -> str:
        return re.sub(r"[^\w]+", "", str(value).casefold(), flags=re.UNICODE)

    normalized_tokens = [normalize(token) for token in tokens]
    offsets: list[int] = []
    offset = 0
    for row in line_tokens:
        offsets.append(offset)
        offset += len(row)

    # idx -> (word, source, priority)
    candidates: dict[int, tuple[Word, str, float]] = {}

    def add_candidate(idx: int, word: Word, kind: str, source_quality: float | None = None) -> None:
        if idx < 0 or idx >= len(tokens):
            return
        start = float(word.start)
        end = float(word.end)
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0.0
            or end <= start + 0.009
            or end > duration_sec + 0.10
        ):
            return
        confidence = max(0.0, min(1.0, float(getattr(word, "confidence", 0.0) or 0.0)))
        quality = confidence if source_quality is None else max(
            confidence, max(0.0, min(1.0, float(source_quality)))
        )
        priority = (100.0 + 900.0 * quality) if kind == "ctc" else (10.0 + 90.0 * quality)
        existing = candidates.get(idx)
        if existing is None or priority > existing[2]:
            candidates[idx] = (
                Word(start, min(duration_sec, end), tokens[idx], confidence, idx),
                kind,
                priority,
            )

    # Direct canonical mapping from raw CTC line results.
    for line_index, result in enumerate(ctc_lines or []):
        if result is None or line_index >= len(line_tokens):
            continue
        expected = line_tokens[line_index]
        base = offsets[line_index]
        words = list(getattr(result, "words", ()) or ())
        if not words or not expected:
            continue
        actual_norm = [normalize(word.text) for word in words]
        expected_norm = [normalize(token) for token in expected]
        line_quality = float(getattr(result, "confidence", 0.0) or 0.0)
        if len(words) == len(expected) and actual_norm == expected_norm:
            for local_idx, word in enumerate(words):
                add_candidate(base + local_idx, word, "ctc", line_quality)
            continue
        matcher = SequenceMatcher(None, actual_norm, expected_norm, autojunk=False)
        for block in matcher.get_matching_blocks():
            for delta in range(block.size):
                add_candidate(base + block.b + delta, words[block.a + delta], "ctc", line_quality)

    # Secondary Qwen/output anchors fill only canonical positions that do not
    # already have CTC evidence.
    secondary = [word for word in (qwen_words or []) if normalize(word.text)]
    if secondary:
        secondary_norm = [normalize(word.text) for word in secondary]
        matcher = SequenceMatcher(None, secondary_norm, normalized_tokens, autojunk=False)
        for block in matcher.get_matching_blocks():
            for delta in range(block.size):
                idx = block.b + delta
                if idx in candidates and candidates[idx][1] == "ctc":
                    continue
                add_candidate(idx, secondary[block.a + delta], "qwen")

    if not candidates:
        return [], {"ctc": 0, "qwen": 0, "interpolated": 0}

    def minimum_word_span(token: str) -> float:
        """Conservative physical lower bound for a sung word.

        The previous 20 ms/word guard allowed whole lyric phrases to collapse
        between neighboring acoustic anchors.  This bound is deliberately
        conservative (fast singing is still allowed) but rejects physically
        impossible 20-80 ms word streams.
        """
        chars = max(1, len(normalize(token)))
        return max(0.10, min(0.48, 0.065 + 0.038 * chars))

    def minimum_run_span(begin: int, end: int) -> float:
        return sum(minimum_word_span(tokens[pos]) for pos in range(begin, end))

    anchor_boundary_tolerance = 0.22
    anchor_min_duration = 0.055

    # First choose a monotonic high-value chain.
    ordered = sorted(candidates.items())
    min_gap_per_missing_word = 0.035
    dp_score: list[float] = []
    dp_prev: list[int] = []
    for pos, (idx, (word, _kind, priority)) in enumerate(ordered):
        best_score = priority
        best_prev = -1
        for prev_pos in range(pos):
            prev_idx, (prev_word, _prev_kind, _prev_priority) = ordered[prev_pos]
            missing = max(0, idx - prev_idx - 1)
            required = minimum_run_span(prev_idx + 1, idx) if missing else 0.0
            shortage = (prev_word.end + required) - word.start
            if shortage > (anchor_boundary_tolerance * 2.0) + 1e-6:
                continue
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

    # Prefer real song bounds for edge interpolation. Activity is useful as a
    # hint, but must never make a full canonical stream impossible to place.
    active = _activity_quantile_times(source, sample_rate)
    active_start = max(0.0, float(active[0])) if active else 0.0
    active_end = min(duration_sec, float(active[-1])) if active else duration_sec
    if active_end <= active_start + 0.08:
        active_start, active_end = 0.0, duration_sec

    activity_regions = _vocal_activity_regions(source, sample_rate, join_gap=0.45)

    def nudge_conflicting_pair(left_idx: int, right_idx: int, required_gap: float) -> bool:
        """Recover a tight gap by trimming only acoustic anchor boundaries.

        CTC gives useful acoustic locations, but frame-level word boundaries are
        not sacred to the millisecond.  Before dropping an anchor, allow a small
        inward boundary adjustment while keeping the anchor's center/order and
        confidence intact.
        """
        if left_idx not in selected or right_idx not in selected:
            return False
        left_word, left_kind, left_priority = selected[left_idx]
        right_word, right_kind, right_priority = selected[right_idx]
        shortage = (left_word.end + required_gap) - right_word.start
        if shortage <= 1e-6:
            return True

        left_room = min(
            anchor_boundary_tolerance,
            max(0.0, (left_word.end - left_word.start) - anchor_min_duration),
        )
        right_room = min(
            anchor_boundary_tolerance,
            max(0.0, (right_word.end - right_word.start) - anchor_min_duration),
        )
        if shortage > left_room + right_room + 1e-6:
            return False

        # Prefer changing the lower-priority boundary first; for equal anchors
        # split the correction so neither acoustic word is distorted too much.
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

        if trim_left > left_room + 1e-6 or trim_right > right_room + 1e-6:
            return False

        selected[left_idx] = (
            Word(
                left_word.start,
                max(left_word.start + anchor_min_duration, left_word.end - trim_left),
                left_word.text,
                left_word.confidence,
                left_word.index,
            ),
            left_kind,
            left_priority,
        )
        selected[right_idx] = (
            Word(
                min(right_word.end - anchor_min_duration, right_word.start + trim_right),
                right_word.end,
                right_word.text,
                right_word.confidence,
                right_word.index,
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
        """Place a long missing lyric run into real vocal islands.

        Wall-clock interpolation across a multi-second breath/instrumental gap
        makes karaoke words crawl through silence.  Partition the canonical words
        across active vocal regions instead; silence remains between word groups.
        """
        count = run_end - run_start
        if count <= 0:
            return []
        wall_span = right_time - left_time
        minimum_span = minimum_run_span(run_start, run_end)
        if wall_span < max(2.4, minimum_span * 2.25):
            return None

        regions = []
        for start, end in activity_regions:
            start = max(left_time, float(start))
            end = min(right_time, float(end))
            if end - start >= 0.10:
                regions.append((start, end))
        if len(regions) < 2:
            return None

        minima = [minimum_word_span(tokens[pos]) for pos in range(run_start, run_end)]
        capacities = [end - start for start, end in regions]
        if sum(capacities) + 1e-6 < sum(minima):
            return None

        # Dynamic partition: assign consecutive words to consecutive vocal
        # regions while respecting each region's physical capacity.
        prefix = [0.0]
        for value in minima:
            prefix.append(prefix[-1] + value)
        total_capacity = max(1e-9, sum(capacities))
        states: dict[int, tuple[float, list[int]]] = {0: (0.0, [])}
        for region_index, capacity in enumerate(capacities):
            next_states: dict[int, tuple[float, list[int]]] = {}
            target_fraction = capacity / total_capacity
            for token_index, (cost, allocation) in states.items():
                remaining = count - token_index
                for take in range(0, remaining + 1):
                    needed = prefix[token_index + take] - prefix[token_index]
                    if needed > capacity + 1e-6:
                        break
                    if region_index == len(capacities) - 1 and take != remaining:
                        continue
                    fraction = take / max(1, count)
                    new_cost = cost + (fraction - target_fraction) ** 2
                    end_index = token_index + take
                    previous = next_states.get(end_index)
                    if previous is None or new_cost < previous[0]:
                        next_states[end_index] = (new_cost, allocation + [take])
            states = next_states
            if not states:
                return None

        final_state = states.get(count)
        if final_state is None:
            return None
        allocation = final_state[1]

        output: list[Word] = []
        token_index = run_start
        for (region_start, region_end), take in zip(regions, allocation, strict=True):
            if take <= 0:
                continue
            positions = list(range(token_index, token_index + take))
            local_minima = [minimum_word_span(tokens[pos]) for pos in positions]
            minimum_total = sum(local_minima)
            extra = max(0.0, (region_end - region_start) - minimum_total)
            weights = [max(1.0, float(len(normalize(tokens[pos])))) for pos in positions]
            total_weight = max(1.0, sum(weights))
            cursor = region_start
            for pos, minimum, weight in zip(positions, local_minima, weights, strict=True):
                duration = minimum + extra * weight / total_weight
                end = min(region_end, cursor + duration)
                output.append(Word(cursor, end, tokens[pos], 0.018, pos))
                cursor = end
            token_index += take

        return output if len(output) == count else None

    def weaker_anchor(left_idx: int, right_idx: int) -> int:
        """Return the weaker conflicting anchor index.

        Qwen is always weaker than CTC. Between equal sources, lower priority
        (confidence) loses. Ties prefer dropping the later anchor because that
        preserves already established earlier chronology.
        """
        left_word, left_kind, left_priority = selected[left_idx]
        right_word, right_kind, right_priority = selected[right_idx]
        if left_kind != right_kind:
            return left_idx if left_kind == "qwen" else right_idx
        if abs(left_priority - right_priority) > 1e-9:
            return left_idx if left_priority < right_priority else right_idx
        return right_idx

    def try_build() -> tuple[list[Word] | None, tuple[int, int] | None]:
        result: list[Word | None] = [None] * len(tokens)
        source_kind: list[str | None] = [None] * len(tokens)
        for idx, (word, kind, _priority) in selected.items():
            result[idx] = Word(word.start, word.end, tokens[idx], word.confidence, idx)
            source_kind[idx] = kind

        # Detect direct overlaps and impossible internal gaps before filling.
        anchor_indices = sorted(selected)
        for left_idx, right_idx in zip(anchor_indices, anchor_indices[1:], strict=False):
            left_word = result[left_idx]
            right_word = result[right_idx]
            if left_word is None or right_word is None:
                continue
            missing = right_idx - left_idx - 1
            required = minimum_run_span(left_idx + 1, right_idx) if missing > 0 else 0.0
            if right_word.start < left_word.end + required - 1e-6:
                if nudge_conflicting_pair(left_idx, right_idx, required):
                    # Selected anchors changed; restart the build with the
                    # adjusted acoustic boundaries.
                    return None, (-1, -1)
                return None, (left_idx, right_idx)

        index = 0
        while index < len(tokens):
            if result[index] is not None:
                index += 1
                continue
            run_start = index
            while index < len(tokens) and result[index] is None:
                index += 1
            run_end = index
            count = run_end - run_start
            left_idx = run_start - 1 if run_start > 0 else None
            right_idx = run_end if run_end < len(tokens) else None
            left_word = result[left_idx] if left_idx is not None else None
            right_word = result[right_idx] if right_idx is not None else None

            left_time = float(left_word.end) if left_word is not None else 0.0
            right_time = float(right_word.start) if right_word is not None else duration_sec

            # At song edges, activity narrows the region only if there is still
            # sufficient room for all missing canonical words.
            minimum_span = minimum_run_span(run_start, run_end)
            if left_word is None:
                hinted = max(0.0, active_start)
                if right_time - hinted >= minimum_span:
                    left_time = hinted
            if right_word is None:
                hinted = min(duration_sec, active_end)
                if hinted - left_time >= minimum_span:
                    right_time = hinted

            if right_time < left_time + minimum_span - 1e-6:
                if left_idx is not None and right_idx is not None:
                    return None, (left_idx, right_idx)
                # Edge case: one anchor itself leaves no room for the prefix or
                # suffix. Drop that edge anchor on the next retry.
                if right_idx is not None:
                    return None, (right_idx, right_idx)
                if left_idx is not None:
                    return None, (left_idx, left_idx)
                return None, None

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
                minima = [minimum_word_span(tokens[pos]) for pos in range(run_start, run_end)]
                minimum_total = sum(minima)
                extra = max(0.0, (right_time - left_time) - minimum_total)
                lexical_weights = [
                    max(1.0, float(len(normalize(tokens[pos]))))
                    for pos in range(run_start, run_end)
                ]
                lexical_total = max(1.0, sum(lexical_weights))
                cursor_time = left_time
                for pos, minimum, weight in zip(
                    range(run_start, run_end),
                    minima,
                    lexical_weights,
                    strict=True,
                ):
                    duration = minimum + extra * weight / lexical_total
                    start = cursor_time
                    end = min(right_time, start + duration)
                    if end <= start + 0.009:
                        end = min(right_time, start + 0.01)
                    result[pos] = Word(
                        start,
                        min(duration_sec, end),
                        tokens[pos],
                        0.012,
                        pos,
                    )
                    source_kind[pos] = "interpolated"
                    cursor_time = end

        final = [word for word in result if word is not None]
        if len(final) != len(tokens):
            return None, None
        for pos, (left, right) in enumerate(zip(final, final[1:], strict=False)):
            if right.start < left.end - 1e-6:
                left_idx = pos if pos in selected else None
                right_idx = pos + 1 if (pos + 1) in selected else None
                if left_idx is not None and right_idx is not None:
                    return None, (left_idx, right_idx)
                return None, None
        return final, None

    # Iteratively prune only conflicting anchors until the remaining chain can
    # support every canonical word. This guarantees a complete monotonic result
    # while retaining as much real acoustic timing as physically possible.
    max_retries = len(selected) + 2
    for _ in range(max_retries):
        built, conflict = try_build()
        if built is not None:
            kinds = []
            for idx in range(len(tokens)):
                if idx in selected:
                    kinds.append(selected[idx][1])
                else:
                    kinds.append("interpolated")
            return built, {
                "ctc": sum(1 for kind in kinds if kind == "ctc"),
                "qwen": sum(1 for kind in kinds if kind == "qwen"),
                "interpolated": sum(1 for kind in kinds if kind == "interpolated"),
            }

        if not selected:
            break
        if conflict is None:
            # Defensive fallback: remove the globally weakest anchor.
            drop_idx = min(
                selected,
                key=lambda idx: (
                    0 if selected[idx][1] == "qwen" else 1,
                    selected[idx][2],
                ),
            )
        else:
            left_idx, right_idx = conflict
            if left_idx == -1 and right_idx == -1:
                # A small acoustic-boundary nudge was applied; rebuild before
                # considering anchor removal.
                continue
            if left_idx == right_idx:
                drop_idx = left_idx
            elif left_idx in selected and right_idx in selected:
                drop_idx = weaker_anchor(left_idx, right_idx)
            elif left_idx in selected:
                drop_idx = left_idx
            elif right_idx in selected:
                drop_idx = right_idx
            else:
                drop_idx = min(
                    selected,
                    key=lambda idx: (
                        0 if selected[idx][1] == "qwen" else 1,
                        selected[idx][2],
                    ),
                )
        selected.pop(drop_idx, None)

    return [], {
        "ctc": 0,
        "qwen": 0,
        "interpolated": 0,
    }

def _group_lyric_text(text: str, maximum_words: int = 35) -> list[str]:
    """Preserve trusted author lines; split only truly unstructured text.

    Lyrics providers and sidecar files already contain meaningful line breaks.
    Those boundaries are valuable karaoke anchors and must not be merged again.
    If a provider returns one long paragraph, chunk only that paragraph to keep
    the forced-aligner context bounded.
    """
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if not lines:
        return []

    # Multiple source lines are authoritative: keep them exactly 1:1.
    if len(lines) > 1:
        return lines

    tokens = tokenize(lines[0])
    if not tokens:
        return []
    if len(tokens) <= maximum_words:
        return [" ".join(tokens)]
    return [
        " ".join(tokens[start : start + maximum_words])
        for start in range(0, len(tokens), maximum_words)
    ]


def _activity_quantile_times(audio: np.ndarray, sample_rate: int) -> list[float]:
    """Return ordered wall-clock samples representing likely vocal activity."""
    hop = max(1, int(sample_rate * 0.04))
    frame = max(hop, int(sample_rate * 0.08))
    if audio.size < frame:
        return [0.0, len(audio) / max(1, sample_rate)]
    values = []
    times = []
    for start in range(0, max(1, len(audio) - frame + 1), hop):
        chunk = audio[start : start + frame]
        values.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
        times.append((start + frame / 2) / sample_rate)
    rms = np.asarray(values, dtype=np.float32)
    threshold = max(float(np.percentile(rms, 25)) * 1.8, float(np.percentile(rms, 90)) * 0.10)
    active = [time for time, value in zip(times, rms, strict=True) if value >= threshold]
    return active if len(active) >= 2 else [0.0, len(audio) / sample_rate]


def _long_text_segments(audio, text: str) -> list[tuple[float, float, str]]:
    """Give long trusted lyrics bounded windows derived from the vocal stem."""
    groups = _group_lyric_text(text)
    if not groups:
        return []
    source, sample_rate = load_mono(audio, 16000)
    duration_sec = len(source) / sample_rate
    active_times = _activity_quantile_times(source, sample_rate)
    weights = [max(1, sum(len(token) for token in tokenize(group))) for group in groups]
    total = sum(weights)
    cursor = 0
    output: list[tuple[float, float, str]] = []
    last_index = len(active_times) - 1
    for group, weight in zip(groups, weights, strict=True):
        start_fraction = cursor / total
        cursor += weight
        end_fraction = cursor / total
        start = active_times[min(last_index, int(round(start_fraction * last_index)))]
        end = active_times[min(last_index, int(round(end_fraction * last_index)))]
        # Character-weighted activity quantiles are only a coarse location hint.
        # Scale the surrounding context to the actual lyric line instead of
        # giving every phrase the same multi-second crop.  This lowers the
        # chance that a repeated lyric later in the song wins the alignment.
        timing = _line_timing_profile(tokenize(group))
        start = max(0.0, start - timing["context"])
        end = min(
            duration_sec,
            max(start + timing["minimum_window"], end + timing["context"]),
        )
        output.append((start, end, group))
    return output


def _pathological_alignment(words: list[Word], span: float) -> bool:
    """Detect context collapse before it reaches lyrics and MIDI artefacts."""
    if not words:
        return True
    durations = [max(0.0, word.end - word.start) for word in words]
    collapsed = sum(duration <= 0.025 for duration in durations)
    compressed = sum(duration <= 0.09 for duration in durations)
    implausible_long_word = any(
        len(tokenize(word.text)[0]) >= 4 and duration <= 0.09
        for word, duration in zip(words, durations, strict=True)
        if tokenize(word.text)
    )
    # A single written word cannot occupy most of a phrase window.  The old
    # span-relative threshold accepted 9-11 second words in wide chorus
    # windows, shifting every lyric and every derived note after them.
    implausible_held_word = any(
        duration > min(3.2, max(1.8, 0.42 + len(tokenize(word.text)[0]) * 0.22))
        for word, duration in zip(words, durations, strict=True)
        if tokenize(word.text)
    )
    overlaps = sum(
        right.start < left.end - 0.015
        for left, right in zip(words, words[1:], strict=False)
    )
    token_count = sum(max(1, len(tokenize(word.text))) for word in words)
    total_span = max(0.0, words[-1].end - words[0].start)
    return (
        max(durations) > max(4.5, span * 0.62)
        or implausible_held_word
        or collapsed > max(2, len(words) // 4)
        or compressed > max(2, len(words) // 3)
        or implausible_long_word
        or overlaps > max(1, len(words) // 5)
        # Even very fast sung lyrics cannot fit a whole multi-word line into a
        # few frames.  This catches high-confidence context misses from the
        # aligner before they are published as karaoke timings.
        or (token_count >= 2 and total_span < token_count * 0.115)
    )


def _proportional_words(tokens: list[str], span: float) -> list[Word]:
    weights = [max(2, len(token)) for token in tokens]
    total = sum(weights)
    offset = 0
    output = []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = span * offset / total
        offset += weight
        word_end = span * offset / total
        output.append(Word(word_start, word_end, token, 0.05, index))
    return output


def _vocal_activity_regions(
    audio: np.ndarray, sample_rate: int, *, join_gap: float = 0.30
) -> list[tuple[float, float]]:
    """Find sung regions inside a short vocal-stem window."""
    source = np.asarray(audio, dtype=np.float32)
    hop = max(1, int(sample_rate * 0.04))
    frame = max(hop, int(sample_rate * 0.08))
    if source.size < frame:
        return []
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
            if region_start is None:
                region_start = timestamp
            last_active = timestamp
        elif (
            region_start is not None
            and last_active is not None
            and timestamp - last_active > join_gap
        ):
            if last_active - region_start >= 0.12:
                regions.append((region_start, last_active))
            region_start = None
            last_active = None
    if region_start is not None and last_active is not None and last_active - region_start >= 0.12:
        regions.append((region_start, last_active))
    return regions


def _activity_fallback_words(
    tokens: list[str],
    audio: np.ndarray,
    sample_rate: int,
    hint_words: list[Word] | None = None,
    minimum_start: float | None = None,
) -> list[Word]:
    """Distribute rejected timings across the complete nearby sung phrase.

    Activity detection commonly splits one lyric line into several islands (one
    per word or syllable).  Picking only the nearest island compresses an entire
    line into a few hundred milliseconds.  Keep neighbouring islands together
    and advance word boundaries through *active* time so instrumental gaps do
    not consume lyric words.
    """
    regions = _vocal_activity_regions(audio, sample_rate)
    if minimum_start is not None:
        unused_regions = [
            (max(region[0], minimum_start), region[1])
            for region in regions
            if region[1] >= minimum_start + 0.02
        ]
        if unused_regions:
            regions = unused_regions
    if not regions:
        return _proportional_words(tokens, max(0.08, len(audio) / sample_rate))

    clusters: list[list[tuple[float, float]]] = []
    for region in regions:
        if clusters and region[0] - clusters[-1][-1][1] <= 1.50:
            clusters[-1].append(region)
        else:
            clusters.append([region])
    if len(tokens) >= 10:
        # A failed multi-line chunk may legitimately contain several phrases
        # separated by breaths or instrumental punctuation.
        selected = regions
    elif hint_words and len(tokens) <= 3:
        # A short written line may still be sung across several nearby activity
        # islands (separate words/syllables divided by small breaths).  Select
        # the nearest *phrase cluster*, not a single island.  Clusters are split
        # above at gaps > 1.50 s, which prevents a short line from stealing the
        # next distant phrase while preserving one line spread over local gaps.
        hint_start = hint_words[0].start
        selected = min(
            clusters,
            key=lambda cluster: min(
                abs(cluster[0][0] - hint_start),
                abs(cluster[-1][1] - hint_start),
                0.0 if cluster[0][0] <= hint_start <= cluster[-1][1] else float("inf"),
            ),
        )
        maximum_span = sum(
            min(3.2, max(0.7, 0.42 + len(token) * 0.22)) for token in tokens
        )
        cluster_start = selected[0][0]
        cluster_end = selected[-1][1]
        if cluster_end - cluster_start > maximum_span:
            clipped_end = cluster_start + maximum_span
            selected = [
                (start, min(end, clipped_end))
                for start, end in selected
                if start < clipped_end
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
    total_weight = max(1, sum(weights))
    active_duration = sum(max(0.0, end - start) for start, end in selected)
    if active_duration <= 0.02:
        start, end = selected[0][0], selected[-1][1]
        local = _proportional_words(tokens, max(0.08, end - start))
        return [
            Word(start + word.start, start + word.end, word.text, word.confidence, word.index)
            for word in local
        ]

    def active_offset_to_time(offset: float) -> float:
        remaining = max(0.0, min(active_duration, offset))
        for start, end in selected:
            span = max(0.0, end - start)
            if remaining <= span:
                return start + remaining
            remaining -= span
        return selected[-1][1]

    output: list[Word] = []
    consumed = 0
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        start = active_offset_to_time(active_duration * consumed / total_weight)
        consumed += weight
        end = active_offset_to_time(active_duration * consumed / total_weight)
        output.append(Word(start, max(start + 0.02, end), token, 0.05, index))
    return output



def _segment_alignment_is_usable(
    words: list[Word], tokens: list[str], span: float
) -> bool:
    """Accept forced-alignment output only if it fits its authoritative LRC window.

    Qwen can occasionally return plausible-looking durations at timestamps from a
    different context.  The old code checked durations but not absolute bounds,
    then clamped those out-of-window words one by one to ``segment_end``.  That
    converted an entire lyric line into a train of 20 ms words.
    """
    if not words or not tokens or len(words) != len(tokens):
        return False
    span = max(0.0, float(span))
    if span <= 0.04 or _pathological_alignment(words, span):
        return False

    expected = [token.casefold() for token in tokens]
    actual = []
    for word in words:
        parts = tokenize(word.text)
        if len(parts) != 1:
            return False
        actual.append(parts[0].casefold())
    if actual != expected:
        return False

    previous_end = -1e-6
    for word in words:
        start = float(word.start)
        end = float(word.end)
        if start < -0.05 or end > span + 0.05 or end <= start + 0.009:
            return False
        if start < previous_end - 0.02:
            return False
        previous_end = end
    return True




def _minimum_sung_phrase_duration(tokens: list[str]) -> float:
    """Conservative physical lower bound for a sung lyric line.

    LRC providers occasionally contain corrupt neighbouring timestamps.  A six-word
    line cannot truthfully occupy a few hundred milliseconds, so such a boundary
    must be treated as a hint rather than as an authoritative crop.
    """
    if not tokens:
        return 0.0
    characters = sum(len(token) for token in tokens)
    return max(0.28, 0.135 * len(tokens) + 0.0065 * characters)


def _expected_sung_phrase_duration(tokens: list[str]) -> float:
    if not tokens:
        return 0.5
    characters = sum(len(token) for token in tokens)
    return max(0.65, 0.34 * len(tokens) + 0.024 * characters)




def _clamp_timing(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def _line_timing_profile(tokens: list[str]) -> dict[str, float]:
    """Return adaptive timing tolerances for one lyric line.

    The old long-text path used fixed 16-24 second search windows and fixed
    200-800 ms cursor tolerances for every line.  Those values are unnecessarily
    wide for short phrases and can let a repeated lyric later in the song win.
    Scale the search context from the physical/expected duration of this exact
    line while keeping conservative bounds for slow or heavily sustained singing.
    """
    minimum = _minimum_sung_phrase_duration(tokens)
    expected = _expected_sung_phrase_duration(tokens)
    context = _clamp_timing(expected * 0.45, 0.75, 2.20)
    cursor_backtrack = _clamp_timing(expected * 0.08, 0.10, 0.32)
    anchor_lead = _clamp_timing(expected * 0.24, 0.35, 0.95)
    candidate_slack = _clamp_timing(expected * 0.035, 0.05, 0.14)
    overlap_slack = _clamp_timing(expected * 0.010, 0.012, 0.030)
    min_word_duration = _clamp_timing(
        (minimum / max(1, len(tokens))) * 0.18, 0.014, 0.030
    )
    minimum_window = max(
        expected * 1.85 + context,
        minimum * 2.4 + context,
        3.8,
    )
    search_window = _clamp_timing(
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

def _lrc_window_is_plausible(tokens: list[str], span: float) -> bool:
    return float(span) + 1e-6 >= _minimum_sung_phrase_duration(tokens)

def enforce_segmented_timing_safety(
    words: list[Word],
    segments: list[tuple[float, float, str]] | tuple[tuple[float, float, str], ...],
    duration_sec: float,
) -> list[Word]:
    """Final production invariant for provider-timed lyrics.

    This runs independently of Qwen's internal decision path.  It groups the
    returned words back into the exact provider lyric lines and refuses to
    publish a multi-word line whose total duration is physically impossible.
    Corrupt *end* anchors are ignored; the line start is retained and a safe
    sung duration is reserved.  This is intentionally deterministic so a bad
    acoustic island can never recreate a 20 ms-word train.
    """
    if not words or not segments:
        return words

    output: list[Word] = []
    offset = 0
    cursor = 0.0
    duration_sec = max(0.0, float(duration_sec))

    for segment in sorted(segments, key=lambda item: (float(item[0]), float(item[1]))):
        anchor_start, _anchor_end, text = segment
        tokens = tokenize(text)
        if not tokens:
            continue
        count = len(tokens)
        group = words[offset : offset + count]
        offset += count
        if len(group) != count:
            break

        token_match = all(
            tokenize(word.text) and tokenize(word.text)[0].casefold() == token.casefold()
            for word, token in zip(group, tokens, strict=True)
        )
        line_span = max(0.0, float(group[-1].end) - float(group[0].start))
        minimum = _minimum_sung_phrase_duration(tokens)
        has_micro_train = sum((word.end - word.start) <= 0.025 for word in group) > max(1, count // 4)
        monotonic = all(
            right.start >= left.end - 0.02
            for left, right in zip(group, group[1:], strict=False)
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
                for word in safe_group:
                    output.append(Word(word.start, word.end, word.text, word.confidence, len(output)))
                cursor = output[-1].end
                continue

        # Broken line: keep its start anchor, but never its impossible end.
        start = max(cursor, max(0.0, float(anchor_start)))
        expected = _expected_sung_phrase_duration(tokens)
        target = max(minimum * 1.35, expected * 1.12)
        if duration_sec > 0:
            target = min(target, max(0.08, duration_sec - start))
        rebuilt = _proportional_words(tokens, max(0.08, target))
        for word in rebuilt:
            end = start + word.end
            if duration_sec > 0:
                end = min(duration_sec, end)
            output.append(
                Word(start + word.start, max(start + word.start + 0.02, end), word.text, 0.03, len(output))
            )
        if rebuilt:
            cursor = output[-1].end

    # Preserve any tail only when grouping could not consume it.  This keeps the
    # function safe for non-provider/mixed callers while the normal production
    # path consumes every word exactly.
    if offset < len(words):
        for word in words[offset:]:
            start = max(cursor, float(word.start))
            end = max(start + 0.02, float(word.end))
            if duration_sec > 0:
                end = min(duration_sec, end)
            if end > start:
                output.append(Word(start, end, word.text, word.confidence, len(output)))
                cursor = end
    return output or words


def _timed_segment_fallback_words(tokens: list[str], span: float) -> list[Word]:
    """Build safe word timings inside an authoritative LRC line window.

    A synced-lyrics timestamp is a much stronger line-level anchor than a
    failed forced-aligner result.  Keep the line start and reserve a realistic
    sung phrase duration instead of compressing many words into one detected
    energy island or stretching them all the way to the next LRC line.
    """
    span = max(0.08, float(span))
    if not tokens:
        return []
    characters = sum(len(token) for token in tokens)
    expected = 0.34 * len(tokens) + 0.024 * characters
    # Allow expressive singing, but never let fallback consume a huge
    # instrumental gap between two authoritative LRC line starts.
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
    """Deterministic safety fallback for untimed/plain lyric lines.

    Qwen often still knows *where* a line begins even when all of its word
    boundaries collapse.  Preserve that useful start hint, but never preserve
    the collapsed durations.  If there is no usable candidate start, use the
    first vocal-activity region after the monotonic cursor.
    """
    if not tokens:
        return []
    search_span = max(0.08, float(search_span))
    minimum_start = max(0.0, min(search_span, float(minimum_start)))

    start = minimum_start
    if candidate_words:
        candidate_start = float(candidate_words[0].start)
        if minimum_start - 0.20 <= candidate_start <= search_span - 0.05:
            start = max(minimum_start, candidate_start)
    elif audio is not None and sample_rate:
        regions = _vocal_activity_regions(audio, int(sample_rate))
        for region_start, region_end in regions:
            if region_end >= minimum_start + 0.02:
                start = max(minimum_start, region_start)
                break

    minimum = _minimum_sung_phrase_duration(tokens)
    expected = _expected_sung_phrase_duration(tokens)
    target = max(minimum * 1.35, expected * 1.12)
    available = max(0.08, search_span - start)
    span = min(available, target)
    return [
        Word(start + word.start, start + word.end, word.text, 0.03, word.index)
        for word in _proportional_words(tokens, span)
    ]


def _speech_focus_variant(audio: np.ndarray) -> np.ndarray:
    """Cheap consonant-focused retry input for uncertain singing phrases."""
    source = np.asarray(audio, dtype=np.float32)
    if source.size < 3:
        return source
    emphasized = source.copy()
    emphasized[1:] = source[1:] - 0.91 * source[:-1]
    # Do not replace the tonal signal completely: blend transient detail back in.
    mixed = source * 0.78 + emphasized * 0.22
    return _normalize_singing_audio(mixed)


def _script_ratio(text: str, language: str | None) -> float:
    letters = [ch for ch in text.casefold() if ch.isalpha()]
    if not letters:
        return 0.0
    language = (_language_name(language) or "").casefold()
    if language in {"russian", "ukrainian"}:
        matching = sum(bool(re.match(r"[а-яёіїєґ]", ch)) for ch in letters)
    elif language == "english":
        matching = sum("a" <= ch <= "z" for ch in letters)
    else:
        return 1.0
    return matching / len(letters)


def _transcript_quality(text: str, duration_sec: float, language: str | None) -> float:
    """Fast heuristic used only to decide whether a phrase deserves a retry."""
    value = _clean_transcript_part(text)
    tokens = tokenize(value)
    if not tokens:
        return 0.0
    duration_sec = max(0.5, float(duration_sec))
    rate = len(tokens) / duration_sec
    score = 1.0
    # Singing typically has fewer words/sec than speech. Extreme rates are often
    # hallucination or a missed phrase. Keep the range deliberately permissive.
    if rate < 0.12:
        score -= min(0.42, (0.12 - rate) * 2.5)
    elif rate > 4.0:
        score -= min(0.42, (rate - 4.0) * 0.18)
    long_tokens = sum(len(token) > 28 for token in tokens)
    score -= min(0.25, long_tokens * 0.08)
    repeated = sum(a.casefold() == b.casefold() for a, b in zip(tokens, tokens[1:], strict=False))
    if len(tokens) >= 4:
        score -= min(0.22, repeated / max(1, len(tokens) - 1) * 0.5)
    score -= max(0.0, 0.82 - _script_ratio(value, language)) * 0.45
    return max(0.0, min(1.0, score))


def _token_key(token: str) -> str:
    return (
        str(token or "")
        .casefold()
        .replace("ё", "е")
        .replace("’", "'")
        .replace("ʼ", "'")
        .strip(".,!?;:()[]{}")
    )


def _candidate_agreement(text: str, candidates: list[str]) -> float:
    """Average agreement is safer than trusting one coincidentally similar peer."""
    tokens = " ".join(_token_key(token) for token in tokenize(text))
    if not tokens or len(candidates) <= 1:
        return 0.0
    peers = []
    skipped_self = False
    target_clean = _clean_transcript_part(text)
    for item in candidates:
        clean = _clean_transcript_part(item)
        if not skipped_self and clean == target_clean:
            skipped_self = True
            continue
        peer = " ".join(_token_key(token) for token in tokenize(item))
        if peer:
            peers.append(peer)
    if not peers:
        return 0.0
    scores = [SequenceMatcher(None, tokens, peer).ratio() for peer in peers]
    return sum(scores) / len(scores)


def _select_candidate(candidates: list[str], duration_sec: float, language: str | None) -> str:
    cleaned = [_clean_transcript_part(item) for item in candidates if _clean_transcript_part(item)]
    if not cleaned:
        return ""
    best = cleaned[0]
    best_score = -1.0
    for item in cleaned:
        quality = _transcript_quality(item, duration_sec, language)
        consensus = _candidate_agreement(item, cleaned)
        score = quality * 0.68 + consensus * 0.32
        if score > best_score:
            best, best_score = item, score
    return best


def _clean_transcript_part(text: str) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if not value:
        return ""
    # Remove pathological repeated *phrases* (ASR hallucination) while keeping
    # legitimate repetitions such as "на-на-на" or "я я".
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
        if len(cleaned) < len(tokens):
            tokens = cleaned
    return " ".join(tokens).strip()


def _trim_transcript_overlaps(parts: list[str]) -> list[str]:
    """Remove duplicated boundary tokens while preserving phrase ownership."""
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


def _merge_transcript_parts(parts: list[str]) -> str:
    """Merge overlapping ASR chunks with conservative fuzzy token matching.

    Exact overlap was too brittle for singing: one chunk could emit ``тебя`` and
    the neighbour ``тебя,`` or ``е``/``ё`` and both copies survived.  We allow
    fuzzy overlap only when at least two boundary tokens agree strongly.
    """
    return " ".join(part for part in _trim_transcript_overlaps(parts) if part).strip()


def _majority_language(values: list[str | None], requested: str | None) -> str | None:
    explicit = _language_name(requested)
    if explicit:
        return explicit
    normalized = [_language_name(value) for value in values if value]
    normalized = [value for value in normalized if value]
    if normalized:
        return Counter(normalized).most_common(1)[0][0]
    return None


def _consensus_language(
    texts: list[str], detected: list[str | None], requested: str | None
) -> str | None:
    """Resolve language from all recognized letters, not one vote per chunk.

    Chunk voting is biased by silence: a few short hallucinated English chunks
    can outvote long, correctly recognized Russian verses.  Script evidence is
    weighted by actual letters and therefore represents the song as a whole.
    """
    explicit = _language_name(requested)
    if explicit:
        return explicit
    combined = " ".join(texts).casefold()
    cyrillic = len(re.findall(r"[а-яёіїєґ]", combined))
    latin = len(re.findall(r"[a-z]", combined))
    if cyrillic >= 24 and cyrillic >= latin * 1.25:
        if any(character in combined for character in "іїєґ"):
            return "Ukrainian"
        return "Russian"
    if latin >= 24 and latin >= cyrillic * 1.25:
        return "English"
    return _majority_language(detected, None)


class Qwen3Transcriber(Transcriber):
    name = "qwen3-asr"

    def __init__(self, model=get_model("asr").repo_id):
        self.model_name = model
        self._model = None
        self._call_batch_size = 1
        self.last_language: str | None = None
        self.last_segments: list[tuple[float, float, str]] = []
        self._activity_hints: list[tuple[float, float]] = []

    def set_pitch_activity(self, frames) -> None:
        """Provide voiced intervals computed by FCPE for safer ASR chunk cuts."""
        intervals: list[tuple[float, float]] = []
        start = None
        last = None
        for frame in sorted(frames or [], key=lambda item: item.time):
            active = bool(frame.voiced and frame.frequency > 0 and frame.confidence >= 0.35)
            if active:
                if start is None:
                    start = frame.time
                last = frame.time
            elif start is not None and last is not None:
                intervals.append((max(0.0, start - 0.02), last + 0.04))
                start = last = None
        if start is not None and last is not None:
            intervals.append((max(0.0, start - 0.02), last + 0.04))
        self._activity_hints = intervals

    def _load(self):
        try:
            import torch
            from qwen_asr import Qwen3ASRModel
        except ImportError as exc:
            raise EngineUnavailableError("Install the official qwen-asr package") from exc
        if self._model is None:
            device = select_torch_device(torch)
            use_cuda = device.startswith("cuda")
            self._call_batch_size = 2 if use_cuda else 1
            kwargs = {
                "device_map": device,
                "dtype": torch.float16 if use_cuda else torch.float32,
                # The 0.6B model fits several singing phrases into an 8 GB GPU.
                # A batch size of one made every phrase a separate generation
                # and dominated total processing time. CPU keeps the conservative
                # single-item path to avoid excessive RAM pressure.
                "max_inference_batch_size": 2 if use_cuda else 1,
                "max_new_tokens": 256,
            }
            self._model = Qwen3ASRModel.from_pretrained(self.model_name, **kwargs)
            generation_config = getattr(
                getattr(self._model, "model", self._model), "generation_config", None
            )
            if (
                generation_config is not None
                and getattr(generation_config, "pad_token_id", None) is None
            ):
                eos_token_id = getattr(generation_config, "eos_token_id", None)
                if eos_token_id is not None:
                    generation_config.pad_token_id = eos_token_id
        return self._model

    @staticmethod
    def _parse_batch(result, count: int):
        if count == 1:
            return [_unwrap_single_result(result) if result is not None else {}]
        values = list(result) if isinstance(result, (list, tuple)) else [result]
        if len(values) < count:
            values.extend([None] * (count - len(values)))
        return [
            _unwrap_single_result(value) if value is not None else {} for value in values[:count]
        ]

    def _transcribe_batch(self, model, audios, language):
        if not audios:
            return []
        kwargs = {"audio": audios if len(audios) > 1 else audios[0]}
        if len(audios) > 1:
            kwargs["language"] = [language] * len(audios) if language else [None] * len(audios)
        elif language:
            kwargs["language"] = language
        try:
            return self._parse_batch(model.transcribe(**kwargs), len(audios))
        except (TypeError, ValueError):
            output = []
            for item_audio in audios:
                item_kwargs = {"audio": item_audio}
                if language:
                    item_kwargs["language"] = language
                output.append(_unwrap_single_result(model.transcribe(**item_kwargs)))
            return output

    def transcribe(self, audio, language):
        model = self._load()
        self.last_segments = []
        requested_language = _language_name(language)
        audio_path = Path(audio) if isinstance(audio, (str, Path)) else None
        if audio_path is not None and not audio_path.is_file():
            # Keep adapters testable and compatible with remote/virtual audio
            # references accepted by qwen-asr. Real pipeline files take the
            # singing-specific segmented path below.
            kwargs = {"audio": str(audio)}
            if requested_language:
                kwargs["language"] = requested_language
            result = model.transcribe(**kwargs)
            item = _unwrap_single_result(result)
            text = _clean_transcript_part(str(_first(item, ("text", "transcription"), "") or ""))
            self.last_language = (
                _language_name(_first(item, ("language", "lang"), None)) or requested_language
            )
            return text, _words_from_items(_unwrap_items(item))

        y, sr = load_mono(audio, 16000)
        windows = _singing_chunk_windows(y, sr, self._activity_hints)
        chunks = [chunk for chunk, _start, _end in windows]

        # Long songs are recognized phrase-by-phrase. This substantially reduces
        # singing hallucinations and forgotten lines compared with giving the
        # autoregressive ASR an entire 3-5 minute vocal stem in one request.
        inputs = [(chunk, sr) for chunk in chunks]
        # Do not hand the complete song to qwen-asr as one giant Python list.
        # The frontend model preprocessor materializes features for that whole
        # list before its own inference batching starts; on an 8 GB GPU this
        # exhausted VRAM and terminated the complete backend process. Two
        # phrases per call keeps memory bounded while retaining GPU batching.
        results = []
        for start in range(0, len(inputs), self._call_batch_size):
            results.extend(
                self._transcribe_batch(
                    model,
                    inputs[start : start + self._call_batch_size],
                    requested_language,
                )
            )
        # Some qwen-asr versions may return fewer batch elements on malformed
        # inputs. Pad rather than silently shifting chunk/result correspondence.
        if len(results) < len(inputs):
            results.extend([None] * (len(inputs) - len(results)))

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
            if len(inputs) == 1:
                direct_words = _words_from_items(_unwrap_items(item))

        consensus_language = _consensus_language(initial_parts, detected, requested_language)
        chosen_parts = list(initial_parts)

        # Retry only low-quality / language-inconsistent chunks. The retry pass
        # is batched, preserving GPU throughput while allowing stronger consensus.
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
        # Always repair chunks generated in the wrong language.  In addition,
        # retry at most five weak same-language chunks to bound processing time.
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

        # Only the two least convincing chunks receive a third view.  A tiny
        # context trim changes autoregressive decoding without reprocessing the song.
        second_round: list[int] = []
        for index in retry_indices:
            best_so_far = _select_candidate(
                candidate_map[index], len(chunks[index]) / sr, consensus_language
            )
            if _transcript_quality(best_so_far, len(chunks[index]) / sr, consensus_language) < 0.72:
                second_round.append(index)
        second_round = second_round[:2]
        second_audio = []
        for index in second_round:
            chunk = chunks[index]
            trim = int(0.10 * sr)
            trimmed = chunk[trim:-trim] if len(chunk) > 2 * trim else chunk
            second_audio.append((_normalize_singing_audio(trimmed), sr))
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
        text = " ".join(part for part in owned_parts if part).strip()
        self.last_segments = [
            (start, end, part)
            for (_chunk, start, end), part in zip(windows, owned_parts, strict=False)
            if part
        ]
        # A selective retry may replace the transcript even for a short song.
        # Timestamps from the original ASR result would then refer to different
        # words, so force the dedicated aligner to rebuild them.
        if len(inputs) == 1 and chosen_parts != initial_parts:
            direct_words = []
        self.last_language = resolve_alignment_language(text, consensus_language)
        return text, direct_words


    def release(self) -> None:
        """Release ASR weights before loading the forced aligner on small GPUs."""
        self._model = None
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass


class Qwen3ForcedAligner(Aligner):
    name = "ctc-qwen-hybrid-aligner"

    def __init__(self, model=get_model("aligner").repo_id):
        self.model_name = model
        self._model = None
        self._global_asr_segments: list[tuple[float, float, str]] = []
        self._ctc = CTCWordAligner.from_environment()
        self.last_alignment_diagnostics: dict[str, object] = {}

    def set_global_asr_segments(self, segments) -> None:
        self._global_asr_segments = [
            (float(start), float(end), str(text))
            for start, end, text in (segments or [])
            if text and float(end) > float(start)
        ]

    def _load(self):
        try:
            import torch
            from qwen_asr import Qwen3ForcedAligner
        except ImportError as exc:
            raise EngineUnavailableError(
                "Install the official qwen-asr package with forced aligner support"
            ) from exc
        if self._model is None:
            device = select_torch_device(torch)
            use_cuda = device.startswith("cuda")
            self._model = Qwen3ForcedAligner.from_pretrained(
                self.model_name,
                device_map=device,
                dtype=torch.float16 if use_cuda else torch.float32,
            )
        return self._model

    def align(self, audio, text, language):
        resolved_language = resolve_alignment_language(text, language)
        result = self._load().align(
            audio=str(audio),
            text=text,
            language=resolved_language,
        )
        item = _unwrap_single_result(result)
        words = _words_from_items(item if isinstance(item, (list, tuple)) else _unwrap_items(item))
        if not words:
            raise InvalidArtifactError("Forced aligner returned no timed words")

        # Qwen timestamps are quantized and some releases can emit repeated or
        # zero-duration word spans.  Direct alignment previously accepted those
        # values unchanged; segmented/long-text modes had guards, so short songs
        # could be *less* reliable than long ones.  Validate every alignment at
        # the engine boundary and rebuild only pathological timing from vocal
        # activity while preserving the trusted word sequence.
        try:
            span = duration(audio)
        except (OSError, RuntimeError, ValueError):
            # Keep compatibility with synthetic/mocked aligner callers.  Real
            # pipeline inputs are validated audio files before this stage.
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
            if repaired:
                words = repaired
        return words

    def align_segments(self, audio, segments, language):
        """Align timed lyric lines using LRC timestamps as *soft* acoustic hints.

        Production lyrics providers sometimes contain one or more corrupt LRC
        anchors.  Cropping a line strictly at the next bad timestamp was the cause
        of a compressed-alignment regression where several words were forced
        into an unrealistically short provider interval.

        Rules used here:
        * a physically plausible LRC interval remains a strong location hint;
        * an implausibly short interval is automatically widened;
        * Qwen is allowed to move word boundaries inside the widened search window;
        * a monotonic acoustic cursor prevents repeated chorus lines from jumping
          backwards to an earlier occurrence;
        * no candidate is ever clamped word-by-word to a broken LRC boundary.
        """
        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailableError("soundfile is required for segmented alignment") from exc

        source, sample_rate = load_mono(audio, 16000)
        duration_sec = len(source) / sample_rate
        output: list[Word] = []
        cursor = 0.0
        ordered = sorted(segments, key=lambda item: (float(item[0]), float(item[1])))

        with tempfile.TemporaryDirectory(prefix="karaoke-align-") as temp_dir:
            root = Path(temp_dir)
            for segment_index, (start, end, text) in enumerate(ordered):
                tokens = tokenize(text)
                if not tokens:
                    continue

                anchor_start = max(0.0, float(start))
                if anchor_start >= duration_sec - 0.01:
                    continue
                anchor_end = min(duration_sec, max(anchor_start + 0.04, float(end)))
                anchor_span = max(0.0, anchor_end - anchor_start)
                plausible_anchor = _lrc_window_is_plausible(tokens, anchor_span)
                expected = _expected_sung_phrase_duration(tokens)

                # Good LRC gets a modest acoustic margin.  Bad LRC gets a generous
                # look-ahead so the aligner can find the real sung phrase rather
                # than being forced into the corrupt next timestamp.
                pre_roll = 0.0 if plausible_anchor else 1.25
                post_roll = max(0.85, expected * 0.55) if plausible_anchor else max(5.0, expected * 2.4)
                search_start = max(0.0, anchor_start - pre_roll)
                search_start = max(search_start, max(0.0, cursor - 0.18))
                search_end = min(
                    duration_sec,
                    max(
                        anchor_end + post_roll,
                        search_start + expected * (2.1 if plausible_anchor else 3.6) + 1.5,
                    ),
                )
                if search_end <= search_start + 0.10:
                    continue

                left = max(0, min(len(source) - 1, int(search_start * sample_rate)))
                right = max(left + 1, min(len(source), int(search_end * sample_rate)))
                path = root / f"segment-{segment_index:03d}.wav"
                segment_audio = source[left:right]
                sf.write(path, segment_audio, sample_rate, subtype="PCM_16")
                search_span = search_end - search_start

                local_words: list[Word] = []
                candidate: list[Word] = []
                try:
                    candidate = self.align(path, text, language)
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
                        # For a healthy timestamp keep alignment near its line
                        # anchor. Corrupt timestamps are deliberately allowed to
                        # move much farther so Qwen can recover the real phrase.
                        if plausible_anchor:
                            candidate_ok = candidate_ok and (
                                absolute_start >= anchor_start - 0.85
                                and absolute_start <= anchor_end + 1.25
                            )
                    if candidate_ok:
                        local_words = candidate
                except (InvalidArtifactError, RuntimeError, ValueError):
                    candidate = []

                if not local_words:
                    if plausible_anchor:
                        # Healthy provider timing remains authoritative when Qwen
                        # itself fails.  Do not let a fallback wander into the
                        # neighbouring lyric line.
                        local_words = _timed_segment_fallback_words(tokens, anchor_span)
                        search_start = anchor_start
                        search_end = anchor_end
                    else:
                        # IMPORTANT: do not choose a short energy island here.  A
                        # corrupt next-LRC timestamp often sits inside the same sung
                        # phrase.  Energy-only fallback can then rediscover exactly
                        # that tiny island and compress the whole line again.
                        #
                        # The line *start* is still our strongest provider hint.
                        # Reserve a physically plausible sung duration from that
                        # start.  Qwen remains the primary path above; this branch is
                        # only the deterministic production safety net.
                        fallback_start = max(cursor, anchor_start)
                        room = max(0.08, search_end - fallback_start)
                        target = max(
                            _minimum_sung_phrase_duration(tokens) * 1.35,
                            expected * 1.12,
                        )
                        safe_span = min(room, target)
                        local_words = _proportional_words(tokens, safe_span)
                        search_start = fallback_start

                # Validate the whole line atomically. Do not clamp every word to
                # anchor_end: that was exactly how trains of 20 ms words appeared.
                line_words: list[Word] = []
                for word in local_words:
                    word_start = max(cursor, search_start + float(word.start))
                    word_end = min(duration_sec, search_start + float(word.end))
                    if word_end <= word_start + 0.009:
                        line_words = []
                        break
                    line_words.append(Word(word_start, word_end, word.text, word.confidence, 0))

                line_duration = (
                    line_words[-1].end - line_words[0].start if line_words else 0.0
                )
                if (
                    len(line_words) != len(tokens)
                    or line_duration < _minimum_sung_phrase_duration(tokens)
                ):
                    # Last-resort timing stays inside the widened acoustic window
                    # and starts at/after the monotonic cursor.  It is intentionally
                    # low-confidence, but never physically impossible.
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

                for word in line_words:
                    output.append(Word(word.start, word.end, word.text, word.confidence, len(output)))
                if line_words:
                    cursor = max(cursor, line_words[-1].end)

        if not output:
            raise InvalidArtifactError("Segmented forced aligner returned no timed words")
        return enforce_segmented_timing_safety(output, ordered, duration_sec)

    def align_long_text(self, audio, text, language):
        """Align untimed/plain lyric lines sequentially without micro-word collapse.

        This is the real production path when LRCLIB has plainLyrics but no
        usable syncedLyrics.  Every line is handled atomically: a bad Qwen
        result may contribute a *start location*, but never collapsed word
        durations.  No word is clamped individually against the global cursor.
        """
        groups = _group_lyric_text(text)
        anchor_windows = _asr_line_anchor_windows(groups, self._global_asr_segments)
        if len(groups) <= 1:
            return self.align(audio, text, language)

        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailableError("soundfile is required for long-text alignment") from exc

        source, sample_rate = load_mono(audio, 16000)
        duration_sec = len(source) / sample_rate
        output: list[Word] = []
        cursor = 0.0

        # Primary production path: character-level CTC forced alignment against
        # the canonical lyric text. ASR is used only to provide coarse windows;
        # the CTC target is the trusted lyric itself, so recognition can never
        # delete or replace words. Qwen is retained only for lines where the CTC
        # acoustic posterior is unavailable or too weak.
        ctc_lines = [None] * len(groups)
        ctc_attempted = False
        ctc_failure_reason = ""
        try:
            ctc_attempted = self._ctc.available_for(language, text)
            if ctc_attempted:
                ctc_lines = self._ctc.align_lines(
                    audio, groups, language, anchor_windows
                )
            else:
                code = _language_code(language, text)
                resource = self._ctc.last_resource_diagnostics.get(code, {})
                ctc_failure_reason = str(resource.get("reason", "CTC model unavailable"))
        except (EngineUnavailableError, InvalidArtifactError, RuntimeError, ValueError) as exc:
            ctc_lines = [None] * len(groups)
            ctc_failure_reason = f"{type(exc).__name__}: {exc}"
        finally:
            # A 300M/large Wav2Vec2 model plus Qwen can exceed 8 GB on some
            # cards. Finish the whole CTC pass first, then release it before any
            # Qwen fallback lines are evaluated.
            self._ctc.release()

        require_ctc = os.getenv("KARAOKE_AI_REQUIRE_CTC", "0").strip().casefold() in {"1", "true", "yes", "on"}
        ctc_language = _language_code(language, text)
        if require_ctc and ctc_language in {"ru", "uk"} and not ctc_attempted:
            resource = getattr(self._ctc, "last_resource_diagnostics", {}).get(ctc_language, {})
            checked = resource.get("checked", []) if isinstance(resource, dict) else []
            checked_text = "; ".join(
                f"{item.get('path', '?')} [{item.get('reason', '?')}]"
                for item in checked[:8]
                if isinstance(item, dict)
            )
            raise EngineUnavailableError(
                "Acoustic CTC word alignment is required but its local model is unavailable. "
                f"Language={ctc_language}; reason={ctc_failure_reason or resource.get('reason', 'not found')}. "
                f"Checked: {checked_text or 'no candidate paths'}. "
                "Run scripts\\install-ai-models.bat once or set KARAOKE_AI_CTC_RU_MODEL/"
                "KARAOKE_AI_CTC_UK_MODEL to the model directory."
            )

        ctc_accepted = sum(1 for item in ctc_lines if item is not None)
        qwen_fallback_lines = 0
        self.last_alignment_diagnostics = {
            "ctc_version": CTC_ALIGNMENT_VERSION,
            "ctc_attempted": ctc_attempted,
            "ctc_lines": ctc_accepted,
            "total_lines": len(groups),
            "qwen_fallback_lines": 0,
            "ctc_failure_reason": ctc_failure_reason,
            "ctc_resource": dict(getattr(self._ctc, "last_resource_diagnostics", {}) or {}),
        }

        with tempfile.TemporaryDirectory(prefix="karaoke-align-lines-") as temp_dir:
            root = Path(temp_dir)
            for line_index, line in enumerate(groups):
                tokens = tokenize(line)
                if not tokens:
                    continue
                if cursor >= duration_sec - 0.08:
                    # Do not drop this or later canonical lines. The final
                    # lossless safety pass below will retime the whole lyric.
                    break

                timing = _line_timing_profile(tokens)
                expected = timing["expected"]
                ctc_line = ctc_lines[line_index] if line_index < len(ctc_lines) else None
                if ctc_line is not None:
                    ctc_words = list(ctc_line.words)
                    if (
                        len(ctc_words) == len(tokens)
                        and _canonical_words_match(ctc_words, tokens)
                        and ctc_words[0].start >= cursor - timing["cursor_backtrack"]
                        and all(
                            right.start >= left.end - timing["overlap_slack"]
                            for left, right in zip(ctc_words, ctc_words[1:], strict=False)
                        )
                    ):
                        for word in ctc_words:
                            output.append(
                                Word(word.start, word.end, word.text, word.confidence, len(output))
                            )
                        cursor = ctc_words[-1].end
                        continue

                qwen_fallback_lines += 1
                anchor = anchor_windows.get(line_index)
                if anchor is not None:
                    anchor_start, anchor_end, anchor_score = anchor
                    search_start = max(
                        0.0,
                        cursor - timing["cursor_backtrack"],
                        anchor_start - timing["anchor_lead"],
                    )
                    search_end = min(
                        duration_sec,
                        max(
                            anchor_end + timing["context"],
                            search_start + timing["minimum_window"],
                        ),
                    )
                else:
                    search_start = max(0.0, cursor - timing["cursor_backtrack"] * 1.8)
                    search_end = min(
                        duration_sec,
                        search_start + timing["search_window"],
                    )
                if search_end <= search_start + 0.10:
                    break

                left = max(0, int(search_start * sample_rate))
                right = min(len(source), max(left + 1, int(search_end * sample_rate)))
                line_audio = source[left:right]
                path = root / f"line-{line_index:03d}.wav"
                sf.write(path, line_audio, sample_rate, subtype="PCM_16")
                local_cursor = max(0.0, cursor - search_start)

                candidate: list[Word] = []
                local_words: list[Word] = []
                try:
                    candidate = self.align(path, line, language)
                    candidate_start = search_start + candidate[0].start if candidate else 0.0
                    candidate_end = search_start + candidate[-1].end if candidate else 0.0
                    candidate_span = candidate[-1].end - candidate[0].start if candidate else 0.0
                    valid = bool(candidate) and (
                        not _pathological_alignment(candidate, search_end - search_start)
                        and candidate_start >= cursor - timing["cursor_backtrack"]
                        and candidate_end > cursor + timing["min_word_duration"]
                        and candidate_end <= search_end + timing["candidate_slack"]
                        and candidate_span >= timing["minimum"]
                        and len(candidate) == len(tokens)
                    )
                    if valid:
                        local_words = candidate
                    else:
                        local_words = _long_text_line_fallback(
                            tokens,
                            search_end - search_start,
                            candidate_words=candidate or None,
                            minimum_start=local_cursor,
                            audio=line_audio,
                            sample_rate=sample_rate,
                        )
                except (InvalidArtifactError, RuntimeError, ValueError):
                    local_words = _long_text_line_fallback(
                        tokens,
                        search_end - search_start,
                        minimum_start=local_cursor,
                        audio=line_audio,
                        sample_rate=sample_rate,
                    )

                # Validate and transform the complete line atomically.  Never
                # clamp each word with max(cursor, ...): that was the mechanism
                # that recreated 20 ms trains after an earlier timing error.
                line_words: list[Word] = []
                for word in local_words:
                    start = search_start + float(word.start)
                    end = search_start + float(word.end)
                    line_words.append(Word(start, end, word.text, word.confidence, 0))

                line_span = line_words[-1].end - line_words[0].start if line_words else 0.0
                invalid_line = (
                    len(line_words) != len(tokens)
                    or line_span < timing["minimum"]
                    or (
                        line_words
                        and line_words[0].start < cursor - timing["cursor_backtrack"]
                    )
                    or any(
                        right.start < left.end - timing["overlap_slack"]
                        for left, right in zip(line_words, line_words[1:], strict=False)
                    )
                )
                if invalid_line:
                    local_words = _long_text_line_fallback(
                        tokens,
                        search_end - search_start,
                        candidate_words=candidate or None,
                        minimum_start=local_cursor,
                        audio=line_audio,
                        sample_rate=sample_rate,
                    )
                    line_words = [
                        Word(search_start + word.start, search_start + word.end, word.text, 0.03, 0)
                        for word in local_words
                    ]

                safe_line: list[Word] = []
                for word in line_words:
                    word_start = max(cursor, float(word.start)) if not safe_line else max(safe_line[-1].end, float(word.start))
                    word_end = min(duration_sec, float(word.end))
                    if word_end <= word_start + timing["min_word_duration"]:
                        safe_line = []
                        break
                    safe_line.append(Word(word_start, word_end, word.text, word.confidence, 0))

                # Never publish a partial canonical line. If it cannot fit,
                # leave the local pass and let the lossless whole-song safety
                # pass reconstruct ALL canonical words instead of truncating.
                if len(safe_line) != len(tokens):
                    break
                for word in safe_line:
                    output.append(Word(word.start, word.end, word.text, word.confidence, len(output)))
                cursor = safe_line[-1].end

        self.last_alignment_diagnostics["qwen_fallback_lines"] = qwen_fallback_lines
        self.last_alignment_diagnostics["ctc_words"] = sum(
            len(item.words) for item in ctc_lines if item is not None
        )
        self.last_alignment_diagnostics["published_words_before_guard"] = len(output)

        canonical_tokens = [token for group in groups for token in tokenize(group)]
        raw_ctc_word_count = int(self.last_alignment_diagnostics.get("ctc_words", 0) or 0)
        # Always merge directly from raw CTC results when any acoustic anchors
        # exist.  v14 only invoked the merger after the already-published stream
        # failed canonical validation, which allowed line-level publishing bugs
        # to erase the CTC evidence before the merger ever saw it.
        if raw_ctc_word_count > 0 or not _canonical_words_match(output, canonical_tokens):
            merged, merge_stats = _atomic_line_acoustic_alignment(
                groups,
                ctc_lines,
                output,
                source,
                sample_rate,
                duration_sec,
                anchor_windows,
            )
            preserved_ctc = int(merge_stats.get("ctc", 0) or 0)
            self.last_alignment_diagnostics["preserved_ctc_words"] = preserved_ctc
            self.last_alignment_diagnostics["preserved_qwen_words"] = int(merge_stats.get("qwen", 0) or 0)
            self.last_alignment_diagnostics["interpolated_words"] = int(merge_stats.get("interpolated", 0) or 0)
            self.last_alignment_diagnostics["line_aware_lines"] = int(merge_stats.get("lines", 0) or 0)
            self.last_alignment_diagnostics["line_fallbacks"] = int(merge_stats.get("line_fallbacks", 0) or 0)
            self.last_alignment_diagnostics["dropped_word_anchors"] = int(merge_stats.get("dropped_word_anchors", 0) or 0)
            self.last_alignment_diagnostics["atomic_ctc_lines"] = int(merge_stats.get("atomic_ctc_lines", 0) or 0)
            self.last_alignment_diagnostics["atomic_qwen_lines"] = int(merge_stats.get("atomic_qwen_lines", 0) or 0)
            if "tail_rollback_from_line" in merge_stats:
                self.last_alignment_diagnostics["tail_rollback_from_line"] = int(merge_stats.get("tail_rollback_from_line", 0) or 0)
            if raw_ctc_word_count > 0 and preserved_ctc <= 0:
                # Line-aware mode is allowed to reject every raw acoustic word
                # when the CTC anchors are globally incompatible with the
                # canonical line sequence.  This is not a whole-song failure:
                # the merger already has a complete per-line canonical baseline.
                # Keep diagnostics explicit, but never abort processing.
                self.last_alignment_diagnostics["ctc_all_anchors_rejected"] = True
            if _canonical_words_match(merged, canonical_tokens):
                return merged
            # A partial acoustic pass is no longer fatal. The line-aware
            # merger already fills failed lines from the canonical line baseline.
            # Keep the old lossless fallback only for the impossible case where
            # the merger still returned a non-canonical stream.
            lossless = _lossless_canonical_alignment(
                groups, source, sample_rate, duration_sec, anchor_windows
            )
            if _canonical_words_match(lossless, canonical_tokens):
                return lossless

        if not output:
            # Production safety net: Qwen can occasionally return an empty
            # alignment for an otherwise valid sung-vocal stem.  Do not abort
            # the whole song.  Build a deterministic monotonic timing map from
            # the vocal activity envelope and the trusted lyric line order.
            # Confidence is intentionally low so downstream diagnostics still
            # expose that forced alignment failed.
            active = _activity_quantile_times(source, sample_rate)
            if not active:
                active = [0.0, duration_sec]
            active_start = max(0.0, float(active[0]))
            active_end = min(duration_sec, max(active_start + 0.08, float(active[-1])))
            all_tokens = [token for group in groups for token in tokenize(group)]
            if all_tokens and active_end > active_start + 0.04:
                weights = [max(1, len(token)) for token in all_tokens]
                total_weight = max(1, sum(weights))
                cursor_weight = 0
                fallback: list[Word] = []
                span = active_end - active_start
                for index, (token, weight) in enumerate(zip(all_tokens, weights, strict=True)):
                    start = active_start + span * (cursor_weight / total_weight)
                    cursor_weight += weight
                    end = active_start + span * (cursor_weight / total_weight)
                    if end <= start + 0.019:
                        end = min(duration_sec, start + 0.02)
                    fallback.append(Word(start, end, token, 0.01, index))
                if fallback and fallback[-1].end > fallback[0].start:
                    return fallback
            # Absolute last resort for nearly-silent/degenerate audio.  Preserve
            # text order and return timed words instead of crashing the pipeline.
            if all_tokens and duration_sec > 0.08:
                return [
                    Word(word.start, word.end, word.text, 0.005, word.index)
                    for word in _proportional_words(all_tokens, duration_sec)
                ]
            raise InvalidArtifactError("Long-text forced aligner returned no timed words")
        if not _canonical_words_match(output, canonical_tokens):
            raise InvalidArtifactError("Long-text aligner violated canonical lyric invariant")
        return output


class UniformTextFallback(Transcriber, Aligner):
    name = "uniform-text-fallback"

    def transcribe(self, audio, language):
        return "", []

    def align(self, audio, text, language):
        tokens = tokenize(text)
        total_duration = duration(audio)
        if not tokens:
            return []
        weights = [max(1, len(token)) for token in tokens]
        total_weight = sum(weights)
        cursor = 0.0
        output = []
        for index, (token, weight) in enumerate(zip(tokens, weights, strict=False)):
            start = total_duration * cursor / total_weight
            cursor += weight
            end = total_duration * cursor / total_weight
            output.append(Word(start, end, token, 0.05, index))
        return output
