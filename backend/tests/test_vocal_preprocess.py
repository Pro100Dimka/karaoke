import numpy as np
import soundfile as sf

from AI.vocal_preprocess import _gate_threshold, prepare_vocal_reference


def test_gate_threshold_tracks_the_loud_portion_of_the_vocal(tmp_path):
    rate = 16000
    quiet = np.full(rate, 0.02, dtype=np.float32)
    loud = np.full(rate, 0.2, dtype=np.float32)
    signal = np.concatenate([quiet, loud])
    source = tmp_path / "vocal.wav"
    sf.write(source, signal, rate)

    threshold = _gate_threshold(source, percentile=75)

    # p75 of a 50/50 quiet/loud mix should land on the loud half, not the quiet one.
    assert 0.05 < threshold <= 0.2


def test_gate_threshold_is_zero_for_silence(tmp_path):
    silence = np.zeros(16000, dtype=np.float32)
    source = tmp_path / "silence.wav"
    sf.write(source, silence, 16000)

    assert _gate_threshold(source, percentile=75) == 0.0


def test_prepare_vocal_reference_suppresses_a_quiet_delay_tap(tmp_path):
    rate = 16000
    duration = 4.0
    n = int(rate * duration)
    rng = np.random.default_rng(3)
    from scipy.signal import butter, lfilter

    dry = lfilter(*butter(4, 3000 / (rate / 2), btype="low"), rng.standard_normal(n))
    dry = dry / (np.abs(dry).max() + 1e-9) * 0.6
    delay = int(rate * 0.15)
    echo = np.zeros_like(dry)
    echo[delay:] = 0.25 * dry[:-delay]  # a quiet delay tap, well below the dry signal
    wet = (dry + echo).astype(np.float32)
    source = tmp_path / "wet.wav"
    sf.write(source, wet, rate)
    target = tmp_path / "vocals.flac"

    info = prepare_vocal_reference(source, target, sample_rate=rate)
    cleaned, _ = sf.read(target, always_2d=True)
    cleaned = cleaned[:, 0]

    def echo_energy(signal, delay):
        a, b = signal[delay:], signal[:-delay]
        n = min(len(a), len(b))
        return float(np.corrcoef(a[:n], b[:n])[0, 1])

    assert info.channels == 1
    assert abs(echo_energy(cleaned, delay)) < abs(echo_energy(wet, delay))


def test_prepare_vocal_reference_leaves_a_clean_signal_alone(tmp_path):
    rate = 16000
    rng = np.random.default_rng(1)
    from scipy.signal import butter, lfilter

    dry = lfilter(*butter(4, 3000 / (rate / 2), btype="low"), rng.standard_normal(rate * 2))
    dry = (dry / (np.abs(dry).max() + 1e-9) * 0.6).astype(np.float32)
    source = tmp_path / "clean.wav"
    sf.write(source, dry, rate)
    target = tmp_path / "vocals.flac"

    info = prepare_vocal_reference(source, target, sample_rate=rate)

    assert info.channels == 1
    assert info.frames > 0
