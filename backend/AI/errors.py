class AICoreError(RuntimeError):
    pass


class EngineUnavailableError(AICoreError):
    pass


class InvalidArtifactError(AICoreError):
    pass


class ProcessingCancelledError(AICoreError):
    pass


class ConfigurationError(AICoreError):
    pass
