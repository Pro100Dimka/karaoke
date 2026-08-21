
from types import SimpleNamespace

import numpy as np

from AI.engines import omnizart_pitch
from AI.errors import EngineUnavailableError
from tests._shared import patch_attrs, raises


def model_files(root):
    for relative in omnizart_pitch._MODEL_FILES:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"model")


def test_decode_contour_preserves_native_timing_salience_and_unvoiced():
    patches, mapping = np.ones((3, 25, 25), dtype=np.float32), np.asarray(((40, 0), (41, 1), (42, 2)))

    class Model:
        def predict(self, batch, verbose=0):
            assert verbose == 0 and batch.shape == (3, 25, 25, 1)
            return np.asarray(((0.1, 0.9), (0.8, 0.2), (0.4, 0.6)))

    frequency, confidence = omnizart_pitch.decode_contour(
        patches, mapping, np.ones((4, 3)), np.arange(100, dtype=float), Model()
    )
    assert (len(frequency) == 3 and np.count_nonzero(frequency) == 2) and (np.all((confidence >= 0) & (confidence <= 1)))


def test_chunked_cfp_preserves_native_frame_grid(monkeypatch):
    hop = 320

    def fake_chunk(waveform, **_kwargs):
        frame_count = max(0, len(waveform) // hop - 1)
        return np.ones((2, frame_count)), [80.0, 81.0, 82.0]

    monkeypatch.setattr(omnizart_pitch, "_cfp_chunk", fake_chunk)
    matrix, _ = omnizart_pitch._extract_cfp_matrix(
        np.ones(hop * 10), sample_rate=16_000, max_frames=3
    )
    assert matrix.shape == (2, 9)


def test_estimator_success_uses_20ms_original_timeline(monkeypatch, tmp_path):
    model_files(tmp_path)
    estimator = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=lambda _: object()
    )
    patch_attrs(monkeypatch, omnizart_pitch, load_mono=lambda *_: (np.ones(1600, dtype=np.float32) * 0.1, 16000), extract_patch_cfp_feature=lambda *_args, **_kwargs: (np.ones((3, 25, 25), dtype=np.float32), np.ones((3, 2), dtype=np.int32), np.ones((2, 3), dtype=np.float32), np.arange(100, dtype=float)), decode_contour=lambda *_args, **_kwargs: (np.asarray([220, 0, 440]), np.asarray([0.8, 0, 1.0])))
    frames = estimator.estimate("original.wav")
    assert (([frame.time for frame in frames], [frame.voiced for frame in frames]) == ([0, 0.02, 0.04], [True, False, True])) and (frames[0].confidence == 0.8 and frames[1].frequency == 0) and (estimator.fingerprint()['input'] == 'original-full-mix')


def test_estimator_unavailable_and_runtime_failure_are_fallback_safe(monkeypatch, tmp_path):
    missing = omnizart_pitch.OmnizartPatchCNNPitchEstimator(tmp_path)
    raises(EngineUnavailableError, lambda: missing.estimate('audio'), match='not installed')

    model_files(tmp_path)
    broken = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=lambda _: SimpleNamespace()
    )
    patch_attrs(monkeypatch, omnizart_pitch, load_mono=lambda *_: (np.ones(1600, dtype=np.float32), 16000), extract_patch_cfp_feature=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('inference')))
    raises(EngineUnavailableError, lambda: broken.estimate('audio'), match='inference failed')


def test_cfp_numeric_helpers_and_empty_inputs(monkeypatch):
    waveform = np.sin(np.linspace(0, np.pi * 4, 100, dtype=np.float64))
    spectrum, fft_size = omnizart_pitch._stft(
        waveform, 5.0, 100, 10, np.ones(9, dtype=np.float64)
    )
    assert fft_size == 20 and spectrum.shape[0] == 20

    nonlinear = omnizart_pitch._nonlinear(
        np.asarray([[-1.0, 4.0], [9.0, 16.0], [25.0, 36.0]]), 0.5, 1
    )
    assert np.count_nonzero(nonlinear) == 2
    centers = omnizart_pitch._centers(10.0, 40.0, 12)
    assert centers[0] == 10.0 and centers[-1] < 40.0
    assert omnizart_pitch._triangular_weight(centers[1], centers, 1) == 0
    assert omnizart_pitch._triangular_weight((centers[0] + centers[1]) / 2, centers, 1) > 0

    matrix, frequencies = omnizart_pitch._extract_cfp_matrix(
        np.asarray([], dtype=np.float32), sample_rate=100, max_frames=2
    )
    assert matrix.shape == (0, 0) and frequencies.size == 0
    monkeypatch.setattr(
        omnizart_pitch,
        "_extract_cfp_matrix",
        lambda *_args, **_kwargs: (np.ones((3, 2)), np.asarray([80.0, 90.0, 100.0, 110.0])),
    )
    assert omnizart_pitch.extract_cfp_feature(waveform, sample_rate=100).shape == (2, 3)


def test_cfp_chunk_runs_frequency_and_quefrency_mappings():
    waveform = np.sin(np.linspace(0, np.pi * 8, 128, dtype=np.float64))

    matrix, centers = omnizart_pitch._cfp_chunk(
        waveform,
        sample_rate=128,
        hop_seconds=0.125,
        window_size=17,
        frequency_resolution=4.0,
        lowest_frequency=8.0,
        highest_frequency=48.0,
        bins_per_octave=12,
    )

    assert matrix.shape[0] == len(centers) - 1
    assert matrix.shape[1] > 0
    assert np.all(np.isfinite(matrix))


def test_patch_feature_and_contour_edge_cases(monkeypatch):
    matrix = np.zeros((30, 40), dtype=np.float32)
    matrix[15, :] = 2.0
    monkeypatch.setattr(
        omnizart_pitch,
        "_extract_cfp_matrix",
        lambda *_args, **_kwargs: (matrix, np.arange(31, dtype=float)),
    )
    patches, mapping, returned, centers = omnizart_pitch.extract_patch_cfp_feature(
        np.ones(100), sample_rate=100, patch_size=5
    )
    assert patches.ndim == 3 and mapping.shape[1] == 2
    assert returned is matrix and len(centers) == 31

    empty_frequency, empty_confidence = omnizart_pitch.decode_contour(
        np.asarray([]), np.asarray([]), matrix, centers, object()
    )
    assert empty_frequency.size == 0 and empty_confidence.size == 0


def test_estimator_empty_audio_and_model_loading_error(monkeypatch, tmp_path):
    model_files(tmp_path)
    empty = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=lambda _: object()
    )
    monkeypatch.setattr(
        omnizart_pitch, "load_mono", lambda *_: (np.asarray([], dtype=np.float32), 16_000)
    )
    assert empty.estimate("audio") == []

    failed = omnizart_pitch.OmnizartPatchCNNPitchEstimator(
        tmp_path, model_loader=MockLoaderError()
    )
    raises(EngineUnavailableError, lambda: failed.estimate("audio"), match="could not load")


class MockLoaderError:
    def __call__(self, _path):
        raise RuntimeError("broken model")
