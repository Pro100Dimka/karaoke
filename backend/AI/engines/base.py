from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..models import PitchFrame, Word


class Separator(ABC):
    name='separator'
    @abstractmethod
    def separate(self, mix: Path, vocals: Path, instrumental: Path): ...

class PitchEstimator(ABC):
    name='pitch'
    @abstractmethod
    def estimate(self, audio: Path) -> list[PitchFrame]: ...

class Transcriber(ABC):
    name='asr'
    @abstractmethod
    def transcribe(self, audio: Path, language: str|None) -> tuple[str,list[Word]]: ...

class Aligner(ABC):
    name='aligner'
    @abstractmethod
    def align(self, audio: Path, text: str, language: str|None) -> list[Word]: ...
