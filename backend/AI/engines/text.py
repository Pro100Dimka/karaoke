from __future__ import annotations

from collections.abc import Iterable
import re

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
                "max_new_tokens": 1024,
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
        kwargs = {"audio": str(audio)}
        # Omitting the argument is the official auto-detection path and avoids
        # passing a nullable value through older qwen-asr wrappers.
        if requested_language:
            kwargs["language"] = requested_language
        result = model.transcribe(**kwargs)
        item = _unwrap_single_result(result)
        text = str(_first(item, ("text", "transcription"), "") or "").strip()
        detected_language = _first(item, ("language", "lang"), None)
        self.last_language = _language_name(detected_language) or requested_language
        words = _words_from_items(_unwrap_items(item))
        return text, words


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
