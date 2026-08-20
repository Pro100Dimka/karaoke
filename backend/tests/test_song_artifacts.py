from app.services import song_artifacts


def test_runtime_artifact_resolution_uses_only_root_contract(tmp_path):
    instrumental = tmp_path / "instrumental.flac"
    vocals = tmp_path / "vocals.flac"
    lyrics = tmp_path / "lyricsSync.json"
    instrumental.write_bytes(b"music")
    vocals.write_bytes(b"voice")
    lyrics.write_text("{}", encoding="utf-8")

    assert song_artifacts.processing_outputs(tmp_path) == {
        "instrumental": "instrumental.flac",
        "vocals": "vocals.flac",
        "lyricsSync": "lyricsSync.json",
    }
    assert song_artifacts.resolve_audio_artifact(tmp_path, "instrumental") == instrumental
    assert song_artifacts.resolve_audio_artifact(tmp_path, "vocals") == vocals


def test_runtime_artifact_resolution_has_no_legacy_fallback(tmp_path):
    separated = tmp_path / "separated"
    separated.mkdir()
    (separated / "instrumental.flac").write_bytes(b"stale")

    assert song_artifacts.processing_outputs(tmp_path) == {}
    assert song_artifacts.resolve_audio_artifact(tmp_path, "instrumental") is None


def test_portable_output_policy_rejects_local_namespaces():
    assert not song_artifacts.is_portable_output_path("recordings/take.wav")
    assert not song_artifacts.is_portable_output_path("logs/pipeline.log")
    assert not song_artifacts.is_portable_output_path(".ai-cache/separation.json")
    assert song_artifacts.is_portable_output_path("instrumental.flac")
