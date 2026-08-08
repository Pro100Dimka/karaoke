from __future__ import annotations

import math
import os
from dataclasses import asdict, dataclass

from .errors import ConfigurationError


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be one of: 1/0, true/false, yes/no, on/off")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer, got {raw!r}") from exc


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number, got {raw!r}") from exc


@dataclass(frozen=True, slots=True)
class CoreConfig:
    sample_rate: int = 44100
    pitch_sample_rate: int = 16000
    hop_seconds: float = 0.01
    fmin_hz: float = 55.0
    fmax_hz: float = 1400.0
    min_note_sec: float = 0.055
    min_voiced_confidence: float = 0.42
    split_note_semitones: float = 0.78
    max_gap_sec: float = 0.05
    midi_bend_range: int = 2
    separation_engine: str = "mel-roformer"
    pitch_engine: str = "fcpe"
    transcription_engine: str = "qwen3-asr"
    alignment_engine: str = "qwen3-forced-aligner"
    asr_model: str = "Qwen/Qwen3-ASR-0.6B"
    aligner_model: str = "Qwen/Qwen3-ForcedAligner-0.6B"
    allow_fallback: bool = False
    preserve_raw_pitch: bool = True
    write_quality_report: bool = True
    validate_cached_artifacts: bool = True

    def __post_init__(self) -> None:
        numeric = {
            "hop_seconds": self.hop_seconds,
            "fmin_hz": self.fmin_hz,
            "fmax_hz": self.fmax_hz,
            "min_note_sec": self.min_note_sec,
            "min_voiced_confidence": self.min_voiced_confidence,
            "split_note_semitones": self.split_note_semitones,
            "max_gap_sec": self.max_gap_sec,
        }
        for name, value in numeric.items():
            if not math.isfinite(float(value)):
                raise ConfigurationError(f"{name} must be finite")
        if self.sample_rate <= 0 or self.pitch_sample_rate <= 0:
            raise ConfigurationError("Sample rates must be positive")
        if not 0.001 <= self.hop_seconds <= 0.1:
            raise ConfigurationError("hop_seconds must be between 0.001 and 0.1")
        if not 0 < self.fmin_hz < self.fmax_hz <= self.pitch_sample_rate / 2:
            raise ConfigurationError("Expected 0 < fmin_hz < fmax_hz <= pitch Nyquist frequency")
        if not 0 <= self.min_voiced_confidence <= 1:
            raise ConfigurationError("min_voiced_confidence must be between 0 and 1")
        if self.min_note_sec <= 0 or self.max_gap_sec < 0:
            raise ConfigurationError("Note duration must be positive and max gap non-negative")
        if not 0.05 <= self.split_note_semitones <= 12:
            raise ConfigurationError("split_note_semitones must be between 0.05 and 12")
        if not 1 <= self.midi_bend_range <= 24:
            raise ConfigurationError("midi_bend_range must be between 1 and 24")
        if not self.asr_model.strip() or not self.aligner_model.strip():
            raise ConfigurationError("ASR and aligner model names cannot be empty")
        supported: dict[str, tuple[str, set[str]]] = {
            "separation_engine": (self.separation_engine, {"mel-roformer"}),
            "pitch_engine": (self.pitch_engine, {"fcpe"}),
            "transcription_engine": (self.transcription_engine, {"qwen3-asr"}),
            "alignment_engine": (self.alignment_engine, {"qwen3-forced-aligner"}),
        }
        for field_name, (supported_value, allowed) in supported.items():
            if supported_value not in allowed:
                choices = ", ".join(sorted(allowed))
                raise ConfigurationError(
                    f"Unsupported {field_name}={supported_value!r}; expected one of: {choices}"
                )

    @classmethod
    def from_env(cls) -> CoreConfig:
        return cls(
            sample_rate=_env_int("KARAOKE_AI_SAMPLE_RATE", 44100),
            pitch_sample_rate=_env_int("KARAOKE_AI_PITCH_SR", 16000),
            hop_seconds=_env_float("KARAOKE_AI_HOP_SECONDS", 0.01),
            fmin_hz=_env_float("KARAOKE_AI_FMIN_HZ", 55.0),
            fmax_hz=_env_float("KARAOKE_AI_FMAX_HZ", 1400.0),
            min_note_sec=_env_float("KARAOKE_AI_MIN_NOTE_SEC", 0.055),
            min_voiced_confidence=_env_float("KARAOKE_AI_MIN_CONFIDENCE", 0.42),
            split_note_semitones=_env_float("KARAOKE_AI_SPLIT_SEMITONES", 0.78),
            max_gap_sec=_env_float("KARAOKE_AI_MAX_GAP_SEC", 0.05),
            midi_bend_range=_env_int("KARAOKE_AI_MIDI_BEND_RANGE", 2),
            separation_engine=os.getenv("KARAOKE_AI_SEPARATION", "mel-roformer"),
            pitch_engine=os.getenv("KARAOKE_AI_PITCH", "fcpe"),
            transcription_engine=os.getenv("KARAOKE_AI_ASR", "qwen3-asr"),
            alignment_engine=os.getenv("KARAOKE_AI_ALIGNER", "qwen3-forced-aligner"),
            asr_model=os.getenv("KARAOKE_AI_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B"),
            aligner_model=os.getenv("KARAOKE_AI_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B"),
            allow_fallback=_env_bool("KARAOKE_AI_ALLOW_FALLBACK", False),
            preserve_raw_pitch=_env_bool("KARAOKE_AI_PRESERVE_RAW_PITCH", True),
            write_quality_report=_env_bool("KARAOKE_AI_WRITE_QUALITY", True),
            validate_cached_artifacts=_env_bool("KARAOKE_AI_VALIDATE_CACHE", True),
        )

    def fingerprint(self) -> dict[str, object]:
        return asdict(self)
