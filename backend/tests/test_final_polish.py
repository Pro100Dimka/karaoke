import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import config
from app.services import recording_service, song_package_service


class _FakeStream:
    def __init__(self, **_kwargs):
        self.started = False
        self.stopped = False
        self.closed = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True


class _FakeSoundFile:
    writes: list[int] = []

    def __init__(self, *_args, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def write(self, chunk):
        self.writes.append(len(chunk))


def _recording_session(tmp_path: Path, monkeypatch) -> recording_service.RecordingSession:
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(
        recording_service, "sd", SimpleNamespace(InputStream=_FakeStream), raising=False
    )
    monkeypatch.setattr(
        recording_service, "sf", SimpleNamespace(SoundFile=_FakeSoundFile), raising=False
    )
    _FakeSoundFile.writes = []
    return recording_service.RecordingSession(
        "session-id",
        "song-id",
        None,
        None,
        48_000,
        1,
        1.0,
        False,
    )


def test_recording_chunks_are_written_before_stop(tmp_path, monkeypatch):
    session = _recording_session(tmp_path, monkeypatch)
    session.start()
    session._queue.put(np.zeros((256, 1), dtype=np.float32))

    deadline = time.monotonic() + 1
    while not _FakeSoundFile.writes and time.monotonic() < deadline:
        time.sleep(0.01)

    assert _FakeSoundFile.writes == [256]
    output = tmp_path / "take.wav"
    duration, sample_rate = session.stop_and_save(output)
    assert output.is_file()
    assert duration == pytest.approx(256 / 48_000)
    assert sample_rate == 48_000
    assert not list(tmp_path.glob("karaoke-recording-*.wav"))


def test_failed_recording_start_removes_temporary_file(tmp_path, monkeypatch):
    class _FailingStream(_FakeStream):
        def start(self):
            raise RuntimeError("device busy")

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(
        recording_service, "sd", SimpleNamespace(InputStream=_FailingStream), raising=False
    )
    monkeypatch.setattr(
        recording_service, "sf", SimpleNamespace(SoundFile=_FakeSoundFile), raising=False
    )
    session = recording_service.RecordingSession(
        "session-id", "song-id", None, None, 48_000, 1, 1.0, False
    )

    with pytest.raises(RuntimeError, match="device busy"):
        session.start()

    assert not list(tmp_path.glob("karaoke-recording-*.wav"))


def test_package_rejects_encrypted_member():
    member = SimpleNamespace(
        filename="manifest.json",
        file_size=2,
        compress_size=2,
        flag_bits=1,
        is_dir=lambda: False,
    )
    archive = SimpleNamespace(infolist=lambda: [member])
    with pytest.raises(ValueError, match="(?i)encrypted"):
        song_package_service._safe_members(archive)


def test_package_rejects_extreme_compression_ratio():
    member = SimpleNamespace(
        filename="output/huge.json",
        file_size=20 * 1024 * 1024,
        compress_size=1024,
        flag_bits=0,
        is_dir=lambda: False,
    )
    archive = SimpleNamespace(infolist=lambda: [member])
    with pytest.raises(ValueError, match="suspiciously compressed"):
        song_package_service._safe_members(archive)
