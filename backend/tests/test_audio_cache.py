import numpy as np
import soundfile as sf

from AI.audio import audio_buffer_cache, read_mono


def write_wav(path, samples, rate=8000):
    sf.write(path, samples, rate, format="WAV", subtype="FLOAT")


def test_read_mono_reuses_the_decode_within_an_active_cache(tmp_path, monkeypatch):
    path = tmp_path / "vocals.wav"
    write_wav(path, np.linspace(-0.5, 0.5, 4000, dtype=np.float32))

    calls = []
    real_read = sf.read

    def counting_read(*args, **kwargs):
        calls.append(args[0])
        return real_read(*args, **kwargs)

    monkeypatch.setattr(sf, "read", counting_read)

    with audio_buffer_cache():
        first, rate1 = read_mono(path)
        second, rate2 = read_mono(path)
    assert len(calls) == 1
    assert rate1 == rate2 == 8000
    np.testing.assert_array_equal(first, second)


def test_read_mono_does_not_cache_outside_an_active_context(tmp_path, monkeypatch):
    path = tmp_path / "vocals.wav"
    write_wav(path, np.linspace(-0.5, 0.5, 4000, dtype=np.float32))

    calls = []
    real_read = sf.read

    def counting_read(*args, **kwargs):
        calls.append(args[0])
        return real_read(*args, **kwargs)

    monkeypatch.setattr(sf, "read", counting_read)

    read_mono(path)
    read_mono(path)
    assert len(calls) == 2


def test_read_mono_cache_does_not_leak_between_separate_contexts(tmp_path, monkeypatch):
    path = tmp_path / "vocals.wav"
    write_wav(path, np.linspace(-0.5, 0.5, 4000, dtype=np.float32))

    calls = []
    real_read = sf.read

    def counting_read(*args, **kwargs):
        calls.append(args[0])
        return real_read(*args, **kwargs)

    monkeypatch.setattr(sf, "read", counting_read)

    with audio_buffer_cache():
        read_mono(path)
    with audio_buffer_cache():
        read_mono(path)
    assert len(calls) == 2


def test_read_mono_returns_independent_copies_so_a_caller_cannot_corrupt_the_cache(tmp_path):
    path = tmp_path / "vocals.wav"
    write_wav(path, np.linspace(-0.5, 0.5, 4000, dtype=np.float32))

    with audio_buffer_cache():
        first, _ = read_mono(path)
        first[:] = 999.0
        second, _ = read_mono(path)
    assert not np.any(second == 999.0)


def test_read_mono_averages_multi_channel_audio_to_a_single_channel(tmp_path):
    path = tmp_path / "stereo.wav"
    left = np.full(1000, 0.2, dtype=np.float32)
    right = np.full(1000, 0.6, dtype=np.float32)
    write_wav(path, np.stack([left, right], axis=1))
    mono, rate = read_mono(path)
    assert rate == 8000
    np.testing.assert_allclose(mono, 0.4, atol=1e-6)
