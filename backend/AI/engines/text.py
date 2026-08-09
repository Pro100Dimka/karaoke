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

_TOKEN = re.compile(r"[\w’'-]+", re.UNICODE)
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


ASR_PIPELINE_VERSION = "singing-batched-script-consensus-v12-segmented-alignment"
LONG_TEXT_ALIGNMENT_VERSION = "v2-short-windows-pathology-guard"


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


def _group_lyric_text(text: str, target_words: int = 9, maximum_words: int = 12) -> list[str]:
    """Build aligner-sized phrases while preserving author-provided line order."""
    groups: list[str] = []
    current: list[str] = []
    current_words = 0
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line:
            if current:
                groups.append(" ".join(current))
                current = []
                current_words = 0
            continue
        line_words = len(tokenize(line))
        if current and current_words + line_words > maximum_words:
            groups.append(" ".join(current))
            current = []
            current_words = 0
        current.append(line)
        current_words += line_words
        if current_words >= target_words:
            groups.append(" ".join(current))
            current = []
            current_words = 0
    if current:
        groups.append(" ".join(current))
    return groups


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
        start = max(0.0, start - 1.6)
        end = min(duration_sec, max(start + 3.0, end + 1.6))
        output.append((start, end, group))
    return output


def _pathological_alignment(words: list[Word], span: float) -> bool:
    """Detect context collapse before it reaches lyrics and MIDI artefacts."""
    if not words:
        return True
    durations = [max(0.0, word.end - word.start) for word in words]
    collapsed = sum(duration <= 0.025 for duration in durations)
    return max(durations) > max(4.5, span * 0.62) or collapsed > max(2, len(words) // 4)


def _proportional_words(tokens: list[str], span: float) -> list[Word]:
    weights = [max(1, len(token)) for token in tokens]
    total = sum(weights)
    offset = 0
    output = []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = span * offset / total
        offset += weight
        word_end = span * offset / total
        output.append(Word(word_start, word_end, token, 0.05, index))
    return output


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


class Qwen3ForcedAligner(Aligner):
    name = "qwen3-forced-aligner"

    def __init__(self, model="Qwen/Qwen3-ForcedAligner-0.6B"):
        self.model_name = model
        self._model = None

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
        return words

    def align_segments(self, audio, segments, language):
        """Align short ASR-owned phrases and return one global word timeline.

        Qwen's forced aligner can collapse a long song after its context limit,
        assigning dozens of words the same timestamp. The ASR already split the
        vocal at acoustic valleys, so reuse those exact windows for alignment.
        """
        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailableError("soundfile is required for segmented alignment") from exc

        source, sample_rate = load_mono(audio, 16000)
        output: list[Word] = []
        cursor = 0.0
        with tempfile.TemporaryDirectory(prefix="karaoke-align-") as temp_dir:
            root = Path(temp_dir)
            for segment_index, (start, end, text) in enumerate(
                sorted(segments, key=lambda item: (float(item[0]), float(item[1])))
            ):
                tokens = tokenize(text)
                if not tokens:
                    continue
                segment_start = max(0.0, float(start))
                segment_end = max(segment_start + 0.02, float(end))
                left = max(0, min(max(0, len(source) - 1), int(segment_start * sample_rate)))
                right = max(left + 1, min(len(source), int(segment_end * sample_rate)))
                path = root / f"segment-{segment_index:03d}.wav"
                sf.write(path, source[left:right], sample_rate, subtype="PCM_16")
                try:
                    local_words = self.align(path, text, language)
                    if _pathological_alignment(local_words, segment_end - segment_start):
                        local_words = _proportional_words(
                            tokens, max(0.08, segment_end - segment_start)
                        )
                except (InvalidArtifactError, RuntimeError, ValueError):
                    span = max(0.08, segment_end - segment_start)
                    local_words = _proportional_words(tokens, span)

                for word in local_words:
                    word_start = max(cursor, segment_start + word.start)
                    word_end = max(word_start + 0.02, segment_start + word.end)
                    word_end = min(max(segment_end, word_start + 0.02), word_end)
                    output.append(
                        Word(
                            word_start,
                            word_end,
                            word.text,
                            word.confidence,
                            len(output),
                        )
                    )
                    cursor = word_end
        if not output:
            raise InvalidArtifactError("Segmented forced aligner returned no timed words")
        return output

    def align_long_text(self, audio, text, language):
        """Align trusted full-song lyrics without overflowing model context."""
        segments = _long_text_segments(audio, text)
        if len(segments) <= 1:
            return self.align(audio, text, language)
        return self.align_segments(audio, segments, language)


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
