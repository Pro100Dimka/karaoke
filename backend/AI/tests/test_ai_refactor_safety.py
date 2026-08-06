from __future__ import annotations

import importlib
import json
import sys
import types
from pathlib import Path

import pytest

from src.build import project, unified_song_map
from src.common import json_io
from src.preprocessing import probe, separate


def test_atomic_json_replaces_target_and_cleans_temporary_files(tmp_path):
    target = tmp_path / "nested" / "value.json"
    json_io.save_json({"value": "старое"}, target)
    json_io.save_json({"value": "новое"}, target)
    assert json_io.load_json(target) == {"value": "новое"}
    assert list(target.parent.glob(f".{target.name}.*.tmp")) == []


def test_atomic_json_preserves_existing_file_on_serialization_error(tmp_path):
    target = tmp_path / "value.json"
    json_io.save_json({"stable": True}, target)
    with pytest.raises(TypeError):
        json_io.save_json({"bad": object()}, target)
    assert json_io.load_json(target) == {"stable": True}
    assert list(tmp_path.glob(".*.tmp")) == []


def test_song_map_handles_unsorted_intervals_and_tempo_curve():
    result = unified_song_map.build_song_map(
        {"bpm": 120, "tempo_curve": [{"time": 2, "bpm": 130}, {"time": 0, "bpm": 100}]},
        [{"start": 2, "end": 3, "note": "D4"}, {"start": 0, "end": 1, "note": "C4"}],
        [{"start": 2, "end": 3, "text": "два"}, {"start": 0, "end": 1, "text": "один"}],
        {"pauses": [{"start": 1.4, "end": 1.6}]},
        [{"time": 0.5}, {"time": 1.5}, {"time": 2.5}],
    )
    assert [frame["note"] for frame in result["timeline"]] == ["C4", None, "D4"]
    assert [frame["text"] for frame in result["timeline"]] == ["один", None, "два"]
    assert [frame["pause"] for frame in result["timeline"]] == [False, True, False]
    assert [frame["bpm"] for frame in result["timeline"]] == [100.0, 130.0, 130.0]


def test_project_requires_real_files_and_writes_manifest_atomically(tmp_path):
    source = tmp_path / "source.json"
    source.write_text("{}", encoding="utf-8")
    output = tmp_path / "project"
    manifest = project.build_project(str(output), pitch=str(source), vocals=str(tmp_path / "missing"))
    assert manifest["files"] == {"pitch": str(output / "pitch.json")}
    assert manifest["complete"] is False
    assert json_io.load_json(output / "manifest.json") == manifest


def test_probe_chooses_audio_stream_and_tolerates_bad_numbers(monkeypatch):
    payload = {
        "format": {"duration": "bad", "format_name": "wav", "bit_rate": "1000"},
        "streams": [
            {"codec_type": "video", "codec_name": "x"},
            {"codec_type": "audio", "codec_name": "pcm", "sample_rate": "bad", "channels": "2"},
        ],
    }
    monkeypatch.setattr(
        probe.subprocess,
        "run",
        lambda *a, **k: types.SimpleNamespace(stdout=json.dumps(payload)),
    )
    result = probe.probe_file("song.wav")
    assert result["duration_sec"] == 0.0
    assert result["codec"] == "pcm"
    assert result["sample_rate_hz"] == 0
    assert result["channels"] == 2
    assert result["bit_rate_bps"] == 1000


def test_separate_rejects_invalid_shift_text(monkeypatch, tmp_path):
    monkeypatch.setenv("SONGAPP_DEMUCS_SHIFTS", "invalid")
    with pytest.raises(ValueError, match="Demucs shifts"):
        separate.separate("song.wav", str(tmp_path))


def test_mix_stems_rejects_vocals_only_result():
    with pytest.raises(RuntimeError, match="instrumental"):
        separate._mix_stems({"vocals": object()})


def test_run_all_helpers_are_idempotent_and_cleanup_normalization_temp(monkeypatch, tmp_path):
    run_all = importlib.import_module("run_all")
    paths = run_all.PipelinePaths.create(tmp_path)
    paths.separated.mkdir(parents=True)
    for path in (paths.vocals, paths.instrumental):
        path.write_bytes(b"old")

    calls = []
    def normalize(source, destination):
        calls.append((source, destination))
        Path(destination).write_bytes(b"new")

    monkeypatch.setattr(run_all, "normalize_loudness", normalize)
    run_all._normalize_stems((paths.vocals, paths.instrumental), paths)
    run_all._normalize_stems((paths.vocals, paths.instrumental), paths)
    assert len(calls) == 2
    assert paths.vocals.read_bytes() == b"new"
    assert paths.instrumental.read_bytes() == b"new"
    assert list(paths.separated.glob("*.tmp.wav")) == []


def test_run_all_cached_json_does_not_recompute(tmp_path):
    run_all = importlib.import_module("run_all")
    path = tmp_path / "cached.json"
    json_io.save_json({"cached": True}, path)
    called = False
    def builder():
        nonlocal called
        called = True
        return {"cached": False}
    assert run_all._cached_json(path, "step", builder) == {"cached": True}
    assert called is False


def test_run_all_reference_invalidation_is_exact(tmp_path):
    run_all = importlib.import_module("run_all")
    paths = run_all.PipelinePaths.create(tmp_path)
    for name in (*run_all.DERIVED_REFERENCE_FILES, "music.json"):
        paths.file(name).write_text("x", encoding="utf-8")
    run_all._invalidate_reference_dependents(paths)
    assert all(not paths.file(name).exists() for name in run_all.DERIVED_REFERENCE_FILES)
    assert paths.file("music.json").exists()


def test_game_config_validation(tmp_path):
    from src.analyze import game_onnx

    json_io.save_json({"samplerate": 0}, tmp_path / "config.json")
    with pytest.raises(ValueError, match="samplerate"):
        game_onnx._load_config(tmp_path)
    json_io.save_json({"samplerate": 16000, "languages": []}, tmp_path / "config.json")
    with pytest.raises(ValueError, match="languages"):
        game_onnx._load_config(tmp_path)


def test_game_session_loader_reports_all_missing_models(tmp_path):
    from src.analyze import game_onnx

    with pytest.raises(FileNotFoundError) as error:
        game_onnx._load_sessions(tmp_path, ["CPUExecutionProvider"])
    message = str(error.value)
    assert "encoder.onnx" in message
    assert "estimator.onnx" in message


def test_sync_existing_visible_text_rebuilds_nested_words(monkeypatch, tmp_path):
    from src.lyrics import sync

    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("Новый красивый текст", encoding="utf-8")
    monkeypatch.setattr(
        sync,
        "_sync_raw",
        lambda *args: [
            {
                "text": "old words",
                "start": 0.0,
                "end": 3.0,
                "words": [
                    {"word": "old", "start": 0.0, "end": 1.0},
                    {"word": "words", "start": 1.0, "end": 3.0},
                ],
            }
        ],
    )
    result = sync.sync_existing_lyrics_with_whisper("audio.wav", str(lyrics))
    assert result[0]["text"] == "Новый красивый текст"
    assert [word["word"] for word in result[0]["words"]] == ["Новый", "красивый", "текст"]
    assert result[0]["words"][0]["start"] == 0.0
    assert result[0]["words"][-1]["end"] == 3.0


def test_vocal_rejects_non_positive_frame_step():
    from src.analyze import vocal

    with pytest.raises(ValueError, match="positive"):
        vocal.analyze_vocal("unused.wav", frame_step_sec=0)


def test_run_all_mocked_end_to_end(monkeypatch, tmp_path):
    run_all = importlib.import_module("run_all")
    source = tmp_path / "song.mp3"
    source.write_bytes(b"audio")
    output = tmp_path / "Song" / "song"

    monkeypatch.setattr(run_all, "probe_file", lambda path: {"duration_sec": 10})
    monkeypatch.setattr(run_all, "convert", lambda src, dst: Path(dst).write_bytes(b"wav"))

    def fake_separate(src, out):
        directory = Path(out)
        directory.mkdir(parents=True, exist_ok=True)
        vocals = directory / "vocals.wav"
        instrumental = directory / "instrumental.wav"
        vocals.write_bytes(b"vocals")
        instrumental.write_bytes(b"music")
        return {"vocals": str(vocals), "instrumental": str(instrumental)}

    monkeypatch.setattr(run_all, "separate", fake_separate)
    monkeypatch.setattr(
        run_all,
        "normalize_loudness",
        lambda src, dst: Path(dst).write_bytes(Path(src).read_bytes()),
    )
    monkeypatch.setattr(
        run_all,
        "analyze_music",
        lambda path: {"bpm": 120, "first_beat_sec": 0, "key": "C major"},
    )
    monkeypatch.setattr(run_all, "_use_game_melody_engine", lambda: False)
    frames = [{"time": 0.0, "f0_hz": 261.63, "loudness_db": -10}]
    monkeypatch.setattr(run_all, "analyze_vocal", lambda *a, **k: frames)
    monkeypatch.setattr(run_all, "extract_game_reference", lambda *a, **k: None)
    notes = [{"note": "C4", "start": 0.0, "end": 1.0, "duration": 1.0}]
    monkeypatch.setattr(run_all, "build_reference", lambda *a, **k: notes)
    monkeypatch.setattr(run_all, "analyze_breath", lambda *a, **k: {"pauses": []})
    monkeypatch.setattr(run_all, "get_lyrics", lambda *a, **k: ("hello", "mock"))
    lyrics = [{"text": "hello", "start": 0.0, "end": 1.0, "words": []}]
    monkeypatch.setattr(run_all, "sync_existing_lyrics_with_whisper", lambda *a, **k: lyrics)
    for name in (
        "fill_gaps_during_active_singing",
        "split_notes_by_syllables",
        "align_note_boundaries_to_words",
        "trim_quiet_unanchored_note_tails",
        "filter_unanchored_long_notes",
    ):
        monkeypatch.setattr(run_all, name, lambda current, *a, **k: current)
    monkeypatch.setattr(run_all, "build_song_map", lambda *a: {"timeline": []})
    monkeypatch.setattr(run_all, "build_difficulty_map", lambda *a: [])
    monkeypatch.setattr(run_all, "segment_structure", lambda path: [])
    monkeypatch.setattr(run_all, "quantize_notes", lambda *a, **k: notes)

    class Midi:
        def write(self, path):
            Path(path).write_bytes(b"midi")

    monkeypatch.setattr(run_all, "build_midi", lambda *a, **k: Midi())
    monkeypatch.setattr(run_all, "add_tempo_and_key", lambda *a, **k: None)
    monkeypatch.setattr(run_all, "build_project", lambda *a, **k: {"complete": True})
    monkeypatch.setattr(run_all, "build_report", lambda path: "# report")

    result = run_all.run(str(source), str(output), whisper_model="tiny", language="en")
    assert result == {"complete": True}
    assert json_io.load_json(output / "songInfo.json") == {"duration_sec": 10}
    assert json_io.load_json(output / "reference.json") == notes
    assert (output / "melody.mid").read_bytes() == b"midi"
    assert (output / "report.md").read_text(encoding="utf-8") == "# report"
