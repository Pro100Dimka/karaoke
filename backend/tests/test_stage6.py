from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

from app.services import cache_service, pipeline_service


def test_generated_metadata_populates_only_missing_values(tmp_path: Path):
    (tmp_path / "music.json").write_text('{"key":"Dm","bpm":123}', encoding="utf-8")
    (tmp_path / "reference.json").write_text(
        '[{"midi":48},{"midi":72},{"midi":null}]', encoding="utf-8"
    )
    song = SimpleNamespace(
        key_override=None,
        tempo_override=110,
        note_range_min=None,
        note_range_max=70,
    )
    pipeline_service._apply_generated_metadata(song, tmp_path)
    assert song.key_override == "Dm"
    assert song.tempo_override == 110
    assert song.note_range_min == 48
    assert song.note_range_max == 70


def test_generated_metadata_ignores_corrupt_optional_files(tmp_path: Path):
    (tmp_path / "music.json").write_text("{broken", encoding="utf-8")
    (tmp_path / "reference.json").write_text('[{"midi":"bad"}]', encoding="utf-8")
    song = SimpleNamespace(
        key_override=None,
        tempo_override=None,
        note_range_min=None,
        note_range_max=None,
    )
    pipeline_service._apply_generated_metadata(song, tmp_path)
    assert vars(song) == {
        "key_override": None,
        "tempo_override": None,
        "note_range_min": None,
        "note_range_max": None,
    }


def test_convert_heavy_wavs_preserves_source_when_encoder_fails(tmp_path: Path, monkeypatch):
    wav = tmp_path / "song.wav"
    wav.write_bytes(b"audio")
    monkeypatch.setattr(
        cache_service,
        "_encode_mp3",
        lambda *args: (_ for _ in ()).throw(subprocess.CalledProcessError(1, "ffmpeg")),
    )
    actions: list[str] = []
    assert cache_service._convert_heavy_wavs(tmp_path, actions) == 0
    assert wav.exists()
    assert actions == []


def test_remove_intermediate_directories_counts_removed_bytes(tmp_path: Path):
    temporary = tmp_path / "tmp"
    temporary.mkdir()
    (temporary / "data.bin").write_bytes(b"12345")
    actions: list[str] = []
    assert cache_service._remove_intermediate_directories(tmp_path, actions) == 5
    assert not temporary.exists()
    assert actions == ["удалена временная папка tmp/"]


def test_optimization_result_does_not_share_mutable_actions():
    first = cache_service._optimization_result("one")
    second = cache_service._optimization_result("two")
    first["actions"].append("changed")
    assert second["actions"] == []
