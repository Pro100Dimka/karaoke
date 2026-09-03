import math

import numpy as np
import pytest

from AI.engines import autocorrelation_pitch as module
from AI.engines.autocorrelation_pitch import AutocorrelationPitchEstimator, _select_fundamental_lag


def sine(frequency, sr=16000, duration=0.5, amplitude=0.5):
    t = np.arange(int(sr * duration)) / sr
    return np.sin(2 * math.pi * frequency * t).astype(np.float32) * amplitude


def estimator(**overrides):
    return AutocorrelationPitchEstimator(sr=16000, **overrides)


def test_estimate_detects_a_pure_tone_frequency(monkeypatch):
    signal = sine(220.0)
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (signal, sr))
    frames = estimator().estimate("ignored.wav")
    voiced = [f for f in frames if f.voiced]
    assert voiced
    for frame in voiced:
        assert frame.frequency == pytest.approx(220.0, abs=2.0)
        assert 0.0 <= frame.confidence <= 1.0


def test_estimate_returns_evenly_spaced_frame_times(monkeypatch):
    signal = sine(220.0)
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (signal, sr))
    est = estimator()
    frames = est.estimate("ignored.wav")
    hop_seconds = est.hop / est.sr
    for previous, current in zip(frames, frames[1:]):
        assert current.time - previous.time == pytest.approx(hop_seconds, abs=1e-9)


def test_estimate_reports_unvoiced_silence(monkeypatch):
    signal = np.zeros(16000, dtype=np.float32)
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (signal, sr))
    frames = estimator().estimate("ignored.wav")
    assert frames
    assert all(not f.voiced and f.frequency == 0.0 for f in frames)


def test_estimate_handles_empty_audio(monkeypatch):
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (np.array([], dtype=np.float32), sr))
    assert estimator().estimate("ignored.wav") == []


def test_estimate_handles_audio_shorter_than_one_window(monkeypatch):
    signal = sine(220.0, duration=0.01)
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (signal, sr))
    assert estimator().estimate("ignored.wav") == []


def test_select_fundamental_lag_prefers_the_first_strong_local_maximum_over_a_stronger_octave_below():
    scores = np.zeros(40, dtype=np.float64)
    scores[10] = 0.9  # fundamental period, within 90% of the global max -> qualifies
    scores[20] = 0.95  # octave-below harmonic peak, globally stronger
    lag, score = _select_fundamental_lag(scores, 5, 30, 20, 0.95, min_correlation=0.62)
    assert lag == 10
    assert score == pytest.approx(0.9)


def test_select_fundamental_lag_falls_back_to_the_global_max_when_no_earlier_peak_qualifies():
    scores = np.zeros(40, dtype=np.float64)
    scores[20] = 0.95
    lag, score = _select_fundamental_lag(scores, 5, 30, 20, 0.95, min_correlation=0.62)
    assert (lag, score) == (20, 0.95)


def test_pitch_frame_construction_never_raises_for_any_returned_frame(monkeypatch):
    signal = sine(880.0)
    monkeypatch.setattr(module, "load_mono", lambda audio, sr: (signal, sr))
    frames = estimator().estimate("ignored.wav")
    assert frames
