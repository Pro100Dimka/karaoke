from __future__ import annotations

import re
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
from .base import Aligner, Transcriber
from .device import select_torch_device

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
LONG_TEXT_ALIGNMENT_VERSION = "v28-monotonic-canonical-local-qwen"


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
    """Return every canonical lyric token exactly once with monotonic timing.

    ASR anchors are hints only.  This is the final production safety net used
    when local forced alignment loses lines or reaches EOF too early.  It uses
    anchor positions when available and interpolates the rest over the active
    vocal span, so a partial ASR match can never delete lyrics.
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

    # Build desired line weights from sung-duration estimates.
    weights = [max(0.35, _expected_sung_phrase_duration(tokens)) for tokens in line_tokens]
    total_weight = max(1e-6, sum(weights))
    nominal_starts = []
    acc = 0.0
    span = max(0.08, active_end - active_start)
    for weight in weights:
        nominal_starts.append(active_start + span * acc / total_weight)
        acc += weight
    nominal_starts.append(active_end)

    # Blend trustworthy ASR line anchors into the nominal map without allowing
    # backwards jumps or impossible compression.
    anchors = anchor_windows or {}
    fixed: dict[int, float] = {0: active_start, len(line_tokens): active_end}
    for idx, anchor in anchors.items():
        if 0 <= idx < len(line_tokens):
            astart, _aend, score = anchor
            if score >= 0.18:
                fixed[idx] = min(active_end, max(active_start, float(astart)))

    fixed_items = sorted(fixed.items())
    line_starts = list(nominal_starts)
    for (li, lt), (ri, rt) in zip(fixed_items, fixed_items[1:], strict=False):
        li = max(0, min(li, len(line_tokens)))
        ri = max(li + 1, min(ri, len(line_tokens)))
        lt = max(active_start, min(float(lt), active_end))
        rt = max(lt + 0.08, min(float(rt), active_end))
        segment_weight = sum(weights[li:ri]) or 1.0
        acc = 0.0
        for idx in range(li, ri):
            line_starts[idx] = lt + (rt - lt) * acc / segment_weight
            acc += weights[idx]
        line_starts[ri] = rt

    # Enforce monotonic boundaries with a tiny positive room for every line.
    for idx in range(1, len(line_starts)):
        line_starts[idx] = max(line_starts[idx], line_starts[idx - 1] + 0.04)
    if line_starts[-1] > duration_sec:
        scale = (duration_sec - active_start) / max(0.08, line_starts[-1] - active_start)
        line_starts = [active_start + (value - active_start) * scale for value in line_starts]

    output: list[Word] = []
    for line_index, tokens in enumerate(line_tokens):
        if not tokens:
            continue
        start = max(0.0, line_starts[line_index])
        end = min(duration_sec, max(start + 0.08, line_starts[line_index + 1]))
        token_weights = [max(1, len(token)) for token in tokens]
        total = max(1, sum(token_weights))
        cursor_weight = 0
        for token, weight in zip(tokens, token_weights, strict=True):
            word_start = start + (end - start) * cursor_weight / total
            cursor_weight += weight
            word_end = start + (end - start) * cursor_weight / total
            if word_end <= word_start + 0.019:
                word_end = min(duration_sec, word_start + 0.02)
            output.append(Word(word_start, word_end, token, 0.008, len(output)))
    return output


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
        # Singing contains long held notes and instrumental gaps, so a narrow
        # window can omit most of the requested line.  The forced aligner can
        # select the words inside a wider window; give it enough context to do so.
        start = max(0.0, start - 3.0)
        end = min(duration_sec, max(start + 8.0, end + 3.0))
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

    def __init__(self, model="Qwen/Qwen3-ASR-1.7B"):
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
    name = "qwen3-forced-aligner"

    def __init__(self, model="Qwen/Qwen3-ForcedAligner-0.6B"):
        self.model_name = model
        self._model = None
        self._global_asr_segments: list[tuple[float, float, str]] = []

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
        of the TRITIA regression: a six-word phrase was forced into ~0.44 s.

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

                expected = _expected_sung_phrase_duration(tokens)
                anchor = anchor_windows.get(line_index)
                if anchor is not None:
                    anchor_start, anchor_end, anchor_score = anchor
                    search_start = max(0.0, cursor - 0.30, anchor_start - 0.80)
                    minimum_window = max(5.0, expected * 2.25 + 1.5)
                    search_end = min(
                        duration_sec,
                        max(anchor_end + 1.1, search_start + minimum_window),
                    )
                else:
                    search_start = max(0.0, cursor - 0.65)
                    search_span = min(24.0, max(16.0, expected * 3.2 + 5.0))
                    search_end = min(duration_sec, search_start + search_span)
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
                        and candidate_start >= cursor - 0.20
                        and candidate_end > cursor + 0.04
                        and candidate_end <= search_end + 0.10
                        and candidate_span >= _minimum_sung_phrase_duration(tokens)
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
                    or line_span < _minimum_sung_phrase_duration(tokens)
                    or (line_words and line_words[0].start < cursor - 0.20)
                    or any(
                        right.start < left.end - 0.02
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
                    if word_end <= word_start + 0.019:
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

        canonical_tokens = [token for group in groups for token in tokenize(group)]
        if not _canonical_words_match(output, canonical_tokens):
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
