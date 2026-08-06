from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

from src.analyze import game_onnx, vocal
from src.lyrics import get_text, sync


def test_game_extract_filters_chunk_overlap(monkeypatch, tmp_path):
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "config.json").write_text(json.dumps({"samplerate": 2, "languages": {"uk": 7}}), encoding="utf-8")
    for name in ("encoder", "segmenter", "bd2dur", "estimator"):
        (model_dir / f"{name}.onnx").write_bytes(b"")

    class Session:
        def get_providers(self): return ["CPUExecutionProvider"]
    monkeypatch.setattr(game_onnx, "_prepare_cuda_dlls", lambda: None)
    monkeypatch.setattr(game_onnx, "_select_providers", lambda: ["CPUExecutionProvider"])
    monkeypatch.setattr(game_onnx, "_session", lambda *a: Session())
    monkeypatch.setattr(game_onnx.librosa, "load", lambda *a, **k: (np.ones(60), 2))
    monkeypatch.setattr(game_onnx, "_extract_chunk", lambda waveform, rate, sessions, language_id: [(1, 2, 60.2), (26, 27, 62.4)])
    result = game_onnx.extract("audio.wav", model_dir, "uk")
    assert result["engine"] == "game-onnx"
    assert result["provider"] == "CPUExecutionProvider"
    assert result["notes"][0] == {"note": 60, "start": 1.0, "end": 2.0}
    assert all(n["start"] < 30 for n in result["notes"])


def test_prepare_cuda_dlls_ignores_errors(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(__file__=None))
    game_onnx._prepare_cuda_dlls()


def test_session_constructs_onnx_session(monkeypatch, tmp_path):
    calls = []
    fake = types.SimpleNamespace(InferenceSession=lambda path, providers: calls.append((path, providers)) or "session")
    monkeypatch.setitem(sys.modules, "onnxruntime", fake)
    assert game_onnx._session(tmp_path / "m.onnx", ["CPUExecutionProvider"]) == "session"
    assert calls[0][1] == ["CPUExecutionProvider"]


def test_analyze_vocal_torchcrepe_fallback(monkeypatch):
    monkeypatch.setattr(vocal.librosa, "load", lambda *a, **k: (np.ones(4), 100))
    monkeypatch.setattr(vocal, "_analyze_torchcrepe", lambda *a, **k: (_ for _ in ()).throw(ImportError("missing")))
    monkeypatch.setattr(vocal, "_analyze_energy", lambda *a, **k: (np.array([0.0]), np.array([np.nan]), np.array([False]), np.array([0.0]), np.array([-40.0])))
    assert vocal.analyze_vocal("x", engine="torchcrepe")[0]["voiced"] is False


def test_analyze_vocal_crepe_fallback(monkeypatch):
    monkeypatch.setattr(vocal.librosa, "load", lambda *a, **k: (np.ones(4), 100))
    monkeypatch.setattr(vocal, "_analyze_crepe", lambda *a, **k: (_ for _ in ()).throw(ImportError("missing")))
    monkeypatch.setattr(vocal, "_analyze_pyin", lambda *a, **k: (np.array([0.0]), np.array([440.0]), np.array([True]), np.array([0.8]), np.array([-8.0])))
    assert vocal.analyze_vocal("x", engine="crepe")[0]["note"] == "A4"


def test_from_whisper_uses_configured_cache(monkeypatch, tmp_path):
    calls = []
    class Model:
        def transcribe(self, path, language=None): return {"text": " hello "}
    fake = types.SimpleNamespace(load_model=lambda name, download_root: calls.append((name, download_root)) or Model())
    monkeypatch.setitem(sys.modules, "whisper", fake)
    monkeypatch.setattr(get_text, "whisper_dir", lambda: tmp_path)
    assert get_text.from_whisper("x.wav", "small", "uk") == "hello"
    assert calls == [("small", str(tmp_path))]


def test_id3_generic_lyrics(monkeypatch):
    monkeypatch.setattr(get_text, "MutagenFile", lambda p: {"lyrics": ["a", "b"]})
    assert get_text.from_id3_tags("x") == "a\nb"
    monkeypatch.setattr(get_text, "MutagenFile", lambda p: (_ for _ in ()).throw(RuntimeError()))
    assert get_text.from_id3_tags("x") is None


def test_transcribe_faster_formats_segments(monkeypatch, tmp_path):
    word = types.SimpleNamespace(word=" hi ", start=0.1, end=0.3)
    segment = types.SimpleNamespace(text=" Hello ", start=0.0, end=1.0, words=[word])
    class Model:
        def __init__(self, *a, **k): pass
        def transcribe(self, *a, **k): return [segment], {}
    fake = types.ModuleType("faster_whisper")
    fake.WhisperModel = Model
    monkeypatch.setitem(sys.modules, "faster_whisper", fake)
    monkeypatch.setattr(sync, "whisper_dir", lambda: tmp_path)
    monkeypatch.setattr(sync, "reconcile_lyric_words", lambda lines: lines)
    lines = sync._transcribe_faster("x", "uk", "cpu", "int8")
    assert lines == [{"text": "Hello", "start": 0.0, "end": 1.0, "words": [{"word": "hi", "start": 0.1, "end": 0.3}]}]


def test_sync_with_faster_whisper_retries_cpu(monkeypatch):
    monkeypatch.setattr(sync, "_faster_whisper_runtime", lambda: ("cuda", "float16"))
    calls = []
    def transcribe(*args):
        calls.append(args[-2:])
        if args[-2] == "cuda": raise RuntimeError("cuda")
        return [1]
    monkeypatch.setattr(sync, "_transcribe_faster", transcribe)
    assert sync.sync_with_faster_whisper("x") == [1]
    assert calls == [("cuda", "float16"), ("cpu", "int8")]


def test_sync_with_whisper_formats_result(monkeypatch, tmp_path):
    result = {"segments": [{"text": " line ", "start": 0.0, "end": 1.2345, "words": [{"word": " one ", "start": 0.1, "end": 0.2}]}]}
    class Model:
        def transcribe(self, *a, **k): return result
    fake = types.SimpleNamespace(load_model=lambda *a, **k: Model())
    monkeypatch.setitem(sys.modules, "whisper", fake)
    monkeypatch.setattr(sync, "whisper_dir", lambda: tmp_path)
    monkeypatch.setattr(sync, "reconcile_lyric_words", lambda lines: lines)
    lines = sync.sync_with_whisper("x", "tiny", "uk")
    assert lines[0]["text"] == "line"
    assert lines[0]["end"] == 1.234


def test_sync_existing_lyrics_replaces_matching_lines(monkeypatch, tmp_path):
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("First\nSecond\n", encoding="utf-8")
    monkeypatch.setattr(sync, "_sync_raw", lambda *a, **k: [{"text": "a"}, {"text": "b"}])
    lines = sync.sync_existing_lyrics_with_whisper("x", str(lyrics))
    assert [x["text"] for x in lines] == ["First", "Second"]


def test_sync_raw_faster_fallback(monkeypatch):
    monkeypatch.setattr(sync, "sync_with_faster_whisper", lambda *a, **k: [])
    monkeypatch.setattr(sync, "sync_with_whisper", lambda *a, **k: ["fallback"])
    assert sync._sync_raw("x", "m", None, "auto") == ["fallback"]
