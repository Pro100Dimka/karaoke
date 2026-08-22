import numpy as np
import soundfile as sf

from AI.vocal_preprocess import _dereverberate, prepare_vocal_reference


def _echoed_signal(rate=16000, duration=4.0, delay_sec=0.15, gain=0.6, seed=42):
    from scipy.signal import butter, lfilter

    n = int(rate * duration)
    rng = np.random.default_rng(seed)
    dry = lfilter(*butter(4, 3000 / (rate / 2), btype="low"), rng.standard_normal(n))
    delay = int(delay_sec * rate)
    echo = np.zeros_like(dry)
    echo[delay:] = gain * dry[:-delay]
    wet = dry + echo
    return wet / (np.abs(wet).max() + 1e-9) * 0.8, delay


def _echo_lag_correlation(signal, delay):
    a, b = signal[delay:], signal[:-delay]
    n = min(len(a), len(b))
    return float(np.corrcoef(a[:n], b[:n])[0, 1])


def test_dereverberate_reduces_a_known_delay_tap(tmp_path):
    wet, delay = _echoed_signal()
    stereo = np.stack([wet, wet * 0.98], axis=1).astype(np.float32)
    source = tmp_path / "wet.wav"
    sf.write(source, stereo, 16000)

    output = _dereverberate(source, tmp_path, iterations=5)
    result, _ = sf.read(output, always_2d=True)

    before = abs(_echo_lag_correlation(wet, delay))
    after = abs(_echo_lag_correlation(result[:, 0], delay))
    assert after < before


def test_dereverberate_skips_mono_input_unchanged(tmp_path):
    mono = np.zeros((16000, 1), dtype=np.float32)
    source = tmp_path / "mono.wav"
    sf.write(source, mono, 16000)

    output = _dereverberate(source, tmp_path, iterations=3)

    assert output == source


def test_prepare_vocal_reference_without_wpe_matches_previous_behavior(tmp_path):
    stereo = np.random.default_rng(0).standard_normal((16000, 2)).astype(np.float32) * 0.1
    source = tmp_path / "source.wav"
    sf.write(source, stereo, 16000)
    target = tmp_path / "vocals.flac"

    info = prepare_vocal_reference(source, target, sample_rate=16000)

    assert info.channels == 1
    assert info.frames > 0
    assert target.is_file()


def test_prepare_vocal_reference_with_wpe_still_produces_valid_mono_output(tmp_path):
    wet, _ = _echoed_signal(duration=2.0)
    stereo = np.stack([wet, wet * 0.98], axis=1).astype(np.float32)
    source = tmp_path / "source.wav"
    sf.write(source, stereo, 16000)
    target = tmp_path / "vocals.flac"

    info = prepare_vocal_reference(source, target, sample_rate=16000, wpe_iterations=3)

    assert info.channels == 1
    assert info.frames > 0
    assert target.is_file()
    # no leftover temp dereverb file
    assert not list(tmp_path.glob(".dereverb-*"))
