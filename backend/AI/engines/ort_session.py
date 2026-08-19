
from __future__ import annotations

import time

from ..errors import EngineUnavailableError
from ..profiler import profile_operation


class OrtSessionMixin:

    provider = ""
    load_metric = ""
    unavailable_message = "ONNX Runtime is unavailable"
    artifact_message = "ONNX artifact is not configured"

    def _configure_options(self, ort, options) -> None: return None

    def _load(self):
        if self._session is not None:
            self.last_initialization_sec = 0.0
            return self._session
        availability = self.availability()
        if not availability.available: raise EngineUnavailableError(availability.reason)
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as exc:
            raise EngineUnavailableError(self.unavailable_message) from exc
        if self.artifact is None: raise EngineUnavailableError(self.artifact_message)
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._configure_options(ort, options)
        started = time.perf_counter()
        with profile_operation(self.load_metric):
            session = ort.InferenceSession(
                str(self.artifact), sess_options=options, providers=[self.provider, "CPUExecutionProvider"]
            )
        self.last_initialization_sec = time.perf_counter() - started
        self._providers = tuple(session.get_providers())
        if not self._providers or self._providers[0] != self.provider:
            raise EngineUnavailableError(
                f"ORT session did not activate {self.provider}: {self._providers}"
            )
        if (disable_fallback := getattr(session, "disable_fallback", None)) is not None: disable_fallback()
        self._session = session
        return session

    def release(self) -> None:
        self._session = None
        self._providers = ()
        self.last_initialization_sec = 0.0
