from app.services import song_artifacts


def test_song_artifact_manifest_and_fallback_resolution(tmp_path):
    separated = tmp_path / "separated"; separated.mkdir(); flac = separated / "instrumental.flac"; flac.write_bytes(b"audio")
    (tmp_path / "manifest.json").write_text(
        '{"outputs":{"instrumental":"separated/instrumental.flac"}}', encoding="utf-8"
    )
    assert (song_artifacts.processing_outputs(tmp_path)['instrumental'] == 'separated/instrumental.flac') and (song_artifacts.resolve_manifest_output(tmp_path, 'instrumental') == flac.resolve()) and (song_artifacts.resolve_audio_artifact(tmp_path, 'instrumental') == flac.resolve())


def test_song_artifact_rejects_unsafe_manifest_and_uses_legacy_fallback(tmp_path):
    (tmp_path / "manifest.json").write_text(
        '{"outputs":{"instrumental":"../escape.wav","bad":"C:\\\\evil.wav"}}', encoding="utf-8"
    )
    legacy = tmp_path / "instrumental.wav"; legacy.write_bytes(b"legacy"); assert (song_artifacts.processing_outputs(tmp_path) == {}) and (song_artifacts.resolve_manifest_output(tmp_path, 'instrumental') is None) and (song_artifacts.resolve_audio_artifact(tmp_path, 'instrumental') is None)


def test_modern_manifest_missing_target_does_not_fall_back_to_stale_sidecar(tmp_path):
    separated = tmp_path / "separated"; separated.mkdir(); stale = separated / "instrumental.flac"; stale.write_bytes(b"stale")
    (tmp_path / "manifest.json").write_text(
        '{"outputs":{"instrumental":"separated/instrumental.wav"}}', encoding="utf-8"
    )
    assert song_artifacts.resolve_audio_artifact(tmp_path, "instrumental") is None


def test_portable_output_policy_rejects_user_local_namespaces(): assert (not song_artifacts.is_portable_output_path('recordings/take.wav')) and (not song_artifacts.is_portable_output_path('logs/pipeline.log')) and (not song_artifacts.is_portable_output_path('.ai-cache/separation.json')) and (song_artifacts.is_portable_output_path('separated/instrumental.flac'))


def test_processing_outputs_without_manifest_is_empty(tmp_path): assert song_artifacts.processing_outputs(tmp_path) == {}
