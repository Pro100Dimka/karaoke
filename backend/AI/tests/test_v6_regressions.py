from __future__ import annotations

import os
import sys
import types
from pathlib import Path

import numpy as np

import run_all
from src.analyze import vocal
from src.common.json_io import save_json
from src.preprocessing import separate


def test_fingerprint_ignores_mtime_for_unchanged_content(tmp_path):
    path = tmp_path / "audio.bin"
    path.write_bytes(b"same content")
    first = run_all._file_sha256(path)
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10_000_000))
    assert run_all._file_sha256(path) == first


def test_reference_invalidation_preserves_expensive_structure(tmp_path):
    paths = run_all.PipelinePaths.create(tmp_path)
    paths.file("structure.json").write_text("[]", encoding="utf-8")
    for name in run_all.DERIVED_REFERENCE_FILES:
        paths.file(name).write_text("x", encoding="utf-8")
    run_all._invalidate_reference_dependents(paths)
    assert paths.file("structure.json").exists()
    assert all(not paths.file(name).exists() for name in run_all.DERIVED_REFERENCE_FILES)


def test_demucs_shape_failure_retries_safe_segment(monkeypatch):
    monkeypatch.setenv("SONGAPP_DEMUCS_SEGMENT", "10")
    created = []

    class Separator:
        samplerate = 44100

        def __init__(self, **kwargs):
            self.segment = kwargs["segment"]
            created.append(self.segment)

        def separate_audio_file(self, path):
            if self.segment == 10:
                raise RuntimeError("shape '[1, 4, -1, 343980]' is invalid")
            return None, {"vocals": object(), "other": object()}

    instance, stems = separate._separate_with_retry(
        Separator,
        "song.wav",
        model="htdemucs",
        device="cpu",
        shifts=1,
    )
    assert created == [10, separate.DEFAULT_SEGMENT]
    assert instance.segment == separate.DEFAULT_SEGMENT
    assert "vocals" in stems


def test_stabilizer_corrects_isolated_octave_but_keeps_real_note_change():
    stable = np.array([220.0, 220.0, 440.0, 220.0, 220.0])
    confidence = np.array([0.9, 0.9, 0.2, 0.9, 0.9])
    corrected = vocal._stabilize_f0(stable, confidence)
    assert abs(corrected[2] - 220.0) < 2.0

    melody = np.array([220.0, 220.0, 246.94, 246.94, 246.94])
    preserved = vocal._stabilize_f0(melody, np.full(5, 0.9))
    assert preserved[-1] > 240.0


def test_torchcrepe_chunk_timeline_has_no_duplicate_boundaries(monkeypatch):
    class Tensor:
        def __init__(self, values):
            self.values = np.asarray(values, dtype=np.float32)

        def squeeze(self, axis):
            return self

        def detach(self):
            return self

        def float(self):
            return self

        def cpu(self):
            return self

        def numpy(self):
            return self.values

    fake_torch = types.SimpleNamespace(
        cuda=types.SimpleNamespace(is_available=lambda: False),
        backends=types.SimpleNamespace(
            cuda=types.SimpleNamespace(matmul=types.SimpleNamespace(allow_tf32=False)),
            cudnn=types.SimpleNamespace(allow_tf32=False, benchmark=False),
        ),
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)

    def predict(chunk, **kwargs):
        hop = kwargs["hop_length"]
        count = 1 + len(chunk) // hop
        return Tensor(np.full(count, 220.0)), Tensor(np.full(count, 0.9))

    monkeypatch.setattr(vocal, "_predict_torchcrepe_chunk", predict)
    monkeypatch.setattr(
        vocal,
        "_rms_track",
        lambda y, sr, hop: (
            np.arange(1 + len(y) // hop) * hop / sr,
            np.full(1 + len(y) // hop, -12.0),
        ),
    )
    y = np.ones(45 * 16_000, dtype=np.float32)
    times, f0, voiced, confidence, loudness = vocal._analyze_torchcrepe(
        y,
        16_000,
        0.015,
        "C2",
        "C6",
        model_capacity="tiny",
    )
    assert len(times) == len(f0) == len(voiced) == len(confidence) == len(loudness)
    assert np.all(np.diff(times) > 0)
    assert times[0] == 0.0
    assert times[-1] <= 45.0 + 1e-6


def test_demucs_setting_change_invalidates_stems_but_not_song_wav(tmp_path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"audio")
    paths = run_all.PipelinePaths.create(tmp_path / "out")
    paths.separated.mkdir(parents=True)
    paths.vocals.write_bytes(b"v")
    paths.instrumental.write_bytes(b"i")
    paths.file("song.wav").write_bytes(b"wav")
    previous = run_all._pipeline_state(str(source), "medium", "ru")
    previous["demucs_segment"] = "10"
    save_json(previous, paths.file(".pipeline-state.json"))
    monkeypatch.setenv("SONGAPP_DEMUCS_SEGMENT", "7")

    run_all._ensure_pipeline_state(str(source), paths, "medium", "ru")
    assert not paths.vocals.exists()
    assert not paths.instrumental.exists()
    assert paths.file("song.wav").exists()


def test_full_pipeline_second_run_reuses_heavy_cache(tmp_path, monkeypatch):
    source = tmp_path / "song.mp3"
    source.write_bytes(b"source audio")
    output = tmp_path / "song-output"
    calls: dict[str, int] = {}

    def counted(name, value):
        def function(*args, **kwargs):
            calls[name] = calls.get(name, 0) + 1
            return value(*args, **kwargs) if callable(value) else value
        return function

    monkeypatch.setattr(run_all, "probe_file", counted("probe", {"duration_sec": 10}))

    def convert(source_path, target_path):
        Path(target_path).write_bytes(b"w" * 100)
    monkeypatch.setattr(run_all, "convert", counted("convert", convert))

    def separate_audio(source_path, out_dir):
        directory = Path(out_dir)
        directory.mkdir(parents=True, exist_ok=True)
        vocals = directory / "vocals.wav"
        instrumental = directory / "instrumental.wav"
        vocals.write_bytes(b"v" * 100)
        instrumental.write_bytes(b"i" * 100)
        return {"vocals": str(vocals), "instrumental": str(instrumental)}
    monkeypatch.setattr(run_all, "separate", counted("separate", separate_audio))
    monkeypatch.setattr(run_all, "analyze_music", counted("music", {"bpm": 120, "first_beat_sec": 0}))
    frames = [{"time": 0.0, "f0_hz": 220.0, "voiced": True, "confidence": 0.9, "loudness_db": -10}]
    monkeypatch.setattr(run_all, "analyze_vocal", counted("pitch", frames))
    monkeypatch.setattr(run_all, "extract_game_reference", counted("game", None))
    notes = [{"note": "A3", "start": 0.0, "end": 1.0, "duration": 1.0, "confidence": 0.9}]
    monkeypatch.setattr(run_all, "build_reference", counted("reference", notes))
    monkeypatch.setattr(run_all, "analyze_breath", counted("breath", {"pauses": []}))
    monkeypatch.setattr(run_all, "get_lyrics", counted("lyrics", ("hello", "mock")))
    lyric_sync = [{"text": "hello", "start": 0.0, "end": 1.0, "words": []}]
    monkeypatch.setattr(run_all, "sync_existing_lyrics_with_whisper", counted("sync", lyric_sync))
    for name in (
        "fill_gaps_during_active_singing",
        "split_notes_by_syllables",
        "align_note_boundaries_to_words",
        "trim_quiet_unanchored_note_tails",
        "filter_unanchored_long_notes",
    ):
        monkeypatch.setattr(run_all, name, lambda current, *args, **kwargs: current)
    monkeypatch.setattr(run_all, "build_song_map", counted("song_map", {"timeline": []}))
    monkeypatch.setattr(run_all, "build_difficulty_map", counted("difficulty", []))
    monkeypatch.setattr(run_all, "segment_structure", counted("structure", []))
    monkeypatch.setattr(run_all, "quantize_notes", lambda current, *args, **kwargs: current)

    class Midi:
        def write(self, path):
            Path(path).write_bytes(b"midi")

    monkeypatch.setattr(run_all, "build_midi", counted("midi", Midi()))
    monkeypatch.setattr(run_all, "add_tempo_and_key", lambda *args, **kwargs: None)
    monkeypatch.setattr(run_all, "build_project", lambda *args, **kwargs: {"complete": True})
    monkeypatch.setattr(run_all, "build_report", lambda *args, **kwargs: "# report")

    run_all.run(str(source), str(output), whisper_model="tiny", language="en")
    first_calls = dict(calls)
    run_all.run(str(source), str(output), whisper_model="tiny", language="en")

    for stage in ("probe", "convert", "separate", "music", "pitch", "reference", "breath", "lyrics", "sync", "song_map", "structure", "midi"):
        assert calls.get(stage, 0) == first_calls.get(stage, 0), stage
