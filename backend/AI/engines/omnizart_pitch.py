
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np
from scipy import fftpack
from scipy.signal.windows import blackmanharris

from ..audio import load_mono
from ..errors import EngineUnavailableError
from ..models import PitchFrame
from ..profiler import profile_operation
from .base import PitchEstimator

OMNIZART_CONTOUR_VERSION = "omnizart-patch-cnn-0.6.3-inference-v1"
_MODEL_FILES = (
    "configurations.yaml",
    "saved_model.pb",
    "variables/variables.index",
    "variables/variables.data-00000-of-00001",
)


def _stft(waveform, frequency_resolution, sample_rate, hop, window):
    times, fft_size, half_window = np.arange(hop, np.ceil(len(waveform) / float(hop)) * hop, hop), int(sample_rate / float(frequency_resolution)), int(np.floor((len(window) - 1) / 2))
    spectrum = np.zeros((fft_size, len(times)), dtype=float)
    for column, time_index in enumerate(times):
        time_index = int(time_index)
        radius = int(min(round(fft_size / 2.0) - 1, half_window, time_index - 1))
        right = int(min(round(fft_size / 2.0) - 1, half_window, len(waveform) - time_index))
        offsets = np.arange(-radius, right)
        indices = np.mod(fft_size + offsets, fft_size) + 1
        weights = window[half_window + offsets - 1]
        norm = np.linalg.norm(weights)
        if norm > 0: spectrum[indices - 1, column] = waveform[time_index + offsets - 1] * weights / norm
    return np.abs(fftpack.fft(spectrum, n=fft_size, axis=0)), fft_size


def _nonlinear(values, gamma, cutoff):
    values = values.copy()
    values[values < 0] = 0
    values[: int(cutoff), :] = 0
    values[-int(cutoff) :, :] = 0
    return np.power(values, gamma)


def _centers(lowest, highest, bins_per_octave):
    count = int(np.ceil(np.log2(highest / lowest)) * bins_per_octave)
    return [
        value
        for index in range(count)
        if (value := lowest * 2 ** (index / bins_per_octave)) < highest
    ]


def _triangular_weight(frequency, centers, index):
    if centers[index - 1] < frequency < centers[index]: return (frequency - centers[index - 1]) / (centers[index] - centers[index - 1])
    return (centers[index + 1] - frequency) / (centers[index + 1] - centers[index]) if centers[index] < frequency < centers[index + 1] else 0.0


def _frequency_mapping(values, frequencies, resolution, centers):
    transform = np.zeros((len(centers) - 1, len(frequencies)), dtype=float)
    for index in range(1, len(centers) - 1):
        left = int(round(centers[index - 1] / resolution))
        right = int(round(centers[index + 1] / resolution) + 1)
        if left >= right - 1:
            transform[index, left] = 1
            continue
        for source in range(left, right): transform[index, source] = _triangular_weight(frequencies[source], centers, index)
    return transform @ values


def _quefrency_mapping(values, sample_rate, centers):
    quefrencies = np.arange(len(values)) / float(sample_rate)
    frequencies = 1 / (quefrencies + 1e-9)
    transform = np.zeros((len(centers) - 1, len(frequencies)), dtype=float)
    for index in range(1, len(centers) - 1):
        left = int(round(sample_rate / centers[index + 1]))
        right = int(round(sample_rate / centers[index - 1]) + 1)
        for source in range(left, min(right, len(frequencies))): transform[index, source] = _triangular_weight(frequencies[source], centers, index)
    return transform @ values


def _cfp_chunk(
    waveform,
    *,
    sample_rate=16_000,
    hop_seconds=0.02,
    window_size=2049,
    frequency_resolution=2.0,
    lowest_frequency=27.5,
    highest_frequency=4487.0,
    bins_per_octave=48,
):
    hop = round(sample_rate * hop_seconds)
    spectrum, fft_size = _stft(
        waveform,
        frequency_resolution,
        sample_rate,
        hop,
        blackmanharris(window_size),
    )
    spectrum = np.power(spectrum, 0.24)
    cepstrum = np.real(np.fft.fft(spectrum, axis=0)) / np.sqrt(fft_size)
    cepstrum = _nonlinear(cepstrum, 0.6, round(sample_rate / highest_frequency))
    generalized = np.real(np.fft.fft(cepstrum, axis=0)) / np.sqrt(fft_size)
    generalized, half, upper_frequency = _nonlinear(generalized, 1.0, round(lowest_frequency / frequency_resolution)), int(round(fft_size / 2)), int(round(highest_frequency / frequency_resolution) + 1)
    frequencies, generalized = sample_rate * np.linspace(0, 0.5, half, endpoint=True), generalized[:half, :][:upper_frequency, :]
    frequencies, max_quefrency = frequencies[:upper_frequency], int(round(sample_rate / lowest_frequency) + 1)
    cepstrum, centers = cepstrum[:half, :][:max_quefrency, :], _centers(lowest_frequency, highest_frequency, bins_per_octave)
    spectral, periodic = _frequency_mapping(generalized, frequencies, frequency_resolution, centers), _quefrency_mapping(cepstrum, sample_rate, centers)
    return spectral * periodic, centers


def _extract_cfp_matrix(
    waveform,
    *,
    sample_rate=16_000,
    max_frames=2000,
    lowest_frequency=27.5,
    highest_frequency=4487.0,
):
    hop = round(sample_rate * 0.02)
    chunk_samples, chunks, centers = max_frames * hop, [], []
    for start in range(0, len(waveform), chunk_samples):
        chunk = waveform[start : start + chunk_samples + hop]
        if len(chunk) <= hop: continue
        matrix, centers = _cfp_chunk(
            chunk,
            sample_rate=sample_rate,
            lowest_frequency=lowest_frequency,
            highest_frequency=highest_frequency,
        )
        chunks.append(matrix)
    return (np.empty((0, 0), dtype=np.float32), np.asarray([])) if not chunks else (np.concatenate(chunks, axis=1), np.asarray(centers))


def extract_cfp_feature(waveform, *, sample_rate=16_000, max_frames=2000):
    matrix, _ = _extract_cfp_matrix(waveform, sample_rate=sample_rate, max_frames=max_frames)
    return matrix.T.astype(np.float32, copy=False)


def extract_patch_cfp_feature(waveform, *, sample_rate=16_000, patch_size=25):
    matrix, centers = _extract_cfp_matrix(
        waveform,
        sample_rate=sample_rate,
        lowest_frequency=80.0,
        highest_frequency=1000.0,
    )
    half = patch_size // 2
    padded, patches, mapping = np.pad(matrix, ((0, half), (half, half)), constant_values=0), [], []
    for time_index in range(half, padded.shape[1] - half):
        column = padded[:, time_index]
        before = np.maximum(column[1:-1] - column[:-2], 0) > 0
        after = np.maximum(column[1:-1] - column[2:], 0) > 0
        maxima = np.concatenate(([False], before & after, [False]))
        locations = np.flatnonzero(maxima)
        for frequency_index in locations:
            if half <= frequency_index < padded.shape[0] - half:
                frequency_range = range(frequency_index - half, frequency_index + half + 1)
                time_range = range(time_index - half, time_index + half + 1)
                patches.append(padded[np.ix_(frequency_range, time_range)])
                mapping.append((frequency_index, time_index - half))
    if patches:
        patches = patches[:-1][half:-half]
        mapping = mapping[:-1][half:-half]
    return (
        np.asarray(patches, dtype=np.float32),
        np.asarray(mapping, dtype=np.int32),
        matrix,
        np.asarray(centers),
    )


def decode_contour(patches, mapping, matrix, centers, model, *, threshold=0.5):
    del matrix
    if patches.ndim != 3 or not len(patches) or not len(mapping): return np.asarray([]), np.asarray([])
    prediction = np.asarray(model.predict(patches[..., None], verbose=0))[:, 1]
    selected, frequencies = np.flatnonzero(prediction > threshold), np.zeros(int(np.max(mapping[:, 1])) + 1, dtype=np.float32)
    confidence, candidates = np.zeros_like(frequencies), np.column_stack((mapping[selected], prediction[selected]))
    candidates = candidates[np.argsort(candidates[:, 1], kind="stable")]
    for time_index in range(len(frequencies)):
        frame = candidates[candidates[:, 1] == time_index]
        if not len(frame): continue
        winner = frame[int(np.argmax(frame[:, 2]))]
        frequency_index = int(winner[0])
        frequencies[time_index] = centers[frequency_index]
        confidence[time_index] = min(1.0, max(0.0, float(winner[2])))
    return frequencies, confidence


class OmnizartPatchCNNPitchEstimator(PitchEstimator):
    name = "omnizart-patch-cnn"

    def __init__(self, model_path: str | Path | None = None, *, model_loader=None):
        self.model_path = Path(
            model_path or os.getenv("KARAOKE_AI_OMNIZART_MODEL", "")
        ).expanduser()
        self._model_loader = model_loader
        self._model = None

    def fingerprint(self): return {'name': self.name, 'version': OMNIZART_CONTOUR_VERSION, 'sample_rate': 16000, 'hop_seconds': 0.02, 'input': 'original-full-mix', 'model_available': self.available()}

    def available(self): return self.model_path.is_dir() and all((self.model_path / relative).is_file() for relative in _MODEL_FILES)

    def _load_model(self):
        if not self.available(): raise EngineUnavailableError("Omnizart Patch-CNN model is not installed")
        if self._model is None:
            try:
                if self._model_loader is not None:
                    loader = self._model_loader
                else:
                    os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
                    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
                    logging.getLogger("tensorflow").setLevel(logging.ERROR)
                    logging.getLogger("absl").setLevel(logging.ERROR)
                    import tensorflow as tf
                    tf.get_logger().setLevel("ERROR")
                    logging.getLogger("tensorflow").setLevel(logging.ERROR)
                    logging.getLogger("absl").setLevel(logging.ERROR)

                    with np.errstate(all="ignore"): tf.config.set_visible_devices([], "GPU")

                    def loader(path): return tf.keras.models.load_model(path, compile=False)

                with profile_operation("model.load.omnizart_patch_cnn"): self._model = loader(str(self.model_path))
            except EngineUnavailableError:
                raise
            except Exception as exc:
                raise EngineUnavailableError(
                    f"Omnizart Patch-CNN could not load: {type(exc).__name__}: {exc}"
                ) from exc
        return self._model

    def estimate(self, audio):
        try:
            model = self._load_model()
            waveform, sample_rate = load_mono(audio, 16_000)
            if not waveform.size: return []
            with profile_operation("preprocess.omnizart_cfp", byte_count=waveform.nbytes):
                patches, mapping, matrix, centers = extract_patch_cfp_feature(
                    waveform, sample_rate=sample_rate
                )
            with profile_operation("inference.omnizart_patch_cnn"): frequencies, confidence = decode_contour(patches, mapping, matrix, centers, model)
            window = max(1, round(sample_rate * 0.025))
            frames = []
            for index, (frequency, salience) in enumerate(
                zip(frequencies, confidence, strict=True)
            ):
                start = min(len(waveform), round(index * 0.02 * sample_rate))
                samples = waveform[start : start + window]
                energy = float(np.sqrt(np.mean(np.square(samples)) + 1e-12)) if len(samples) else 0
                voiced = bool(np.isfinite(frequency) and frequency > 0 and salience > 0)
                frames.append(
                    PitchFrame(
                        index * 0.02,
                        float(frequency) if voiced else 0.0,
                        float(salience) if voiced else 0.0,
                        voiced,
                        energy,
                    )
                )
            return frames
        except EngineUnavailableError:
            raise
        except Exception as exc:
            raise EngineUnavailableError(
                f"Omnizart Patch-CNN inference failed: {type(exc).__name__}: {exc}"
            ) from exc
