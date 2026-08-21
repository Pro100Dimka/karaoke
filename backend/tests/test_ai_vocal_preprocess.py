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
    render = Mock(return_value=target)
    monkeypatch.setattr(
        vocal_preprocess.sf,
        "info",
        lambda _path: SimpleNamespace(frames=8_000, channels=2, samplerate=8_000, duration=1.0),
    )
    monkeypatch.setattr(vocal_preprocess, "_adaptive_gate_threshold", lambda _path: 0.007)
    monkeypatch.setattr(vocal_preprocess, "render_wav_atomic", render)

    assert vocal_preprocess.prepare_vocal_reference(source, target) == target
    arguments = render.call_args.args[2]
    graph = arguments[arguments.index("-af") + 1]
    assert graph.startswith("aformat=channel_layouts=mono,highpass=")
    assert "afftdn=" in graph and "agate=threshold=0.007000" in graph
    assert arguments[arguments.index("-ac") + 1] == "1"
