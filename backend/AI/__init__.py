from importlib import import_module
from typing import Any

__version__ = "3.5.0"

_EXPORTS = {
    "CoreConfig": (".config", "CoreConfig"),
    "KaraokePipeline": (".pipeline", "KaraokePipeline"),
    "PipelineRequest": (".pipeline", "PipelineRequest"),
    "PipelineResult": (".pipeline", "PipelineResult"),
    "AICoreService": (".service", "AICoreService"),
    "get_ai_service": (".service", "get_ai_service"),
    "process_song": (".service", "process_song"),
}

__all__ = ["__version__", *_EXPORTS]


def __getattr__(name: str) -> Any:
    try:
        module_name, attribute = _EXPORTS[name]
    except KeyError as error:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from error
    value = getattr(import_module(module_name, __name__), attribute)
    globals()[name] = value
    return value
