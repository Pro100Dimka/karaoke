from __future__ import annotations

import subprocess
from unittest.mock import Mock

import numpy as np
import pytest
import soundfile as sf

from AI import audio as ai_audio
from AI import diagnostic_audio
from AI.errors import AICoreError
from AI.models import VocalNote


def test_render_notes_handles_bounds_fades_and_clipping():
    notes = [
        VocalNote(0, 0.001, 69),
        VocalNote(0, 1, 120),
        VocalNote(2, 3, 60),
    ]
    rendered = diagnostic_audio._render_notes(notes, frames=100, sample_rate=100)
    assert rendered.shape == (100,)
    assert rendered.dtype == np.float32
    assert np.max(np.abs(rendered)) <= 0.92
    assert np.all(diagnostic_audio._render_notes([], 5, 100) == 0)


def write_vocal(path, rate=8000, payload=None):
    sf.write(
        path, np.asarray(payload if payload is not None else [0, 0.5, -0.5], dtype=np.float32), rate
    )


def test_write_diagnostic_audio_validates_inputs(tmp_path):
    with pytest.raises(FileNotFoundError):
        diagnostic_audio.write_diagnostic_audio(
            tmp_path / "missing", tmp_path / "out", [VocalNote(0, 1, 60)]
        )
    source = tmp_path / "vocal.wav"
    write_vocal(source)
    with pytest.raises(ValueError, match="at least one"):
        diagnostic_audio.write_diagnostic_audio(source, tmp_path / "out", [], sample_rate=8000)
    with pytest.raises(ValueError, match="sample rate"):
        diagnostic_audio.write_diagnostic_audio(source, tmp_path / "out", [VocalNote(0, 1, 60)])


def test_write_diagnostic_audio_success_normalizes_vocal(monkeypatch, tmp_path):
    source = tmp_path / "vocal.wav"
    write_vocal(source, payload=[0, 0, 0])
    target = tmp_path / "nested" / "diagnostic.mp3"

    def run(command, **_):
        with open(command[-1], "wb") as stream:
            stream.write(b"mp3")

    monkeypatch.setattr(ai_audio.subprocess, "run", run)
    result = diagnostic_audio.write_diagnostic_audio(
        source, target, [VocalNote(0, 0.001, 60)], sample_rate=8000
    )
    assert result == target and target.read_bytes() == b"mp3"
    assert not list(target.parent.glob("diagnostic-*.wav"))
    assert not list(target.parent.glob("*.tmp.mp3"))


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (FileNotFoundError(), "required"),
        (subprocess.TimeoutExpired("ffmpeg", 1), "safety timeout"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b"encode failed"), "encode failed"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b""), "FFmpeg failed"),
    ],
)
def test_write_diagnostic_audio_wraps_ffmpeg_errors(monkeypatch, tmp_path, failure, message):
    source = tmp_path / "vocal.wav"
    write_vocal(source)
    monkeypatch.setattr(ai_audio.subprocess, "run", Mock(side_effect=failure))
    with pytest.raises(AICoreError, match=message):
        diagnostic_audio.write_diagnostic_audio(
            source, tmp_path / "out.mp3", [VocalNote(0, 0.001, 60)], sample_rate=8000
        )
    assert not list(tmp_path.glob("diagnostic-*.wav"))


def test_write_diagnostic_audio_rejects_missing_encoder_output(monkeypatch, tmp_path):
    source = tmp_path / "vocal.wav"
    write_vocal(source)
    monkeypatch.setattr(ai_audio.subprocess, "run", lambda *_args, **_kwargs: None)
    with pytest.raises(AICoreError, match="did not create"):
        diagnostic_audio.write_diagnostic_audio(
            source, tmp_path / "out.mp3", [VocalNote(0, 0.001, 60)], sample_rate=8000
        )
