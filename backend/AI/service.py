from __future__ import annotations

import threading

from .config import CoreConfig
from .errors import ConfigurationError
from .pipeline import KaraokePipeline, PipelineRequest, PipelineResult
from .pitch_post import stabilize_pitch


class AICoreService:
    """Long-lived facade for FastAPI/Electron backends.

    Model instances are retained between jobs. The inference lock serializes GPU-heavy
    work to prevent consumer GPUs from running out of VRAM.
    """

    def __init__(self, config: CoreConfig | None = None):
        self.config = config or CoreConfig.from_env()
        self.pipeline = KaraokePipeline(self.config)
        self._inference_lock = threading.RLock()

    def process_song(
        self,
        source_path,
        output_dir,
        language=None,
        lyrics_path=None,
        title=None,
        progress=None,
        cancelled=None,
        bpm_override=None,
        key_override=None,
    ) -> PipelineResult:
        with self._inference_lock:
            return self.pipeline.run(
                PipelineRequest(
                    source_path=source_path,
                    output_dir=output_dir,
                    language=language,
                    lyrics_path=lyrics_path,
                    title=title,
                    bpm_override=bpm_override,
                    key_override=key_override,
                    progress=progress,
                    cancelled=cancelled,
                )
            )

    def analyze_pitch(self, audio_path):
        """Run the configured pitch engine for a standalone vocal recording."""
        with self._inference_lock:
            frames = self.pipeline.engines.pitch.estimate(audio_path)
            return stabilize_pitch(frames)

    def health(self) -> dict:
        engines = self.pipeline.engines
        return {
            "version": self.pipeline.VERSION,
            "separator": engines.separator.name,
            "pitch": engines.pitch.name,
            "transcriber": engines.transcriber.name,
            "aligner": engines.aligner.name,
            "ctc_alignment_models": dict(
                getattr(getattr(engines.aligner, "_ctc", None), "models", {}) or {}
            ),
            "ctc_ru_configured": bool(
                getattr(getattr(engines.aligner, "_ctc", None), "models", {}).get("ru")
            ),
            "ctc_uk_configured": bool(
                getattr(getattr(engines.aligner, "_ctc", None), "models", {}).get("uk")
            ),
            "separation_configured": bool(getattr(engines.separator, "available", lambda: True)()),
            "fallback_enabled": self.config.allow_fallback,
        }


_service: AICoreService | None = None
_service_config: CoreConfig | None = None
_service_lock = threading.Lock()


def get_ai_service(config: CoreConfig | None = None) -> AICoreService:
    global _service, _service_config
    requested = config or CoreConfig.from_env()
    with _service_lock:
        if _service is None:
            _service = AICoreService(requested)
            _service_config = requested
        elif _service_config != requested:
            raise ConfigurationError(
                "AI service is already initialized with another configuration. "
                "Create AICoreService(config) explicitly or restart the backend."
            )
        return _service


def reset_ai_service() -> None:
    """Discard cached engines after resource paths or model files change."""
    global _service, _service_config
    with _service_lock:
        _service = None
        _service_config = None


def reset_ai_service_for_tests() -> None:
    reset_ai_service()


def process_song(*args, **kwargs) -> PipelineResult:
    return get_ai_service().process_song(*args, **kwargs)
