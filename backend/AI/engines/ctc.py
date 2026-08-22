from __future__ import annotations

import math
import warnings

import numpy as np

from ..errors import EngineUnavailableError, InvalidArtifactError
from ..models import Word
from .device import select_torch_device


class CTCWordAligner:
    def __init__(self, model_path):
        self.model_path = str(model_path)
        self._model = self._processor = self._device = None

    def _load(self):
        if self._model is None:
            import torch
            from transformers import AutoModelForCTC, Wav2Vec2Processor

            self._device = select_torch_device(torch, "ctc")
            self._processor = Wav2Vec2Processor.from_pretrained(self.model_path)
            self._model = AutoModelForCTC.from_pretrained(self.model_path).to(self._device).eval()
        return self._model, self._processor

    def align(self, samples, rate: int, tokens: list[str], offset: float) -> list[Word]:
        import torch
        import torchaudio

        model, processor = self._load()
        audio = torch.as_tensor(np.asarray(samples), dtype=torch.float32)
        if audio.ndim > 1:
            audio = audio.mean(dim=1)
        target_rate = int(processor.feature_extractor.sampling_rate)
        if rate != target_rate:
            audio = torchaudio.functional.resample(audio, rate, target_rate)
        inputs = processor(audio.numpy(), sampling_rate=target_rate, return_tensors="pt")
        with torch.inference_mode():
            logits = model(inputs.input_values.to(self._device)).logits.log_softmax(dim=-1)
        delimiter = processor.tokenizer.word_delimiter_token_id
        targets, ranges = [], []
        for token in tokens:
            if targets:
                targets.append(delimiter)
            start = len(targets)
            ids = processor.tokenizer.encode(token.casefold(), add_special_tokens=False)
            ids = [value for value in ids if value != processor.tokenizer.unk_token_id]
            if not ids:
                raise InvalidArtifactError(f"CTC vocabulary cannot encode {token!r}")
            targets.extend(ids)
            ranges.append((start, len(targets)))
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*forced_align has been deprecated.*")
                path, scores = torchaudio.functional.forced_align(
                    logits, torch.tensor([targets], device=logits.device),
                    blank=int(model.config.pad_token_id),
                )
        except (RuntimeError, ValueError) as error:
            raise EngineUnavailableError(f"CTC forced alignment failed: {error}") from error
        labels, values = path[0].tolist(), scores[0].tolist()
        spans, cursor = [], 0
        for target in targets:
            try:
                start = labels.index(target, cursor)
            except ValueError as error:
                raise InvalidArtifactError("CTC path does not contain the canonical transcript") from error
            end = start + 1
            while end < len(labels) and labels[end] == target:
                end += 1
            spans.append((start, end, values[start:end]))
            cursor = end
        seconds = len(audio) / target_rate / len(labels)
        return [
            Word(
                offset + spans[start][0] * seconds,
                offset + spans[end - 1][1] * seconds,
                token,
                min(1.0, math.exp(sum(sum(item[2]) for item in spans[start:end]) / sum(len(item[2]) for item in spans[start:end]))),
                index,
            )
            for index, (token, (start, end)) in enumerate(zip(tokens, ranges, strict=True))
        ]
