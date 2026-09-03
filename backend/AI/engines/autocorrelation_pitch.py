from __future__ import annotations

import math

import numpy as np

from ..audio import load_mono
from ..models import PitchFrame
from .base import PitchEstimator

# Port of front/src/pages/Karaoke/utils/pitch.js -- keep the helper names and
# behaviour in step with that file (the live UI pitch indicator) so the two
# never quietly diverge into two different pitch-detection methods again.
MIN_PITCH_HZ = 55.0
MAX_PITCH_HZ = 1760.0
MIN_RMS = 0.01
MIN_CORRELATION = 0.62


def _normalized_correlation(buffer: np.ndarray, lag: int) -> float:
    limit = len(buffer) - lag
    left = buffer[:limit]
    right = buffer[lag : lag + limit]
    correlation = float(np.dot(left, right))
    denominator = float(math.sqrt(float(np.dot(left, left)) * float(np.dot(right, right))))
    return correlation / denominator if denominator > 0 else 0.0


def _root_mean_square(buffer: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(buffer)))) if len(buffer) else 0.0


def _has_sufficient_energy(buffer: np.ndarray, min_rms: float) -> bool:
    return _root_mean_square(buffer) >= min_rms


def _pitch_lag_range(buffer_length: int, rate: float, fmin: float, fmax: float):
    min_lag = max(2, math.floor(rate / fmax) - 1)
    max_lag = min(buffer_length - 2, math.ceil(rate / fmin) + 1)
    return (min_lag, max_lag) if max_lag > min_lag else None


def _find_best_lag(scores: np.ndarray, min_lag: int, max_lag: int):
    lag, score = -1, 0.0
    for candidate in range(min_lag, max_lag + 1):
        if scores[candidate] > score:
            score = float(scores[candidate])
            lag = candidate
    return lag, score


def _select_fundamental_lag(scores, min_lag, max_lag, fallback_lag, fallback_score, min_correlation):
    threshold = max(min_correlation, fallback_score * 0.9)
    for lag in range(min_lag + 1, max_lag):
        if scores[lag] >= threshold and scores[lag] >= scores[lag - 1] and scores[lag] > scores[lag + 1]:
            return lag, float(scores[lag])
    return fallback_lag, fallback_score


def _refine_lag(scores: np.ndarray, lag: int, min_lag: int, max_lag: int) -> float:
    if lag <= min_lag or lag >= max_lag:
        return float(lag)
    left, center, right = float(scores[lag - 1]), float(scores[lag]), float(scores[lag + 1])
    denominator = left - 2 * center + right
    if not denominator:
        return float(lag)
    offset = 0.5 * (left - right) / denominator
    return lag + max(-0.5, min(0.5, offset))


def _detect_frame(buffer, rate, fmin, fmax, min_rms, min_correlation):
    if not _has_sufficient_energy(buffer, min_rms):
        return None
    lag_range = _pitch_lag_range(len(buffer), rate, fmin, fmax)
    if lag_range is None:
        return None
    min_lag, max_lag = lag_range
    scores = np.zeros(max_lag + 2, dtype=np.float64)
    for lag in range(min_lag, max_lag + 1):
        scores[lag] = _normalized_correlation(buffer, lag)

    best_lag, best_score = _find_best_lag(scores, min_lag, max_lag)
    if best_score < min_correlation:
        return None

    # Pure and near-pure tones have equally strong autocorrelation peaks at
    # multiples of the true period. Picking the global maximum can therefore
    # report an octave (or two) too low -- prefer the first strong local
    # maximum, which corresponds to the fundamental period.
    fundamental_lag, fundamental_score = _select_fundamental_lag(
        scores, min_lag, max_lag, best_lag, best_score, min_correlation
    )
    refined_lag = _refine_lag(scores, fundamental_lag, min_lag, max_lag)
    if refined_lag <= 0:
        return None

    frequency = rate / refined_lag
    if frequency < fmin * 0.98 or frequency > fmax * 1.02:
        return None
    return frequency, max(0.0, min(1.0, fundamental_score))


class AutocorrelationPitchEstimator(PitchEstimator):
    """Batch port of the live JS autocorrelation pitch detector.

    Used only for scoring a user's recorded performance -- the song's own
    reference melody keeps using the neural FCPEPitchEstimator (see
    AICoreService), since that is a separate, much larger-blast-radius
    concern unrelated to live-voice duplication.
    """

    name = "autocorr"

    def __init__(
        self,
        sr=16000,
        window=800,
        hop=160,
        fmin=MIN_PITCH_HZ,
        fmax=MAX_PITCH_HZ,
        min_rms=MIN_RMS,
        min_correlation=MIN_CORRELATION,
    ):
        self.sr = int(sr)
        self.window = int(window)
        self.hop = int(hop)
        self.fmin = float(fmin)
        self.fmax = float(fmax)
        self.min_rms = float(min_rms)
        self.min_correlation = float(min_correlation)

    def estimate(self, audio) -> list[PitchFrame]:
        signal, sr = load_mono(audio, self.sr)
        if not signal.size:
            return []
        last_start = len(signal) - self.window
        frames: list[PitchFrame] = []
        n = 0
        while True:
            start = n * self.hop
            if start > last_start:
                break
            buffer = signal[start : start + self.window]
            time = start / sr
            result = _detect_frame(buffer, sr, self.fmin, self.fmax, self.min_rms, self.min_correlation)
            if result is None:
                frames.append(PitchFrame(time, 0.0, 0.0, False, 0.0))
            else:
                frequency, score = result
                frames.append(PitchFrame(time, frequency, score, True, _root_mean_square(buffer)))
            n += 1
        return frames

    def close(self) -> None:
        return None

    def park(self) -> None:
        return None
