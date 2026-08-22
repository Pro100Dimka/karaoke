from __future__ import annotations

import os
import unicodedata
from math import ceil

from ..audio import duration
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..models import Word
from .base import Aligner, Transcriber
from .device import select_torch_device

ASR_PIPELINE_VERSION = LONG_TEXT_ALIGNMENT_VERSION = "clean-v1"
LANGUAGES = {"en": "English", "ru": "Russian", "uk": "Ukrainian"}


def tokenize(text: str) -> list[str]:
    def kept(char: str) -> bool:
        return char == "'" or unicodedata.category(char)[:1] in {"L", "N"}

    result = []
    for part in text.split():
        positions = [index for index, char in enumerate(part) if kept(char)]
        if positions:
            result.append(part[positions[0]:positions[-1] + 1])
    return result


def resolve_alignment_language(text: str, language: str | None = None) -> str:
    if language:
        value = language.split("-")[0].lower()
        return LANGUAGES.get(value, language)
    lowered = text.lower()
    if any(char in lowered for char in "іїєґ"):
        return "Ukrainian"
    return "Russian" if any("а" <= char <= "я" or char == "ё" for char in lowered) else "English"


def _items(value):
    if isinstance(value, dict):
        return value.get("words") or value.get("items") or value.get("segments") or []
    if hasattr(value, "items"):
        return value.items
    return value if isinstance(value, (list, tuple)) else []


def _words(value) -> list[Word]:
    result = []
    for index, item in enumerate(_items(value)):
        data = item if isinstance(item, dict) else vars(item) if hasattr(item, "__dict__") else {
            "text": getattr(item, "text", ""),
            "start_time": getattr(item, "start_time", None),
            "end_time": getattr(item, "end_time", None),
        }
        text = str(data.get("text") or data.get("word") or "").strip()
        try:
            result.append(Word(float(data.get("start", data.get("start_time"))), float(data.get("end", data.get("end_time"))), text, float(data.get("confidence", 1)), index))
        except (TypeError, ValueError):
            continue
    return result


def _invalid(word: Word, span: float) -> bool:
    return word.start < 0 or word.end <= word.start or word.end > span + 0.1


def _invalid_runs(words: list[Word], span: float) -> list[tuple[int, int]]:
    indices = [index for index, word in enumerate(words) if _invalid(word, span)]
    runs: list[list[int]] = []
    for index in indices:
        if not runs or index - runs[-1][1] > 11:
            runs.append([index, index + 1])
        else:
            runs[-1][1] = index + 1
    return [(start, end) for start, end in runs]


def _load(model_class, name, role):
    import torch

    device = select_torch_device(torch, role)
    return model_class.from_pretrained(name, device_map=device, dtype=torch.float16 if device == "cuda" else torch.float32)


class Qwen3Transcriber(Transcriber):
    name = "qwen3-asr"

    def __init__(self, model: str):
        self.model_name, self._model = model, None

    def _load(self):
        try:
            from qwen_asr import Qwen3ASRModel
        except ImportError as error:
            raise EngineUnavailableError("qwen-asr is unavailable") from error
        if self._model is None:
            self._model = _load(Qwen3ASRModel, self.model_name, "asr")
        return self._model

    def transcribe(self, audio, language):
        kwargs = {"audio": str(audio)}
        if language:
            kwargs["language"] = resolve_alignment_language("", language)
        raw = self._load().transcribe(**kwargs)
        item = raw[0] if isinstance(raw, (list, tuple)) and raw else raw
        text = str(item.get("text", "") if isinstance(item, dict) else getattr(item, "text", item)).strip()
        return text, _words(item)


class Qwen3ForcedAligner(Aligner):
    name = "qwen3-forced-aligner"

    def __init__(self, model: str):
        self.model_name, self._model, self._ctc = model, None, {}

    def _load(self):
        try:
            from qwen_asr import Qwen3ForcedAligner
        except ImportError as error:
            raise EngineUnavailableError("Qwen forced aligner is unavailable") from error
        if self._model is None:
            self._model = _load(Qwen3ForcedAligner, self.model_name, "aligner")
        return self._model

    def _raw(self, audio, text, language) -> list[Word]:
        raw = self._load().align(audio=str(audio), text=text, language=resolve_alignment_language(text, language))
        item = raw[0] if isinstance(raw, (list, tuple)) and len(raw) == 1 else raw
        return _words(item)

    @staticmethod
    def _validate(words: list[Word], tokens: list[str], span: float) -> list[Word]:
        if len(words) != len(tokens):
            raise InvalidArtifactError(f"Aligner returned {len(words)} words for {len(tokens)} tokens")
        if invalid := [(index, word.start, word.end) for index, word in enumerate(words) if _invalid(word, span)]:
            index, start, end = invalid[0]
            raise InvalidArtifactError(
                f"Aligner returned {len(invalid)} invalid timestamps; first is "
                f"token {index} ({tokens[index]!r}) at {start:.3f}..{end:.3f}"
            )
        if disorder := [
            index for index in range(1, len(words))
            if words[index].start + 1e-6 < words[index - 1].start
        ]:
            index = disorder[0]
            raise InvalidArtifactError(
                f"Aligner returned {len(disorder)} out-of-order words; token {index} "
                f"({tokens[index]!r}) starts at {words[index].start:.3f} before "
                f"{words[index - 1].start:.3f}"
            )
        return [Word(word.start, word.end, token, word.confidence, index) for index, (word, token) in enumerate(zip(words, tokens, strict=True))]

    def align(self, audio, text, language):
        return self._validate(self._raw(audio, text, language), tokenize(text), duration(audio))

    def align_timed_lines(self, audio, text, lines, language):
        import soundfile as sf

        tokens, span = tokenize(text), duration(audio)
        entries, flattened = [], []
        for line in lines:
            lower, line_tokens = len(flattened), tokenize(line.text)
            flattened.extend(line_tokens)
            entries.append((float(line.start), lower, len(flattened)))
        def normalized(values):
            return [
                "".join(char for char in value.casefold() if char.isalnum() or char == "'")
                for value in values
            ]
        if normalized(flattened) != normalized(tokens):
            raise InvalidArtifactError("Synchronized lyric lines do not match canonical lyrics")
        samples, rate = sf.read(audio, dtype="float32", always_2d=False)
        groups, first = [], 0
        while first < len(entries):
            last = first + 1
            while last < len(entries) and entries[last][0] - entries[first][0] < 24:
                last += 1
            start = max(0, entries[first][0] - 0.75)
            end = min(span, (entries[last][0] if last < len(entries) else span) + 0.75)
            groups.append((entries[first][1], entries[last - 1][2], start, end))
            first = last
        words: list[Word | None] = [None] * len(tokens)

        def apply(specs):
            specs = [spec for spec in specs if spec[3] - spec[2] >= 0.5]
            if not specs:
                return
            results = self._load().align(
                audio=[(samples[round(start * rate):round(end * rate)], rate) for _, _, start, end in specs],
                text=[" ".join(tokens[lower:upper]) for lower, upper, *_ in specs],
                language=[resolve_alignment_language(text, language)] * len(specs),
            )
            for (lower, upper, offset, end), result in zip(specs, results, strict=True):
                local = _words(result)
                if len(local) != upper - lower:
                    continue
                for index, word in enumerate(local, start=lower):
                    if words[index] is None and not _invalid(word, end - offset):
                        candidate = Word(
                            word.start + offset, word.end + offset,
                            tokens[index], word.confidence, index,
                        )
                        left = words[index - 1] if index else None
                        right = words[index + 1] if index + 1 < len(words) else None
                        if (left is None or candidate.start + 1e-6 >= left.start) and (
                            right is None or candidate.start <= right.start + 1e-6
                        ):
                            words[index] = candidate

        apply(groups)
        if any(word is None for word in words):
            per_line = []
            for index, (start, lower, upper) in enumerate(entries):
                if any(word is None for word in words[lower:upper]):
                    end = entries[index + 1][0] if index + 1 < len(entries) else span
                    per_line.append((lower, upper, max(0, start - 0.5), min(span, end + 0.5)))
            apply(per_line)
        if any(word is None for word in words):
            contexts = []
            for index, (_, lower, upper) in enumerate(entries):
                if any(word is None for word in words[lower:upper]):
                    first, last = max(0, index - 1), min(len(entries), index + 2)
                    start = max(0, entries[first][0] - 1)
                    end = min(span, (entries[last][0] if last < len(entries) else span) + 1)
                    contexts.append((entries[first][1], entries[last - 1][2], start, end))
            apply(contexts)
        triads = []
        for _, lower, upper in entries:
            for index in range(lower + 1, upper - 1):
                if words[index] is None and words[index - 1] is not None and words[index + 1] is not None:
                    start = max(0, words[index - 1].start - 0.5)
                    end = min(span, words[index + 1].end + 0.5)
                    triads.append((index - 1, index + 2, start, end))
        if triads:
            apply(triads)
        singles = []
        for _, lower, upper in entries:
            for index in range(lower + 1, upper - 1):
                if words[index] is None and words[index - 1] is not None and words[index + 1] is not None:
                    center = (words[index - 1].end + words[index + 1].start) / 2
                    start = max(words[index - 1].start, center - 1)
                    end = min(words[index + 1].end, center + 1)
                    if end > start:
                        singles.append((index, index + 1, start, end))
        if singles:
            apply(singles)
        wide_singles = []
        for line_index, (line_start, lower, upper) in enumerate(entries):
            line_end = entries[line_index + 1][0] if line_index + 1 < len(entries) else span
            for index in range(lower, upper):
                if words[index] is None:
                    wide_singles.append((
                        index, index + 1, max(0, line_start - 0.75), min(span, line_end + 0.75)
                    ))
        if wide_singles:
            apply(wide_singles)
        if any(word is None for word in words):
            resolved = resolve_alignment_language(text, language)
            variable = {
                "Russian": "KARAOKE_AI_CTC_RU_MODEL",
                "Ukrainian": "KARAOKE_AI_CTC_UK_MODEL",
            }.get(resolved)
            if variable and (model_path := os.getenv(variable)):
                from .ctc import CTCWordAligner

                ctc = self._ctc.setdefault(model_path, CTCWordAligner(model_path))
                for line_index, (start, lower, upper) in enumerate(entries):
                    if not any(word is None for word in words[lower:upper]):
                        continue
                    end = entries[line_index + 1][0] if line_index + 1 < len(entries) else span
                    segment = samples[round(start * rate):round(end * rate)]
                    try:
                        words[lower:upper] = ctc.align(segment, rate, tokens[lower:upper], start)
                    except (EngineUnavailableError, InvalidArtifactError):
                        continue
        for _, lower, upper in entries:
            for index in range(lower + 1, upper - 1):
                if words[index] is not None or words[index - 1] is None or words[index + 1] is None:
                    continue
                start, end = words[index - 1].end, words[index + 1].start
                if end > start:
                    confidence = min(words[index - 1].confidence, words[index + 1].confidence)
                    words[index] = Word(start, end, tokens[index], confidence, index)
        quantum = float(getattr(self._load(), "timestamp_segment_time", 80)) / 1000
        for index in range(len(words) - 1):
            following = words[index + 1]
            if words[index] is not None or tokens[index].casefold() not in {"в", "с", "к", "з"} or following is None:
                continue
            end = min(following.end, following.start + quantum)
            if index + 2 < len(words) and words[index + 2] is not None:
                end = min(end, words[index + 2].start)
            if end > following.start and following.end > end:
                words[index] = Word(following.start, end, tokens[index], following.confidence, index)
                words[index + 1] = Word(
                    end, following.end, tokens[index + 1], following.confidence, index + 1
                )
        unresolved = [index for index, word in enumerate(words) if word is None]
        if unresolved:
            details = ", ".join(f"{index}:{tokens[index]!r}" for index in unresolved[:12])
            raise InvalidArtifactError(
                f"Timed acoustic alignment failed for {len(unresolved)} words ({details})"
            )
        return self._validate([word for word in words if word is not None], tokens, span)

    def _align_windows(self, samples, rate, tokens: list[str], span: float, language: str) -> list[Word]:
        window = 150.0
        count = ceil(max(0, span - window) / 120) + 1
        starts = [index * max(0, span - window) / max(1, count - 1) for index in range(count)]
        margin = max(8, ceil(len(tokens) * 0.08))
        requests = []
        for start in starts:
            end = min(span, start + window)
            lower = max(0, int(start / span * len(tokens)) - margin)
            upper = min(len(tokens), ceil(end / span * len(tokens)) + margin)
            segment = samples[round(start * rate):round(end * rate)]
            requests.append((lower, upper, start, end, segment))
        results = self._load().align(
            audio=[(segment, rate) for *_, segment in requests],
            text=[" ".join(tokens[lower:upper]) for lower, upper, *_ in requests],
            language=[language] * len(requests),
        )
        candidates: list[list[tuple[float, Word]]] = [[] for _ in tokens]
        for (lower, upper, offset, end, _), result in zip(requests, results, strict=True):
            local = _words(result)
            if len(local) != upper - lower:
                continue
            for index, word in enumerate(local, start=lower):
                if not _invalid(word, end - offset):
                    absolute = Word(word.start + offset, word.end + offset, tokens[index], word.confidence, index)
                    edge = min(absolute.start - offset, end - absolute.end)
                    candidates[index].append((edge, absolute))
        words, previous = [], 0.0
        for index, options in enumerate(candidates):
            ordered = sorted(options, key=lambda item: item[0], reverse=True)
            selected = next((word for _, word in ordered if word.start + 1e-6 >= previous), None)
            selected = selected or Word(previous, previous, tokens[index], 0, index)
            words.append(selected)
            previous = selected.start
        return words

    def align_long_text(self, audio, text, language):
        import soundfile as sf

        tokens, span = tokenize(text), duration(audio)
        resolved = resolve_alignment_language(text, language)
        samples = rate = None
        if span > 150:
            samples, rate = sf.read(audio, dtype="float32", always_2d=False)
            words = self._align_windows(samples, rate, tokens, span, resolved)
        else:
            words = self._raw(audio, text, resolved)
        if len(words) != len(tokens) or not _invalid_runs(words, span):
            return self._validate(words, tokens, span)
        if samples is None:
            samples, rate = sf.read(audio, dtype="float32", always_2d=False)
        repairs = []
        for start, end in _invalid_runs(words, span):
            lower, upper = max(0, start - 5), min(len(words), end + 5)
            crop_start = max(0, words[lower].start - 1) if lower < start and not _invalid(words[lower], span) else 0
            crop_end = min(span, words[upper - 1].end + 1) if upper > end and not _invalid(words[upper - 1], span) else span
            if crop_end > crop_start:
                segment = samples[round(crop_start * rate):round(crop_end * rate)]
                repairs.append((lower, upper, crop_start, crop_end, segment))
        if repairs:
            aligned = self._load().align(
                audio=[(segment, rate) for *_, segment in repairs],
                text=[" ".join(tokens[lower:upper]) for lower, upper, *_ in repairs],
                language=[resolve_alignment_language(text, language)] * len(repairs),
            )
            for (lower, upper, offset, crop_end, _), result in zip(repairs, aligned, strict=True):
                local = _words(result)
                if len(local) == upper - lower and not any(_invalid(word, crop_end - offset) for word in local):
                    words[lower:upper] = [
                        Word(word.start + offset, word.end + offset, token, word.confidence, index)
                        for index, (word, token) in enumerate(
                            zip(local, tokens[lower:upper], strict=True), start=lower
                        )
                    ]
        return self._validate(words, tokens, span)


class UniformTextFallback(Transcriber, Aligner):
    name = "uniform-fallback"

    def align(self, audio, text, language):
        tokens, span = tokenize(text), duration(audio)
        return [Word(index * span / len(tokens), (index + 1) * span / len(tokens), token, 0, index) for index, token in enumerate(tokens)] if tokens else []

    def align_long_text(self, audio, text, language):
        return self.align(audio, text, language)

    def transcribe(self, audio, language):
        return "", []
