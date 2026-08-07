from .config import CoreConfig
from .pipeline import KaraokePipeline, PipelineRequest, PipelineResult
from .service import AICoreService, get_ai_service, process_song

__version__ = "3.5.0"

__all__ = [
    "__version__",
    "CoreConfig",
    "KaraokePipeline",
    "PipelineRequest",
    "PipelineResult",
    "AICoreService",
    "get_ai_service",
    "process_song",
]
