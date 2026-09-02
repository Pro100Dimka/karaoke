from __future__ import annotations

import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from ..errors import ProcessingCancelledError
from ..models import PitchFrame, VocalNote, Word

_STRUCTURAL = re.compile(
    r"<P_(?P<pitch>\d{1,3})>|"
    r"<NOTE_(?P<note>(?:DOT_)?(?:1|2|4|8|16|32))>|"
    r"<BPM_(?P<bpm>\d{1,3})>"
)
_NOTE_BEATS = {
    "32": 0.125,
    "DOT_32": 0.1875,
    "16": 0.25,
    "DOT_16": 0.375,
    "8": 0.5,
    "DOT_8": 0.75,
    "4": 1.0,
    "DOT_4": 1.5,
    "2": 2.0,
    "DOT_2": 3.0,
    "1": 4.0,
    "DOT_1": 6.0,
}


def _checkpoint_embedding_vocab(checkpoint: str | Path) -> int:
    from safetensors import safe_open

    with safe_open(checkpoint, framework="pt", device="cpu") as values:
        shape = values.get_slice(
            "thinker.model.embed_tokens.weight"
        ).get_shape()
    if len(shape) != 2 or int(shape[0]) <= 0:
        raise ValueError("Invalid VocalParse embedding tensor")
    return int(shape[0])


def _set_checkpoint_vocab_size(config, vocab_size: int) -> None:
    config.thinker_config.text_config.vocab_size = int(vocab_size)


def _score_generation_budget(lyrics: str) -> int:
    characters = sum(character.isalnum() for character in str(lyrics))
    return max(32, min(160, 16 + 3 * characters))


class _GenerationGuard:
    def __init__(
        self,
        *,
        cancelled=None,
        timeout_seconds: float = 35.0,
        clock=time.monotonic,
    ):
        self.cancelled = cancelled
        self.clock = clock
        self.deadline = clock() + max(0.1, float(timeout_seconds))
        self.triggered = False

    def should_stop(self) -> bool:
        return bool(
            (callable(self.cancelled) and self.cancelled())
            or self.clock() >= self.deadline
        )

    def __call__(self, input_ids, _scores, **_kwargs):
        import torch

        self.triggered = self.should_stop()
        return torch.full(
            (input_ids.shape[0],),
            self.triggered,
            dtype=torch.bool,
            device=input_ids.device,
        )


@dataclass(frozen=True, slots=True)
class SymbolicEvent:
    beat: float
    beats: float
    midi_note: int | None
    lyric: str | None = None


@dataclass(frozen=True, slots=True)
class SymbolicScore:
    bpm: int | None
    events: tuple[SymbolicEvent, ...]


@dataclass(frozen=True, slots=True)
class ScoreLine:
    text: str
    start: float
    end: float
    first_word: int
    last_word: int

    def __post_init__(self) -> None:
        if not self.text.strip() or self.end <= self.start:
            raise ValueError("Invalid score line")
        if self.first_word < 0 or self.last_word < self.first_word:
            raise ValueError("Invalid score line word range")


def _label(value: str) -> str | None:
    normalized = " ".join(value.replace("<|endoftext|>", "").split())
    return normalized or None


def parse_vocalparse_score(raw: str) -> SymbolicScore:
    """Parse the stable VocalParse AST subset and discard generated tail noise."""
    value = str(raw or "")
    ast = value.rsplit("<|file_sep|>", 1)[-1]
    matches = list(_STRUCTURAL.finditer(ast))
    bpms = [int(match.group("bpm")) for match in matches if match.group("bpm")]
    bpm = bpms[-1] if bpms else None
    first_bpm = next(
        (match.start() for match in matches if match.group("bpm")), len(ast)
    )
    ast = ast[:first_bpm]

    events: list[SymbolicEvent] = []
    beat = 0.0
    cursor = 0
    pending_label: str | None = None
    pending_pitch: int | None = None
    saw_pitch = False
    for match in _STRUCTURAL.finditer(ast):
        text = _label(ast[cursor:match.start()])
        if text:
            pending_label = text
        cursor = match.end()
        if match.group("pitch") is not None:
            pitch = int(match.group("pitch"))
            pending_pitch = pitch if 0 < pitch <= 127 else None
            saw_pitch = True
            continue
        if match.group("note") is None or not saw_pitch:
            continue
        beats = _NOTE_BEATS[match.group("note")]
        events.append(SymbolicEvent(beat, beats, pending_pitch, pending_label))
        beat += beats
        pending_label = None
        pending_pitch = None
        saw_pitch = False
    for index in range(1, len(events)):
        previous, current = events[index - 1], events[index]
        if (
            previous.midi_note is None
            and (previous.lyric or "").upper() in {"SP", "AP"}
            and current.midi_note is None
            and current.lyric is not None
            and current.lyric.upper() not in {"SP", "AP"}
        ):
            events = events[:index]
            break
    return SymbolicScore(bpm=bpm, events=tuple(events))


def _midi(frequency: float) -> float:
    return 69.0 + 12.0 * math.log2(frequency / 440.0)


def _physical_anchored_pitch(
    symbolic: int,
    pitch: list[PitchFrame],
    start: float,
    end: float,
) -> int:
    physical = [
        _midi(frame.frequency)
        for frame in pitch
        if frame.voiced and frame.confidence >= 0.35 and start <= frame.time < end
    ]
    if not physical:
        return symbolic
    anchor = median(physical)
    pitch_class = symbolic % 12
    candidates = range(pitch_class, 128, 12)
    return min(
        candidates,
        key=lambda candidate: (abs(candidate - anchor), abs(candidate - symbolic)),
    )


def _letters(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def trim_score_for_lyrics(score: SymbolicScore, lyrics: str) -> SymbolicScore:
    expected = _letters(lyrics)
    if not expected or not score.events:
        return score
    cursor = 0
    trimmed: list[SymbolicEvent] = []
    saw_voice = False
    for event in score.events:
        label = _letters(event.lyric or "")
        marker = (event.lyric or "").upper()
        if marker in {"SP", "AP"}:
            trimmed.append(event)
            if saw_voice and cursor / len(expected) >= 0.7:
                break
            continue
        if label:
            found = expected.find(label, cursor)
            if found >= 0:
                cursor = found + len(label)
            elif cursor / len(expected) >= 0.7:
                break
        trimmed.append(event)
        saw_voice = saw_voice or event.midi_note is not None
    return SymbolicScore(score.bpm, tuple(trimmed))


def _event_owners(words: list[Word], events: tuple[SymbolicEvent, ...]) -> list[int | None]:
    normalized = [_letters(word.text) for word in words]
    current = 0
    consumed = 0
    last_owner: int | None = None
    owners: list[int | None] = []
    for event in events:
        if event.midi_note is None:
            owners.append(None)
            continue
        label = _letters(event.lyric or "")
        if label:
            start = current + (1 if current < len(words) and consumed >= len(normalized[current]) else 0)
            selected = None
            for candidate in range(start, min(len(words), start + 3)):
                offset = consumed if candidate == current else 0
                remaining = normalized[candidate][offset:]
                if remaining.startswith(label) or label.startswith(remaining):
                    selected = candidate
                    consumed = min(len(normalized[candidate]), offset + len(label))
                    break
            if selected is not None:
                current = selected
                last_owner = selected
        if last_owner is None:
            last_owner = min(current, len(words) - 1)
        owners.append(last_owner)
    return owners


def project_symbolic_score(
    words: list[Word],
    score: SymbolicScore,
    *,
    line_start: float,
    line_end: float,
    pitch: list[PitchFrame],
) -> tuple[list[Word], list[VocalNote]]:
    """Project beat-valued AST events into one force-aligned lyric line."""
    if not words or not score.events or line_end <= line_start:
        return words, []
    owners = _event_owners(words, score.events)
    notes: list[VocalNote] = []
    fitted: list[Word] = []
    for position, word in enumerate(words):
        owned_events = [
            event
            for event, owner in zip(score.events, owners, strict=True)
            if owner == position and event.midi_note is not None
        ]
        next_start = words[position + 1].start if position + 1 < len(words) else line_end
        owned_beats = sum(event.beats for event in owned_events)
        if position + 1 < len(words):
            end = max(word.start + 0.001, next_start)
        elif score.bpm and owned_beats:
            end = min(
                line_end,
                max(word.start + 0.05, word.start + owned_beats * 60.0 / score.bpm),
            )
        else:
            end = max(word.start + 0.001, min(line_end, word.end))
        if owned_events and owned_beats > 0 and end > word.start:
            cursor = word.start
            scale = (end - word.start) / owned_beats
            for event in owned_events:
                note_end = min(end, cursor + event.beats * scale)
                notes.append(VocalNote(
                    cursor,
                    note_end,
                    _physical_anchored_pitch(
                        event.midi_note, pitch, cursor, note_end
                    ),
                    word_index=word.index,
                ))
                cursor = note_end
        fitted.append(Word(word.start, end, word.text, word.confidence, word.index))
    return fitted, notes


def project_song_scores(
    words: list[Word],
    lines: list[ScoreLine],
    scores: list[SymbolicScore],
    *,
    pitch: list[PitchFrame],
    physical_notes: list[VocalNote] | tuple[VocalNote, ...] = (),
) -> tuple[list[Word], list[VocalNote]]:
    if len(lines) != len(scores):
        raise ValueError("Every lyric line must have one symbolic score")
    by_index = {word.index: word for word in words}
    replaced: dict[int, Word] = {}
    notes: list[VocalNote] = []
    for line, score in zip(lines, scores, strict=True):
        if not score.events:
            raise ValueError(f"Incomplete symbolic score for lyric line: {line.text}")
        line_words = [
            by_index[index]
            for index in range(line.first_word, line.last_word + 1)
            if index in by_index
        ]
        fitted, symbolic_notes = project_symbolic_score(
            line_words,
            score,
            line_start=line.start,
            line_end=line.end,
            pitch=pitch,
        )
        physical_by_word: dict[int, list[VocalNote]] = {}
        for note in physical_notes:
            if note.word_index is not None:
                physical_by_word.setdefault(note.word_index, []).append(note)
        line_notes: list[VocalNote] = []
        for position, word in enumerate(line_words):
            target = fitted[position]
            model_owned = [
                note for note in symbolic_notes if note.word_index == word.index
            ]
            owned = sorted(
                physical_by_word.get(word.index, ()), key=lambda note: note.start
            )
            if owned:
                first, last = owned[0].start, owned[-1].end
                target_end = target.end
                if position == len(line_words) - 1:
                    target_end = min(line.end, target.end, last + 0.25)
                    target_end = max(word.start + 0.05, target_end)
                    target = Word(
                        target.start,
                        target_end,
                        target.text,
                        target.confidence,
                        target.index,
                    )
                    fitted[position] = target
                source_span = max(0.001, last - first)
                scale = (target.end - word.start) / source_span
                for note_index, note in enumerate(owned):
                    start = word.start + (note.start - first) * scale
                    end = min(target.end, word.start + (note.end - first) * scale)
                    if end > start:
                        midi_note = note.midi_note
                        if model_owned:
                            model_index = round(
                                note_index
                                * (len(model_owned) - 1)
                                / max(1, len(owned) - 1)
                            )
                            midi_note = model_owned[model_index].midi_note
                        line_notes.append(VocalNote(
                            start,
                            end,
                            midi_note,
                            velocity=note.velocity,
                            word_index=word.index,
                        ))
                continue
            if model_owned:
                line_notes.extend(model_owned)
                continue
            nearest = min(
                physical_notes,
                key=lambda note: abs(note.start - word.start),
                default=None,
            )
            if nearest is not None and abs(nearest.start - word.start) <= 0.75:
                line_notes.append(VocalNote(
                    word.start,
                    target.end,
                    nearest.midi_note,
                    velocity=nearest.velocity,
                    word_index=word.index,
                ))
        replaced.update((word.index, word) for word in fitted)
        notes.extend(line_notes)
    return [replaced.get(word.index, word) for word in words], notes


class VocalParseScoreEngine:
    """Windows-compatible, persistent VocalParse inference engine.

    The upstream multi-GPU API imports POSIX ``fcntl``.  This implementation
    uses the same public checkpoint format but keeps one model resident and
    batches short, force-aligned lyric lines on Windows.
    """

    name = "VocalParse-symbolic"

    def __init__(self, checkpoint: str | Path | None = None, batch_size: int = 4):
        self.checkpoint = Path(
            checkpoint
            or os.getenv("KARAOKE_AI_VOCALPARSE_MODEL", "downloads/models/vocalparse")
        ).resolve()
        self.batch_size = max(1, int(batch_size))
        self._model = self._processor = self._device = None

    @staticmethod
    def _patch_forward(model) -> None:
        cls = model.__class__
        if getattr(cls, "_advoice_vocalparse_forward", False):
            return

        def forward(
            this, input_ids=None, attention_mask=None, input_features=None,
            feature_attention_mask=None, labels=None, **kwargs,
        ):
            return this.thinker.forward(
                input_ids=input_ids,
                attention_mask=attention_mask,
                input_features=input_features,
                feature_attention_mask=feature_attention_mask,
                labels=labels,
                **kwargs,
            )

        cls.forward = forward
        cls._advoice_vocalparse_forward = True

    def _load(self):
        if self._model is not None:
            return self._model, self._processor, self._device
        if not (self.checkpoint / "model.safetensors").is_file():
            raise FileNotFoundError(f"VocalParse checkpoint is missing: {self.checkpoint}")
        import torch
        from qwen_asr import Qwen3ASRModel
        from transformers import AutoConfig, GenerationConfig

        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        checkpoint_vocab = _checkpoint_embedding_vocab(
            self.checkpoint / "model.safetensors"
        )
        config = AutoConfig.from_pretrained(str(self.checkpoint))
        _set_checkpoint_vocab_size(config, checkpoint_vocab)
        wrapper = Qwen3ASRModel.from_pretrained(
            str(self.checkpoint),
            config=config,
            dtype=dtype,
            device_map="cpu",
            attn_implementation="sdpa",
        )
        model, processor = wrapper.model, wrapper.processor
        if len(processor.tokenizer) != checkpoint_vocab:
            raise ValueError(
                "VocalParse tokenizer/checkpoint vocabulary mismatch: "
                f"{len(processor.tokenizer)} != {checkpoint_vocab}"
            )
        model.thinker.vocab_size = checkpoint_vocab
        self._patch_forward(model)
        model.generation_config = GenerationConfig.from_model_config(model.config)
        device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        model = model.to(device).eval()
        self._model, self._processor, self._device = model, processor, device
        return model, processor, device

    @staticmethod
    def _prefix(processor, lyrics: str) -> str:
        messages = [
            {"role": "system", "content": ""},
            {"role": "user", "content": [{"type": "audio", "audio": None}]},
        ]
        base = processor.apply_chat_template(
            [messages], add_generation_prompt=True, tokenize=False
        )[0]
        return f"{base}language Chinese<asr_text>{lyrics}<|file_sep|>"

    @staticmethod
    def _audio_lines(audio_path: str | Path, lines: list[ScoreLine]):
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly

        audio, rate = sf.read(audio_path, dtype="float32", always_2d=True)
        mono = audio.mean(axis=1)
        if rate != 16_000:
            divisor = math.gcd(int(rate), 16_000)
            mono = resample_poly(mono, 16_000 // divisor, int(rate) // divisor)
        result = []
        for line in lines:
            start = max(0, int((line.start - 0.08) * 16_000))
            end = min(len(mono), int((line.end + 0.08) * 16_000))
            result.append(np.asarray(mono[start:end], dtype=np.float32))
        return result

    def transcribe_lines(
        self,
        audio_path: str | Path,
        lines: list[ScoreLine],
        *,
        cancelled=None,
        progress=None,
    ) -> list[SymbolicScore]:
        if not lines:
            return []
        if callable(cancelled) and cancelled():
            raise ProcessingCancelledError("Song processing cancelled")
        import torch
        from transformers import StoppingCriteriaList

        model, processor, device = self._load()
        audios = self._audio_lines(audio_path, lines)
        output: list[SymbolicScore] = []
        for offset in range(0, len(lines), self.batch_size):
            if callable(cancelled) and cancelled():
                raise ProcessingCancelledError("Song processing cancelled")
            chunk_lines = lines[offset:offset + self.batch_size]
            chunk_audio = audios[offset:offset + self.batch_size]
            prefixes = [self._prefix(processor, line.text) for line in chunk_lines]
            inputs = processor(
                text=prefixes,
                audio=chunk_audio,
                sampling_rate=16_000,
                return_tensors="pt",
                padding=True,
                truncation=False,
            )
            inputs = {key: value.to(device) for key, value in inputs.items()}
            if "input_features" in inputs and inputs["input_features"].is_floating_point():
                inputs["input_features"] = inputs["input_features"].to(model.dtype)
            prefix_length = inputs["input_ids"].shape[1]
            guard = _GenerationGuard(
                cancelled=cancelled,
                timeout_seconds=float(
                    os.getenv("KARAOKE_AI_SCORE_BATCH_TIMEOUT_SEC", "35")
                ),
            )
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=max(
                        _score_generation_budget(line.text)
                        for line in chunk_lines
                    ),
                    stopping_criteria=StoppingCriteriaList([guard]),
                )
            if guard.triggered:
                if callable(cancelled) and cancelled():
                    raise ProcessingCancelledError("Song processing cancelled")
                raise TimeoutError(
                    "VocalParse score generation exceeded the per-batch timeout"
                )
            sequences = generated.sequences if hasattr(generated, "sequences") else generated
            for sequence in sequences:
                raw = processor.tokenizer.decode(
                    sequence[prefix_length:], skip_special_tokens=False
                )
                output.append(trim_score_for_lyrics(
                    parse_vocalparse_score(raw),
                    chunk_lines[len(output) - offset].text,
                ))
            if callable(progress):
                progress(min(len(lines), offset + len(chunk_lines)), len(lines))
        return output

    def close(self) -> None:
        self._model = self._processor = self._device = None
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
