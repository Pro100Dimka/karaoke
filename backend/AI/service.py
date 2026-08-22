from __future__ import annotations

import threading

from .config import CoreConfig
from .errors import ConfigurationError
from .pipeline import KaraokePipeline, PipelineRequest, PipelineResult
from .pitch_post import stabilize_pitch
from .runtime import get_runtime_plan


class AICoreService:
    def __init__(self, config: CoreConfig | None = None):
        self.config = config or CoreConfig.from_env()
        self.pipeline = KaraokePipeline(self.config)
        self._lock = threading.RLock()

    def process_song(self, source_path, output_dir, **options) -> PipelineResult:
        with self._lock:
            return self.pipeline.run(PipelineRequest(source_path, output_dir, **options))

    def reprocess_song(self, output_dir, **options) -> PipelineResult:
        with self._lock:
            return self.pipeline.reprocess(output_dir, **options)

    def analyze_pitch(self, audio_path):
        with self._lock:
            return stabilize_pitch(self.pipeline.engines.pitch.estimate(audio_path))

    def close(self):
        with self._lock:
            self.pipeline.close()

    def health(self) -> dict:
        engines = self.pipeline.engines
        return {"version": self.pipeline.VERSION, "separator": engines.separator.name, "pitch": engines.pitch.name, "transcriber": engines.transcriber.name, "aligner": engines.aligner.name, "runtime": get_runtime_plan().describe()}


_service = None
_config = None
_lock = threading.Lock()


def get_ai_service(config: CoreConfig | None = None) -> AICoreService:
    global _service, _config
    requested = config or CoreConfig.from_env()
    with _lock:
        if _service is None:
            _service, _config = AICoreService(requested), requested
        elif _config != requested:
            raise ConfigurationError("AI service is already configured")
        return _service


def reset_ai_service() -> None:
    global _service, _config
    with _lock:
        if _service:
            _service.close()
        _service = _config = None


def process_song(*args, **kwargs):
    return get_ai_service().process_song(*args, **kwargs)
