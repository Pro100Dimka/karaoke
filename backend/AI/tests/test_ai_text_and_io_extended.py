from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

from src.lyrics import get_text, sync


def test_from_lrc_file_prefers_sidecar(tmp_path):
    audio = tmp_path / "song.mp3"
    audio.write_bytes(b"")
    (tmp_path / "song.lrc").write_text("[00:01.00] Hello\n[00:02]World", encoding="utf-8")
    assert get_text.from_lrc_file(str(audio)) == "Hello\nWorld"


def test_from_lrc_file_missing(tmp_path):
    assert get_text.from_lrc_file(str(tmp_path / "x.mp3")) is None


def test_id3_tags_without_lyrics(monkeypatch):
    fake_mutagen = types.ModuleType("mutagen")
    fake_mutagen.File = lambda *a, **k: types.SimpleNamespace(tags={})
    monkeypatch.setitem(sys.modules, "mutagen", fake_mutagen)
    assert get_text.from_id3_tags("x.mp3") is None


def test_get_lyrics_source_priority(monkeypatch):
    monkeypatch.setattr(get_text, "from_id3_tags", lambda p: "tag")
    monkeypatch.setattr(get_text, "from_lrc_file", lambda p: "lrc")
    monkeypatch.setattr(get_text, "from_whisper", lambda *a, **k: "whisper")
    assert get_text.get_lyrics("x") == ("tag", "id3_tags")
    monkeypatch.setattr(get_text, "from_id3_tags", lambda p: None)
    assert get_text.get_lyrics("x") == ("lrc", "lrc_file")
    monkeypatch.setattr(get_text, "from_lrc_file", lambda p: None)
    assert get_text.get_lyrics("x", whisper_audio_path="vocals.wav") == ("whisper", "whisper")
    assert get_text.get_lyrics("x", transcribe_if_missing=False) == ("", "deferred_to_timed_transcription")


def test_faster_whisper_runtime_cpu(monkeypatch):
    monkeypatch.setenv("SONGAPP_DEVICE", "cpu")
    assert sync._faster_whisper_runtime() == ("cpu", "int8")


def test_faster_whisper_runtime_cuda(monkeypatch):
    monkeypatch.setenv("SONGAPP_DEVICE", "auto")
    fake_ct2 = types.SimpleNamespace(get_cuda_device_count=lambda: 1)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)
    monkeypatch.setattr(sync.os, "name", "posix")
    assert sync._faster_whisper_runtime() == ("cuda", "float16")


def test_sync_raw_dispatch(monkeypatch):
    monkeypatch.setattr(sync, "sync_with_faster_whisper", lambda *a, **k: ["fast"])
    monkeypatch.setattr(sync, "sync_with_whisper", lambda *a, **k: ["whisper"])
    monkeypatch.setattr(sync, "sync_with_whisperx", lambda *a, **k: ["whisperx"])
    assert sync._sync_raw("x", "m", None, "faster-whisper") == ["fast"]
    assert sync._sync_raw("x", "m", None, "whisper") == ["whisper"]
    assert sync._sync_raw("x", "m", None, "whisperx") == ["whisperx"]
    assert sync._sync_raw("x", "m", None, "bad") == ["whisper"]
