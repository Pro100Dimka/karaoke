from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

from src.analyze import breath, game_onnx, music, structure, vocal
from src.build import convert, project, report, unified_song_map
from src.common import model_paths, notes
from src.evaluation import difficulty_map
from src.preprocessing import probe, separate


def test_note_conversion_roundtrip_and_invalid():
    for name in ("C0", "A4", "C#5", "B8"):
        assert notes.midi_to_note(notes.note_to_midi(name)) == name
    with pytest.raises((KeyError, ValueError)):
        notes.note_to_midi("H4")


def test_model_paths_are_stable(monkeypatch, tmp_path):
    monkeypatch.setattr(model_paths, "backend_dir", lambda: tmp_path)
    assert model_paths.models_dir() == tmp_path / "models"
    assert model_paths.whisper_dir() == tmp_path / "models" / "whisper"
    assert model_paths.demucs_cache_dir() == tmp_path / "models" / "huggingface"
    assert model_paths.game_model_dir() == tmp_path / "engines" / "game" / "models" / "GAME-1.0.3-large-onnx"


def test_breath_intervals_merge_and_union():
    frames = [
        {"time": 0.00, "voiced": True},
        {"time": 0.01, "voiced": True},
        {"time": 0.02, "voiced": False},
        {"time": 0.03, "voiced": True},
        {"time": 0.04, "voiced": False},
    ]
    assert breath._intervals_from_pitch(frames) == [(0.0, 0.04)]
    assert breath._intervals_from_pitch([]) == []
    assert breath._union_intervals([(0, 1), (3, 4)], [(0.5, 2), (5, 6)]) == [
        (0, 2),
        (3, 4),
        (5, 6),
    ]
    assert breath._union_intervals([], []) == []


def test_analyze_breath_classifies_gaps(monkeypatch):
    monkeypatch.setattr(breath.librosa, "load", lambda *a, **k: (np.ones(10), 10))
    monkeypatch.setattr(
        breath,
        "_intervals_from_rms",
        lambda *a, **k: [(0.0, 1.0), (1.05, 2.0), (2.3, 3.0), (4.0, 5.0)],
    )
    result = breath.analyze_breath("x.wav", top_db=30, phrase_gap_sec=0.6, breath_gap_sec=0.15)
    assert [p["type"] for p in result["pauses"]] == ["micro_pause", "breath", "phrase_end"]
    assert result["top_db_used"] == 30


def test_adaptive_top_db_clamps(monkeypatch):
    monkeypatch.setattr(breath.librosa.feature, "rms", lambda **k: np.array([[1.0, 0.1]]))
    monkeypatch.setattr(breath.librosa, "amplitude_to_db", lambda x, ref: np.array([-100.0, -90.0]))
    assert breath._estimate_adaptive_top_db(np.ones(3), 10) == 50.0


def test_music_boundary_chroma_gate_and_no_gate():
    chroma = np.arange(48, dtype=float).reshape(12, 4)
    rms = np.array([0.0, 1.0, 1.0, 0.0])
    result = music.compute_boundary_chroma(chroma, rms, boundary_fraction=0.25, energy_gate_ratio=0.5)
    assert result is None
    result = music.compute_boundary_chroma(chroma, np.ones(2), boundary_fraction=0.25)
    assert result.shape == (12,)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, 0), (-1, -1), (35, 140), (60, 120), (90, 90), (360, 180), (400, 100)],
)
def test_fold_tempo(value, expected):
    assert music.fold_tempo(value) == expected


def test_estimate_key_returns_ranked_candidates():
    key, score, candidates = music.estimate_key(music.MAJOR_PROFILE.copy())
    assert key == "C major"
    assert score == pytest.approx(1.0)
    assert len(candidates) == 3
    assert candidates == sorted(candidates, reverse=True)


def test_estimate_time_signature_short_input():
    assert music.estimate_time_signature(np.ones(4), sr=100, bpm=120) == ("4/4", 0.0)


def test_structure_labels_similar_segments():
    features = [np.array([1.0, 0.0]), np.array([0.99, 0.01]), np.array([0.0, 1.0])]
    labels = structure._label_similar_segments(features, similarity_threshold=0.9)
    assert labels[0] == labels[1]
    assert labels[2] != labels[0]
    assert structure._label_similar_segments([]) == []


def test_freq_to_note_edge_cases():
    assert vocal.freq_to_note(440.0) == "A4"
    assert vocal.freq_to_note(0) is None
    assert vocal.freq_to_note(float("nan")) is None


def test_analyze_vocal_energy_builds_frames(monkeypatch):
    monkeypatch.setattr(vocal.librosa, "load", lambda *a, **k: (np.ones(10), 100))
    monkeypatch.setattr(
        vocal,
        "_analyze_energy",
        lambda *a, **k: (
            np.array([0.0, 0.1]),
            np.array([440.0, np.nan]),
            np.array([True, False]),
            np.array([0.9, 0.0]),
            np.array([-10.0, -40.0]),
        ),
    )
    frames = vocal.analyze_vocal("x.wav", engine="energy")
    assert frames[0]["note"] == "A4"
    assert frames[1]["note"] is None
    assert frames[0]["confidence"] == 0.9


def test_convert_commands(monkeypatch):
    calls = []
    monkeypatch.setattr(convert.subprocess, "run", lambda cmd, **kwargs: calls.append((cmd, kwargs)))
    convert.convert("in.mp3", "out.wav", 48000, 1, 24)
    convert.normalize_loudness("in.wav", "out.wav", -14, -1, 8)
    assert calls[0][0] == [
        "ffmpeg", "-y", "-i", "in.mp3", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", "out.wav"
    ]
    assert "loudnorm=I=-14:TP=-1:LRA=8" in calls[1][0]
    assert all(call[1]["check"] is True for call in calls)


def test_probe_file_parses_ffprobe(monkeypatch):
    payload = {
        "format": {"duration": "12.5", "format_name": "mp3", "bit_rate": "128000"},
        "streams": [{"sample_rate": "44100", "channels": 2, "codec_name": "mp3"}],
    }
    result_obj = types.SimpleNamespace(stdout=json.dumps(payload))
    monkeypatch.setattr(probe.subprocess, "run", lambda *a, **k: result_obj)
    info = probe.probe_file("song.mp3")
    assert info["duration_sec"] == 12.5
    assert info["sample_rate_hz"] == 44100
    assert info["bit_rate_bps"] == 128000


def test_probe_file_empty_streams(monkeypatch):
    result_obj = types.SimpleNamespace(stdout=json.dumps({"format": {}}))
    monkeypatch.setattr(probe.subprocess, "run", lambda *a, **k: result_obj)
    info = probe.probe_file("x")
    assert info["codec"] is None
    assert info["channels"] == 0


def test_build_project_manifest(tmp_path):
    source = tmp_path / "source.json"
    source.write_text("{}", encoding="utf-8")
    dest = tmp_path / "project"
    manifest = project.build_project(str(dest), song_info=str(source))
    assert (dest / "songInfo.json").exists()
    assert manifest["project"] == "project"
    assert manifest["complete"] is False
    loaded = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
    assert loaded == manifest


def test_build_project_does_not_copy_same_file(tmp_path, monkeypatch):
    dest = tmp_path / "project"
    dest.mkdir()
    existing = dest / "songInfo.json"
    existing.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(project.shutil, "copy", lambda *a, **k: pytest.fail("copy must not run"))
    manifest = project.build_project(str(dest), song_info=str(existing))
    assert "song_info" in manifest["files"]


def test_report_load_and_render(tmp_path):
    (tmp_path / "songInfo.json").write_text(json.dumps({"duration_sec": 125, "format": "wav", "sample_rate_hz": 44100, "channels": 2}), encoding="utf-8")
    (tmp_path / "music.json").write_text(json.dumps({"bpm": 120, "bpm_raw": 60, "key": "C major", "key_confidence": 0.9, "time_signature": "4/4", "time_signature_confidence": 0.8}), encoding="utf-8")
    (tmp_path / "reference.json").write_text(json.dumps([{"duration": 0.5}]), encoding="utf-8")
    (tmp_path / "difficulty.json").write_text(json.dumps([{"difficulty": 5, "text": "line", "range": "C4-G4"}]), encoding="utf-8")
    text = report.build_report(str(tmp_path))
    assert "2:05" in text
    assert "BPM: **120**" in text
    assert "Всего нот: 1" in text
    assert "Самая сложная строка" in text
    assert report._load_if_exists(tmp_path / "missing.json") is None


def test_unified_song_map_boundaries_and_nearest_tempo():
    result = unified_song_map.build_song_map(
        {"bpm": 100, "key": "C", "time_signature": "4/4", "tempo_curve": [{"time": 0, "bpm": 90}, {"time": 2, "bpm": 110}]},
        [{"start": 0.5, "end": 1.5, "note": "A4"}],
        [{"start": 0.0, "end": 1.0, "text": "hello"}],
        {"pauses": [{"start": 1.0, "end": 1.2}]},
        [{"time": 0.0, "f0_hz": 440}, {"time": 1.0, "f0_hz": 441}, {"time": 2.0, "f0_hz": 442}],
    )
    assert [x["bpm"] for x in result["timeline"]] == [90, 90, 110]
    assert result["timeline"][1]["note"] == "A4"
    assert result["timeline"][1]["pause"] is True


def test_find_current_inclusive():
    items = [{"start": 1, "end": 2}, {"start": 3, "end": 4}]
    assert unified_song_map.find_current(items, 2) == [items[0]]


def test_difficulty_empty_and_nonempty():
    empty = difficulty_map.compute_difficulty([])
    assert empty["difficulty"] == 0
    section = [
        {"note": "C4", "start": 0.0, "end": 0.5, "duration": 0.5},
        {"note": "C5", "start": 0.5, "end": 1.0, "duration": 0.5},
    ]
    value = difficulty_map.compute_difficulty(section)
    assert value["range"] == "C4-C5"
    assert 0 < value["difficulty"] <= 10
    assert difficulty_map.notes_in_range(section, 0.25, 0.75) == section


def test_build_difficulty_map_preserves_section_data():
    result = difficulty_map.build_difficulty_map([], [{"start": 0, "end": 1, "text": "x"}])
    assert result[0]["text"] == "x"
    assert result[0]["difficulty"] == 0


def test_game_chunks_cover_length():
    chunks = game_onnx._chunks(60, 2)
    assert chunks == [(0, 50, 0, 50), (50, 60, 50, 60)]
    assert game_onnx._chunks(0, 2) == []


def test_game_provider_cpu_requested(monkeypatch):
    fake_ort = types.SimpleNamespace(get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    monkeypatch.setenv("SONGAPP_DEVICE", "cpu")
    assert game_onnx._select_providers() == ["CPUExecutionProvider"]


def test_game_provider_falls_back_without_cuda(monkeypatch):
    fake_ort = types.SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"])
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    monkeypatch.delenv("SONGAPP_DEVICE", raising=False)
    assert game_onnx._select_providers() == ["CPUExecutionProvider"]


def test_separate_uses_demucs_api(monkeypatch, tmp_path):
    class Audio:
        def __init__(self, value): self.value = value
        def __add__(self, other): return Audio(self.value + other.value)

    saved = []
    class Separator:
        samplerate = 44100
        def __init__(self, **kwargs): self.kwargs = kwargs
        def separate_audio_file(self, path):
            return None, {"vocals": Audio(1), "drums": Audio(2), "bass": Audio(3), "other": Audio(4)}
    fake_demucs = types.ModuleType("demucs.api")
    fake_demucs.Separator = Separator
    def save_audio(audio, path, **kwargs):
        Path(path).write_bytes(b"x")
        saved.append((audio.value, Path(path).name, kwargs))
    fake_demucs.save_audio = save_audio
    monkeypatch.setitem(sys.modules, "demucs", types.ModuleType("demucs"))
    monkeypatch.setitem(sys.modules, "demucs.api", fake_demucs)
    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(separate, "demucs_cache_dir", lambda: tmp_path / "cache")
    result = separate.separate("song.wav", str(tmp_path / "out"), two_stems=False, shifts=0)
    assert Path(result["vocals"]).exists()
    assert Path(result["instrumental"]).exists()
    assert any(name == "drums.wav" for _, name, _ in saved)
    assert next(v for v, name, _ in saved if name == "instrumental.wav") == 9
