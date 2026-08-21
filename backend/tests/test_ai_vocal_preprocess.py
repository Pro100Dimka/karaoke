import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import soundfile as sf

from AI import vocal_preprocess
from AI.errors import AICoreError


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


def test_vocal_preprocess_rejects_empty_metadata_and_preserves_short_audio(monkeypatch):
    monkeypatch.setattr(
        vocal_preprocess.sf,
        "info",
        lambda _path: SimpleNamespace(frames=0, samplerate=8_000, channels=1),
    )
    with pytest.raises(AICoreError, match="non-empty mono"):
        vocal_preprocess.validate_vocal_reference("empty.wav")

    short = np.ones(16, dtype=np.float32)
    cleaned = vocal_preprocess._dereverberate_chunk(short, 8_000)
    assert np.array_equal(cleaned, short)
    assert cleaned is not short


def test_prepare_vocal_reference_downmixes_before_time_preserving_cleanup(monkeypatch, tmp_path):
    source, target = tmp_path / "vocals.wav", tmp_path / "clean.wav"
    source.write_bytes(b"source")

    def render(_source, destination, *_args, **kwargs):
        destination.write_bytes(b"audio")
        kwargs["validate"](destination)
        return destination

    render = Mock(side_effect=render)
    monkeypatch.setattr(
        vocal_preprocess.sf,
        "info",
        lambda path: SimpleNamespace(
            frames=8_000,
            channels=2 if path == source else 1,
            samplerate=8_000,
            duration=1.0,
        ),
    )
    monkeypatch.setattr(vocal_preprocess, "render_wav_atomic", render)
    monkeypatch.setattr(
        vocal_preprocess,
        "_dereverberate_mono",
        lambda _source, destination, **_kwargs: destination,
    )
    monkeypatch.setattr(
        vocal_preprocess,
        "_autotune_mono",
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


def test_wpe_dependency_is_mandatory(monkeypatch):
    original_import = __import__

    def import_without_wpe(name, *args, **kwargs):
        if name.startswith("nara_wpe"):
            raise ImportError("missing WPE")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", import_without_wpe)
    audio = np.ones(3_000, dtype=np.float32)
    with pytest.raises(AICoreError, match="NARA-WPE"):
        vocal_preprocess._dereverberate_chunk(audio, 8_000)


def test_dereverberate_mono_blends_overlapping_chunks(monkeypatch, tmp_path):
    source, target = tmp_path / "mono.wav", tmp_path / "clean.wav"
    audio = np.linspace(-0.5, 0.5, 220, dtype=np.float32)
    sf.write(source, audio, 100, subtype="FLOAT")
    monkeypatch.setattr(vocal_preprocess, "_WPE_CHUNK_SECONDS", 1)
    monkeypatch.setattr(vocal_preprocess, "_WPE_OVERLAP_SECONDS", 1)
    monkeypatch.setattr(
        vocal_preprocess,
        "_dereverberate_chunk",
        lambda chunk, _sample_rate, **_kwargs: chunk * 0.5,
    )

    assert vocal_preprocess._dereverberate_mono(source, target) == target
    cleaned, sample_rate = sf.read(target, dtype="float32")
    assert sample_rate == 100
    assert cleaned.shape == audio.shape
    assert np.allclose(cleaned, audio * 0.5, atol=2e-4)


def test_autotune_mono_replaces_pitch_tier_without_changing_duration(monkeypatch, tmp_path):
    source, target = tmp_path / "mono.wav", tmp_path / "tuned.wav"
    audio = np.linspace(-0.25, 0.25, 800, dtype=np.float32)
    sf.write(source, audio, 8_000, subtype="FLOAT")
    sound = SimpleNamespace(xmin=0.0, xmax=0.1)
    manipulation, pitch_tier = object(), object()
    added = []

    def praat_call(subject, command, *args):
        if command == "To Manipulation":
            return manipulation
        if command == "Extract pitch tier":
            return pitch_tier
        if command == "Get number of points":
            return 2
        if command == "Get time from index":
            return [0.02, 0.08][args[0] - 1]
        if command == "Get value at index":
            return [111.0, 222.0][args[0] - 1]
        if command == "Add point":
            added.append(args)
        if command == "Get resynthesis (overlap-add)":
            return SimpleNamespace(values=audio.reshape(1, -1))
        return None

    parselmouth = ModuleType("parselmouth")
    parselmouth.Sound = lambda _path: sound
    praat = ModuleType("parselmouth.praat")
    praat.call = praat_call
    monkeypatch.setitem(sys.modules, "parselmouth", parselmouth)
    monkeypatch.setitem(sys.modules, "parselmouth.praat", praat)
    monkeypatch.setattr(
        vocal_preprocess,
        "quantize_voiced_points",
        lambda times, frequencies: [110.0, 220.0],
    )

    assert vocal_preprocess._autotune_mono(source, target) == target
    assert added == [(0.02, 110.0), (0.08, 220.0)]
    assert sf.info(target).frames == sf.info(source).frames


def test_autotune_reports_praat_processing_failures(monkeypatch, tmp_path):
    parselmouth = ModuleType("parselmouth")
    parselmouth.Sound = Mock(side_effect=RuntimeError("broken tier"))
    praat = ModuleType("parselmouth.praat")
    praat.call = Mock()
    monkeypatch.setitem(sys.modules, "parselmouth", parselmouth)
    monkeypatch.setitem(sys.modules, "parselmouth.praat", praat)

    with pytest.raises(AICoreError, match="broken tier"):
        vocal_preprocess._autotune_mono(tmp_path / "source.wav", tmp_path / "target.wav")
