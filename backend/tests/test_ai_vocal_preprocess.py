from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import soundfile as sf

from AI import vocal_preprocess


def test_validate_vocal_reference_requires_mono(tmp_path):
    mono = tmp_path / "mono.wav"
    stereo = tmp_path / "stereo.wav"
    sf.write(mono, np.zeros(800, dtype=np.float32), 8_000)
    sf.write(stereo, np.zeros((800, 2), dtype=np.float32), 8_000)

    assert vocal_preprocess.validate_vocal_reference(mono).channels == 1
    try:
        vocal_preprocess.validate_vocal_reference(stereo)
    except Exception as exc:  # exact public error text matters more than soundfile internals
        assert "mono" in str(exc)
    else:
        raise AssertionError("stereo vocal reference was accepted")


def test_prepare_vocal_reference_downmixes_before_time_preserving_cleanup(monkeypatch, tmp_path):
    source, target = tmp_path / "vocals.wav", tmp_path / "clean.wav"
    source.write_bytes(b"source")
    render = Mock(side_effect=lambda _source, destination, *_args, **_kwargs: destination)
    monkeypatch.setattr(
        vocal_preprocess.sf,
        "info",
        lambda _path: SimpleNamespace(frames=8_000, channels=2, samplerate=8_000, duration=1.0),
    )
    monkeypatch.setattr(vocal_preprocess, "render_wav_atomic", render)
    monkeypatch.setattr(
        vocal_preprocess,
        "_dereverberate_mono",
        lambda _source, destination: destination,
    )

    assert vocal_preprocess.prepare_vocal_reference(source, target) == target
    mono_arguments = render.call_args_list[0].args[2]
    cleanup_arguments = render.call_args_list[1].args[2]
    assert mono_arguments[mono_arguments.index("-af") + 1] == "aformat=channel_layouts=mono"
    cleanup_graph = cleanup_arguments[cleanup_arguments.index("-af") + 1]
    assert "afftdn=" in cleanup_graph and "agate=" not in cleanup_graph
    assert mono_arguments[mono_arguments.index("-ac") + 1] == "1"
    assert cleanup_arguments[cleanup_arguments.index("-ac") + 1] == "1"


def test_wpe_dereverberation_reduces_a_known_echo():
    sample_rate = 8_000
    random = np.random.default_rng(4)
    time = np.arange(sample_rate * 6, dtype=np.float64) / sample_rate
    envelope = (np.sin(2 * np.pi * 0.7 * time) > 0) * 0.8 + 0.1
    dry = (
        0.2 * np.sin(2 * np.pi * (180 + 20 * np.sin(2 * np.pi * 0.2 * time)) * time)
        + 0.08 * random.normal(size=time.size)
    ) * envelope
    delay = int(0.12 * sample_rate)
    wet = dry.copy()
    wet[delay:] += 0.42 * dry[:-delay]
    second_delay = int(0.28 * sample_rate)
    wet[second_delay:] += 0.25 * dry[:-second_delay]

    cleaned = vocal_preprocess._dereverberate_chunk(wet.astype(np.float32), sample_rate)

    assert cleaned.shape == wet.shape
    assert np.all(np.isfinite(cleaned))
    assert np.sqrt(np.mean((cleaned - dry) ** 2)) < np.sqrt(np.mean((wet - dry) ** 2))
    assert np.corrcoef(cleaned, dry)[0, 1] > np.corrcoef(wet, dry)[0, 1]
