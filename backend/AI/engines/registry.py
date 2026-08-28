from dataclasses import dataclass

from ..config import CoreConfig
from .pitch import FCPEPitchEstimator
from .separation import MSSTMelRoformerSeparator
from .text import Qwen3ForcedAligner, Qwen3Transcriber


@dataclass(slots=True)
class EngineRegistry:
    separator: object
    pitch: object
    transcriber: object
    aligner: object

    @property
    def melody(self):
        return self.pitch

    @classmethod
    def create_default(cls, config: CoreConfig):
        import os

        return cls(
            MSSTMelRoformerSeparator(),
            FCPEPitchEstimator(config.pitch_sample_rate, round(config.hop_seconds * config.pitch_sample_rate), config.fmin_hz, config.fmax_hz),
            Qwen3Transcriber(os.getenv("KARAOKE_AI_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")),
            Qwen3ForcedAligner(os.getenv("KARAOKE_AI_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B")),
        )
