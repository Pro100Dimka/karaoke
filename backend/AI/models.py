from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any


def _number(value: object, name: str, *, minimum: float = 0.0) -> float:
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ValueError(f"{name} must be finite and >= {minimum}")
    return result


@dataclass(frozen=True, slots=True)
class TimeSpan:
    start: float
    end: float

    def __post_init__(self) -> None:
        start, end = _number(self.start, "start"), _number(self.end, "end")
        if end < start:
            raise ValueError(f"Invalid time span: {start}..{end}")
        object.__setattr__(self, "start", start)
        object.__setattr__(self, "end", end)


@dataclass(frozen=True, slots=True)
class Word(TimeSpan):
    text: str
    confidence: float = 1.0
    index: int = 0

    def __post_init__(self) -> None:
        super(Word, self).__post_init__()
        text, confidence, index = str(self.text).strip(), float(self.confidence), int(self.index)
        if not text or not 0 <= confidence <= 1 or index < 0:
            raise ValueError("Invalid word")
        object.__setattr__(self, "text", text)
        object.__setattr__(self, "confidence", confidence)
        object.__setattr__(self, "index", index)


@dataclass(frozen=True, slots=True)
class Syllable(TimeSpan):
    text: str
    word_index: int
    index: int
    confidence: float = 1.0

    def __post_init__(self) -> None:
        super(Syllable, self).__post_init__()
        text, word_index, index, confidence = str(self.text).strip(), int(self.word_index), int(self.index), float(self.confidence)
        if not text or min(word_index, index) < 0 or not 0 <= confidence <= 1:
            raise ValueError("Invalid syllable")
        object.__setattr__(self, "text", text)
        object.__setattr__(self, "word_index", word_index)
        object.__setattr__(self, "index", index)
        object.__setattr__(self, "confidence", confidence)


@dataclass(frozen=True, slots=True)
class PitchFrame:
    time: float
    frequency: float
    confidence: float
    voiced: bool
    energy: float = 0.0

    def __post_init__(self) -> None:
        time = _number(self.time, "time")
        frequency, confidence, energy = float(self.frequency), float(self.confidence), float(self.energy)
        if not all(map(math.isfinite, (frequency, confidence, energy))):
            raise ValueError("Pitch values must be finite")
        if not 0 <= confidence <= 1 or frequency < 0 or energy < 0 or (self.voiced and frequency <= 0):
            raise ValueError("Invalid pitch frame")
        voiced = bool(self.voiced and frequency > 0)
        object.__setattr__(self, "time", time)
        object.__setattr__(self, "frequency", frequency if voiced else 0.0)
        object.__setattr__(self, "confidence", confidence if voiced else 0.0)
        object.__setattr__(self, "voiced", voiced)
        object.__setattr__(self, "energy", energy)


@dataclass(frozen=True, slots=True)
class VocalNote(TimeSpan):
    midi_note: int
    velocity: int = 96
    word_index: int | None = None
    syllable_index: int | None = None
    cents: tuple[tuple[float, float], ...] = ()
    syllable_indices: tuple[int, ...] = ()

    def __post_init__(self) -> None:
        super(VocalNote, self).__post_init__()
        note, velocity = int(self.midi_note), int(self.velocity)
        if not 0 <= note <= 127 or not 1 <= velocity <= 127:
            raise ValueError("Invalid MIDI note")
        if self.word_index is not None and int(self.word_index) < 0:
            raise ValueError("Invalid word index")
        if self.syllable_index is not None and int(self.syllable_index) < 0:
            raise ValueError("Invalid syllable index")
        previous = -1.0
        normalized = []
        for relative, cents in self.cents:
            relative, cents = float(relative), float(cents)
            if not math.isfinite(relative) or not math.isfinite(cents) or relative < previous or relative > self.end - self.start:
                raise ValueError("Invalid pitch bend")
            previous = relative
            normalized.append((relative, cents))
        object.__setattr__(self, "midi_note", note)
        object.__setattr__(self, "velocity", velocity)
        object.__setattr__(self, "word_index", None if self.word_index is None else int(self.word_index))
        object.__setattr__(self, "syllable_index", None if self.syllable_index is None else int(self.syllable_index))
        object.__setattr__(self, "cents", tuple(normalized))


@dataclass(slots=True)
class StageReport:
    stage: str
    elapsed_sec: float
    cached: bool
    engine: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PipelineManifest:
    version: str
    source: str
    outputs: dict[str, str]
    reports: list[dict[str, Any]]
    warnings: list[str]
    title: str | None = None
    language: str | None = None
    integrity: dict[str, dict[str, object]] = field(default_factory=dict)


def to_dict(value: Any) -> Any:
    return asdict(value) if is_dataclass(value) and not isinstance(value, type) else value


def to_compact_dict(value: Any, digits: int = 3) -> Any:
    value = to_dict(value)
    if isinstance(value, dict):
        return {key: to_compact_dict(item, digits) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_compact_dict(item, digits) for item in value]
    return round(value, digits) if isinstance(value, float) else value
