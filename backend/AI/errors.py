class AICoreError(RuntimeError):
    """Base error exposed by the AI boundary."""


class EngineUnavailableError(AICoreError):
    pass


class AcceleratorUnavailableError(AICoreError):
    """A typed accelerator failure that may be retried on CPU."""


class InvalidArtifactError(AICoreError):
    pass


class ProcessingCancelledError(AICoreError):
    pass


class ConfigurationError(AICoreError):
    pass
