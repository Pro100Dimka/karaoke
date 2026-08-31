import os
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

from AI import audio
from AI.errors import AICoreError


@pytest.fixture
def installed(monkeypatch, tmp_path):
    root = tmp_path / "A&D Voice" / "resources" / "backend"
    runtime = root / "_internal"
    runtime.mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(root / "KaraokeBackend.exe"))
    monkeypatch.setattr(sys, "_MEIPASS", str(runtime), raising=False)
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.setattr(audio.shutil, "which", lambda _: None)
    return root, runtime


@pytest.mark.parametrize("location", [0, 1])
def test_packaged_ffmpeg_without_system_path(installed, monkeypatch, location):
    binary = installed[location] / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    binary.touch()
    run = Mock(return_value=Mock(returncode=0))
    monkeypatch.setattr(audio.subprocess, "run", run)
    audio.run_ffmpeg(["-version"])
    assert run.call_args.args[0][0] == str(binary)
    assert run.call_args.args[0][-1] == "-version"


def test_missing_ffmpeg_reports_actionable_error(installed):
    with pytest.raises(AICoreError, match="FFmpeg executable not found"):
        audio.run_ffmpeg(["-version"])


def test_explicit_override_and_invalid_override(installed, monkeypatch, tmp_path):
    binary = tmp_path / "custom ffmpeg.exe"
    binary.touch()
    monkeypatch.setenv("FFMPEG_BINARY", str(binary))
    assert audio.resolve_ffmpeg() == str(binary.resolve())
    monkeypatch.setenv("FFMPEG_BINARY", str(tmp_path / "absent.exe"))
    with pytest.raises(AICoreError, match="FFMPEG_BINARY"):
        audio.resolve_ffmpeg()


def test_development_uses_path(monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.setattr(audio.shutil, "which", lambda _: "test-ffmpeg")
    assert audio.resolve_ffmpeg() == "test-ffmpeg"


def test_real_bundled_decoder_without_path(monkeypatch, tmp_path):
    # Local release-artifact integration: never depend on an installed FFmpeg.
    runtime = Path(__file__).resolve().parents[2] / "generated/build/backend/dist/KaraokeBackend/_internal"
    if not (runtime / "ffmpeg.exe").is_file():
        pytest.skip("Windows release artifact not built")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(runtime), raising=False)
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    source, target = tmp_path / "тест песни.wav", tmp_path / "decoded.flac"
    audio.sf.write(source, audio.np.zeros((4410, 2)), 44100)
    audio.decode_audio(source, target, 48000, 2)
    samples, rate = audio.sf.read(target, always_2d=True)
    assert rate == 48000
    assert samples.shape == (4800, 2)
