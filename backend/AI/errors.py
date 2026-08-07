class AICoreError(RuntimeError):
    """Base error raised by AI Core."""


class EngineUnavailableError(AICoreError):
    """Raised when a configured inference engine is not installed or configured."""


class InvalidArtifactError(AICoreError):
    """Raised when an output artifact is missing, corrupt, or inconsistent."""


class ProcessingCancelledError(AICoreError):
    """Raised when the caller cancels processing."""


class ConfigurationError(AICoreError):
    """Raised when production configuration is incomplete or invalid."""
