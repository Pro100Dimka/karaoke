from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import recording_service
from app.utils import quarantine


class FakeDb:
    def __init__(self, *, fail_commit=False):
        self.fail_commit = fail_commit
        self.deleted = []
        self.committed = False
        self.rolled_back = False

    def delete(self, value):
        self.deleted.append(value)

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("database locked")
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def _recording(path: Path):
    return SimpleNamespace(path=str(path), filename=path.name)


def test_delete_recording_removes_files_after_success(tmp_path, monkeypatch):
    voice = tmp_path / "take.wav"
    mix = tmp_path / "take-performance.mp3"
    old_mix = tmp_path / "take-performance.wav"
    for path in (voice, mix, old_mix):
        path.write_bytes(b"data")
    recording = _recording(voice)
    monkeypatch.setattr(recording_service, "resolve_recording_path", lambda value: voice)
    monkeypatch.setattr(recording_service, "performance_mix_paths", lambda value: (mix, old_mix))
    db = FakeDb()

    recording_service.delete_recording(db, recording)

    assert db.committed is True
    assert db.rolled_back is False
    assert not any(path.exists() for path in (voice, mix, old_mix))
    assert not list(tmp_path.glob(".*.delete-*"))


def test_delete_recording_restores_files_when_commit_fails(tmp_path, monkeypatch):
    voice = tmp_path / "take.wav"
    mix = tmp_path / "take-performance.mp3"
    for path in (voice, mix):
        path.write_bytes(path.name.encode())
    recording = _recording(voice)
    monkeypatch.setattr(recording_service, "resolve_recording_path", lambda value: voice)
    monkeypatch.setattr(recording_service, "performance_mix_paths", lambda value: (mix, tmp_path / "missing.wav"))
    db = FakeDb(fail_commit=True)

    with pytest.raises(RuntimeError, match="database locked"):
        recording_service.delete_recording(db, recording)

    assert db.rolled_back is True
    assert voice.read_bytes() == b"take.wav"
    assert mix.read_bytes() == b"take-performance.mp3"
    assert not list(tmp_path.glob(".*.delete-*"))


def test_quarantine_restores_already_moved_files_on_partial_failure(tmp_path, monkeypatch):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    real_replace = Path.replace

    def replace(path, target):
        if path == second:
            raise OSError("busy")
        return real_replace(path, target)

    monkeypatch.setattr(Path, "replace", replace)

    with pytest.raises(OSError, match="busy"):
        quarantine.quarantine_paths((first, second))

    assert first.read_bytes() == b"first"
    assert second.read_bytes() == b"second"
    assert not list(tmp_path.glob(".*.delete-*"))


def test_existing_recording_files_deduplicates_paths(tmp_path, monkeypatch):
    voice = tmp_path / "take.wav"
    voice.write_bytes(b"x")
    recording = _recording(voice)
    monkeypatch.setattr(recording_service, "resolve_recording_path", lambda value: voice)
    monkeypatch.setattr(recording_service, "performance_mix_paths", lambda value: (voice, voice))

    assert recording_service._existing_recording_files(recording) == (voice,)
