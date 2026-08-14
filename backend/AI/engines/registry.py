from __future__ import annotations

from dataclasses import dataclass

from .omnizart_pitch import OmnizartPatchCNNPitchEstimator
from .pitch import FCPEPitchEstimator
from .separation import MSSTMelRoformerSeparator
from .text import Qwen3ForcedAligner, Qwen3Transcriber


@dataclass
class EngineRegistry:
    """Long-lived engine instances.

    A backend should keep one KaraokePipeline instance alive. Heavy model objects then
    remain loaded between jobs instead of being reconstructed for every song.
    """

    separator: MSSTMelRoformerSeparator
    pitch: FCPEPitchEstimator
    transcriber: Qwen3Transcriber
    aligner: Qwen3ForcedAligner
    melody: OmnizartPatchCNNPitchEstimator | None = None

    @classmethod
    def create_default(cls, config):
        return cls(
            separator=MSSTMelRoformerSeparator(),
            pitch=FCPEPitchEstimator(
                sr=config.pitch_sample_rate,
                hop=max(1, int(config.pitch_sample_rate * config.hop_seconds)),
                fmin=config.fmin_hz,
                fmax=config.fmax_hz,
            ),
            transcriber=Qwen3Transcriber(model=config.asr_model),
            aligner=Qwen3ForcedAligner(model=config.aligner_model),
            melody=OmnizartPatchCNNPitchEstimator(),
        )
