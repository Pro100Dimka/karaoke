from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any


def _finite(value: float, name: str) -> float:
    number = float(value)
    if not math.isfinite(number): raise ValueError(f"{name} must be finite")
    return number


def _confidence(value: float) -> float:
    number = _finite(value, "confidence")
    if not 0.0 <= number <= 1.0: raise ValueError("confidence must be between 0 and 1")
    return number


@dataclass(frozen=True, slots=True)
class TimeSpan:
    start: float
    end: float

    def __post_init__(self) -> None:
        start, end = _finite(self.start, 'start'), _finite(self.end, 'end')
        if start < 0 or end < start: raise ValueError(f"Invalid time span: {start}..{end}")
        object.__setattr__(self, "start", start); object.__setattr__(self, "end", end)


@dataclass(frozen=True, slots=True)
class Word(TimeSpan):
    text: str
    confidence: float = 1.0
    index: int = 0

    def __post_init__(self) -> None:
        super(Word, self).__post_init__(); text = str(self.text).strip()
        if not text: raise ValueError("word text cannot be empty")
        if int(self.index) < 0: raise ValueError("word index cannot be negative")
        object.__setattr__(self, "text", text); object.__setattr__(self, "confidence", _confidence(self.confidence)); object.__setattr__(self, "index", int(self.index))


@dataclass(frozen=True, slots=True)
class Syllable(TimeSpan):
    text: str
    word_index: int
    index: int
    confidence: float = 1.0

    def __post_init__(self) -> None:
        super(Syllable, self).__post_init__(); text = str(self.text).strip()
        if not text: raise ValueError("syllable text cannot be empty")
        if int(self.word_index) < 0 or int(self.index) < 0: raise ValueError("syllable indices cannot be negative")
        object.__setattr__(self, "text", text); object.__setattr__(self, "word_index", int(self.word_index)); object.__setattr__(self, "index", int(self.index)); object.__setattr__(self, "confidence", _confidence(self.confidence))


@dataclass(frozen=True, slots=True)
class PitchFrame:
    time: float
    frequency: float
    confidence: float
    voiced: bool
    energy: float = 0.0

    def __post_init__(self) -> None:
        time, frequency, energy = _finite(self.time, 'pitch time'), _finite(self.frequency, 'frequency'), _finite(self.energy, 'energy')
        if time < 0 or frequency < 0 or energy < 0: raise ValueError("pitch time, frequency and energy cannot be negative")
        confidence, voiced = _confidence(self.confidence), bool(self.voiced)
        if voiced and frequency <= 0: raise ValueError("voiced pitch frame requires positive frequency")
        if not voiced and frequency != 0:
            frequency = 0.0; confidence = 0.0
        object.__setattr__(self, "time", time); object.__setattr__(self, "frequency", frequency); object.__setattr__(self, "confidence", confidence); object.__setattr__(self, "voiced", voiced)
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
        super(VocalNote, self).__post_init__(); note, velocity = int(self.midi_note), int(self.velocity)
        if not 0 <= note <= 127: raise ValueError("MIDI note must be between 0 and 127")
        if not 1 <= velocity <= 127: raise ValueError("MIDI velocity must be between 1 and 127")
        if self.word_index is not None and int(self.word_index) < 0: raise ValueError("word_index cannot be negative")
        if self.syllable_index is not None and int(self.syllable_index) < 0: raise ValueError("syllable_index cannot be negative")
        normalized: list[tuple[float, float]] = []; previous = -1.0
        for relative_time, cents in self.cents:
            relative = _finite(relative_time, "pitch-bend time"); bend = _finite(cents, "pitch-bend cents")
            if relative < 0 or relative + 1e-9 < previous: raise ValueError("pitch-bend events must be sorted and non-negative")
            if relative > (self.end - self.start) + 1e-6: raise ValueError("pitch-bend event lies outside note duration")
            normalized.append((relative, bend)); previous = relative
        object.__setattr__(self, "midi_note", note); object.__setattr__(self, "velocity", velocity)
        object.__setattr__(
            self, "word_index", None if self.word_index is None else int(self.word_index)
        )
        object.__setattr__(
            self,
            "syllable_index",
            None if self.syllable_index is None else int(self.syllable_index),
        )
        object.__setattr__(self, "cents", tuple(normalized)); linked = tuple(dict.fromkeys(int(value) for value in self.syllable_indices))
        if any(value < 0 for value in linked): raise ValueError("syllable_indices cannot contain negative values")
        if self.syllable_index is not None and int(self.syllable_index) not in linked: linked = (int(self.syllable_index), *linked)
        object.__setattr__(self, "syllable_indices", linked)


@dataclass(slots=True)
class StageReport: stage: str; elapsed_sec: float; cached: bool; engine: str; details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PipelineManifest: version: str; source: str; outputs: dict[str, str]; reports: list[dict[str, Any]]; warnings: list[str]; title: str | None = None; language: str | None = None; integrity: dict[str, dict[str, object]] = field(default_factory=dict)


def to_dict(value: Any) -> Any: return asdict(value) if is_dataclass(value) and (not isinstance(value, type)) else value
