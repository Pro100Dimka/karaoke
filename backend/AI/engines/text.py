from __future__ import annotations

from collections.abc import Iterable
from collections import Counter
from pathlib import Path
import re

import numpy as np

from ..audio import load_mono

from .base import Aligner, Transcriber
from .device import select_torch_device
from ..audio import duration
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..models import Word

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
            if isinstance(value, (list, tuple)) and len(value) == 1 and isinstance(value[0], (list, tuple)):
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



ASR_PIPELINE_VERSION = "singing-segmented-v3"


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


def _singing_chunks(y: np.ndarray, sr: int) -> list[np.ndarray]:
    """Split long singing audio near energy valleys, not at fixed seconds."""
    if y.size == 0:
        return []
    total_sec = len(y) / sr
    if total_sec <= 32.0:
        return [_normalize_singing_audio(y)]

    hop = max(1, int(sr * 0.025))
    frame = max(hop, int(sr * 0.05))
    count = max(1, (len(y) + hop - 1) // hop)
    rms = np.empty(count, dtype=np.float32)
    for index in range(count):
        start = index * hop
        chunk = y[start:min(len(y), start + frame)]
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
            region = rms[lo_i:hi_i + 1]
            # Prefer an actual low-energy valley, but do not require literal silence
            # because source-separated vocals retain some bleed.
            local = int(np.argmin(region))
            cut_sec = (lo_i + local) * hop / sr
        cut_sample = max(starts[-1] + int(minimum * sr), min(len(y), int(cut_sec * sr)))
        starts.append(cut_sample)
        cursor_sec = cut_sample / sr

    starts.append(len(y))
    chunks: list[np.ndarray] = []
    for left, right in zip(starts, starts[1:]):
        segment = y[left:right]
        if segment.size >= int(0.4 * sr):
            chunks.append(_normalize_singing_audio(segment))
    return chunks or [_normalize_singing_audio(y)]


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
            block = tokens[index:index + width]
            repeats = 1
            cursor = index + width
            while tokens[cursor:cursor + width] == block:
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


def _merge_transcript_parts(parts: list[str]) -> str:
    merged: list[str] = []
    for part in parts:
        tokens = _clean_transcript_part(part).split()
        if not tokens:
            continue
        overlap = 0
        maximum = min(8, len(merged), len(tokens))
        for size in range(maximum, 1, -1):
            if [item.casefold() for item in merged[-size:]] == [item.casefold() for item in tokens[:size]]:
                overlap = size
                break
        merged.extend(tokens[overlap:])
    return " ".join(merged).strip()


def _majority_language(values: list[str | None], requested: str | None) -> str | None:
    normalized = [_language_name(value) for value in values if value]
    normalized = [value for value in normalized if value]
    if normalized:
        return Counter(normalized).most_common(1)[0][0]
    return _language_name(requested)

class Qwen3Transcriber(Transcriber):
    name = "qwen3-asr"

    def __init__(self, model="Qwen/Qwen3-ASR-0.6B"):
        self.model_name = model
        self._model = None
        self.last_language: str | None = None

    def _load(self):
        try:
            import torch
            from qwen_asr import Qwen3ASRModel
        except ImportError as exc:
            raise EngineUnavailableError("Install the official qwen-asr package") from exc
        if self._model is None:
            device = select_torch_device(torch)
            use_cuda = device.startswith("cuda")
            kwargs = {
                "device_map": device,
                "dtype": torch.float16 if use_cuda else torch.float32,
                "max_inference_batch_size": 1,
                "max_new_tokens": 256,
            }
            self._model = Qwen3ASRModel.from_pretrained(self.model_name, **kwargs)
            generation_config = getattr(getattr(self._model, "model", self._model), "generation_config", None)
            if generation_config is not None and getattr(generation_config, "pad_token_id", None) is None:
                eos_token_id = getattr(generation_config, "eos_token_id", None)
                if eos_token_id is not None:
                    generation_config.pad_token_id = eos_token_id
        return self._model

    def transcribe(self, audio, language):
        model = self._load()
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
            self.last_language = _language_name(_first(item, ("language", "lang"), None)) or requested_language
            return text, _words_from_items(_unwrap_items(item))

        y, sr = load_mono(audio, 16000)
        chunks = _singing_chunks(y, sr)

        # Long songs are recognized phrase-by-phrase. This substantially reduces
        # singing hallucinations and forgotten lines compared with giving the
        # autoregressive ASR an entire 3-5 minute vocal stem in one request.
        inputs = [(chunk, sr) for chunk in chunks]
        languages = [requested_language] * len(inputs) if requested_language else [None] * len(inputs)
        kwargs = {"audio": inputs if len(inputs) > 1 else inputs[0]}
        if len(inputs) > 1:
            kwargs["language"] = languages
        elif requested_language:
            kwargs["language"] = requested_language

        try:
            result = model.transcribe(**kwargs)
        except (TypeError, ValueError):
            # Compatibility path for qwen-asr builds that do not accept a batch
            # of numpy tuples. We still keep the high-quality segmentation.
            result = []
            for item_audio in inputs:
                item_kwargs = {"audio": item_audio}
                if requested_language:
                    item_kwargs["language"] = requested_language
                partial = model.transcribe(**item_kwargs)
                if isinstance(partial, (list, tuple)):
                    result.extend(partial)
                else:
                    result.append(partial)

        results = list(result) if isinstance(result, (list, tuple)) else [result]
        parts: list[str] = []
        detected: list[str | None] = []
        direct_words: list[Word] = []
        for raw in results:
            item = _unwrap_single_result(raw)
            part = str(_first(item, ("text", "transcription"), "") or "").strip()
            if part:
                parts.append(part)
            detected.append(_first(item, ("language", "lang"), None))
            # Direct timestamps are only trustworthy for a single full-audio
            # request. Chunk timestamps are local to each chunk; the full-text
            # forced aligner below is more accurate for the final song timeline.
            if len(inputs) == 1:
                direct_words = _words_from_items(_unwrap_items(item))

        text = _merge_transcript_parts(parts)
        self.last_language = _majority_language(detected, requested_language)
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
        for index, (token, weight) in enumerate(zip(tokens, weights)):
            start = total_duration * cursor / total_weight
            cursor += weight
            end = total_duration * cursor / total_weight
            output.append(Word(start, end, token, 0.05, index))
        return output
