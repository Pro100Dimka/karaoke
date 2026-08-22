from .config import CoreConfig
from .pipeline import KaraokePipeline, PipelineRequest, PipelineResult
from .service import AICoreService, get_ai_service, process_song, reset_ai_service
from .version import AI_BUILD_ID

__version__ = AI_BUILD_ID
__all__ = ["AICoreService", "CoreConfig", "KaraokePipeline", "PipelineRequest", "PipelineResult", "get_ai_service", "process_song", "reset_ai_service"]
