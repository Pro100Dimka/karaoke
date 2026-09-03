from unittest.mock import Mock

from AI.engines.autocorrelation_pitch import AutocorrelationPitchEstimator
from AI.engines.pitch import FCPEPitchEstimator
from AI.service import AICoreService


def test_analyze_pitch_uses_the_lightweight_estimator_not_the_reference_melody_engine(monkeypatch):
    service = AICoreService()
    assert isinstance(service._recording_pitch, AutocorrelationPitchEstimator)
    assert isinstance(service.pipeline.engines.pitch, FCPEPitchEstimator)

    monkeypatch.setattr(
        service.pipeline.engines.pitch,
        "estimate",
        Mock(side_effect=AssertionError("reference-melody FCPE engine must not run for recording analysis")),
    )
    monkeypatch.setattr(service._recording_pitch, "estimate", lambda audio_path: [])

    assert service.analyze_pitch("recording.wav") == []
