class AICoreError(RuntimeError):
    """Base error exposed by the AI boundary."""


class EngineUnavailableError(AICoreError):
    pass


class InvalidArtifactError(AICoreError):
    pass


class ProcessingCancelledError(AICoreError):
    pass


class ConfigurationError(AICoreError):
    pass
