import hashlib
from types import SimpleNamespace

from AI import pipeline
from AI.cache import StageCache


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_trusted_optimized_flac_restore_is_disabled(monkeypatch, tmp_path):
    """Caching is disabled for processing/reprocessing: even a matching,
    trusted optimized-FLAC provenance record must not skip separation."""
    output = tmp_path / "song"
    separated = output / "separated"
    separated.mkdir(parents=True)
    vocals_wav = separated / "vocals.wav"
    instrumental_wav = separated / "instrumental.wav"
    vocals_wav.write_bytes(b"old vocals wav")
    instrumental_wav.write_bytes(b"old instrumental wav")
    cache = StageCache(output / ".ai-cache")
    key = cache.key("separation", {"source": "same", "engine": "same"})
    cache.commit("separation", key, [vocals_wav, instrumental_wav])
    vocals_wav.unlink()
    instrumental_wav.unlink()

    vocals_flac = separated / "vocals.flac"
    instrumental_flac = separated / "instrumental.flac"
    vocals_flac.write_bytes(b"trusted vocals flac")
    instrumental_flac.write_bytes(b"trusted instrumental flac")
    pipeline.write_json_atomic(
        output / "manifest.json",
        {
            "outputs": {
                "vocals": "separated/vocals.flac",
                "instrumental": "separated/instrumental.flac",
            },
            "integrity": {
                "vocals": {"size": vocals_flac.stat().st_size, "sha256": _sha(vocals_flac)},
                "instrumental": {
                    "size": instrumental_flac.stat().st_size,
                    "sha256": _sha(instrumental_flac),
                },
            },
        },
    )
    monkeypatch.setattr(
        pipeline,
        "decode_audio",
        lambda source, target, _rate: target.write_bytes(b"restored:" + source.read_bytes()),
    )
    monkeypatch.setattr(pipeline, "validate_audio", lambda _path: None)
    core = pipeline.KaraokePipeline(SimpleNamespace(sample_rate=44100), SimpleNamespace())

    assert not core._restore_optimized_separation_cache(
        cache, key, output, vocals_wav, instrumental_wav
    )
    assert not vocals_wav.is_file() and not instrumental_wav.is_file()
    assert not cache.hit("separation", key, [vocals_wav, instrumental_wav])


def test_optimized_flac_restore_rejects_bad_integrity(monkeypatch, tmp_path):
    output = tmp_path / "song"
    separated = output / "separated"
    separated.mkdir(parents=True)
    vocals_wav = separated / "vocals.wav"
    instrumental_wav = separated / "instrumental.wav"
    vocals_wav.write_bytes(b"old")
    instrumental_wav.write_bytes(b"old2")
    cache = StageCache(output / ".ai-cache")
    key = "key"
    cache.commit("separation", key, [vocals_wav, instrumental_wav])
    vocals_wav.unlink()
    instrumental_wav.unlink()
    vocals_flac = separated / "vocals.flac"
    instrumental_flac = separated / "instrumental.flac"
    vocals_flac.write_bytes(b"v")
    instrumental_flac.write_bytes(b"i")
    pipeline.write_json_atomic(
        output / "manifest.json",
        {
            "outputs": {
                "vocals": "separated/vocals.flac",
                "instrumental": "separated/instrumental.flac",
            },
            "integrity": {
                "vocals": {"size": 1, "sha256": "wrong"},
                "instrumental": {"size": 1, "sha256": _sha(instrumental_flac)},
            },
        },
    )
    def decode(*_args):
        raise AssertionError("must not decode")

    monkeypatch.setattr(pipeline, "decode_audio", decode)
    core = pipeline.KaraokePipeline(SimpleNamespace(sample_rate=44100), SimpleNamespace())
    assert not core._restore_optimized_separation_cache(
        cache, key, output, vocals_wav, instrumental_wav
    )


def test_full_reprocess_no_longer_restores_optimized_stems(monkeypatch, tmp_path):
    """A reprocess run must not skip separation via the optimized-FLAC path
    either, now that caching is disabled end-to-end."""
    from app.services import pipeline_service

    library = tmp_path / "library"
    output = library / "song"
    separated = output / "separated"
    separated.mkdir(parents=True)
    vocals_wav = separated / "vocals.wav"
    instrumental_wav = separated / "instrumental.wav"
    vocals_wav.write_bytes(b"old vocals wav")
    instrumental_wav.write_bytes(b"old instrumental wav")
    cache = StageCache(output / ".ai-cache")
    key = cache.key("separation", {"source": "same", "engine": "same"})
    cache.commit("separation", key, [vocals_wav, instrumental_wav])
    vocals_wav.unlink()
    instrumental_wav.unlink()

    vocals_flac = separated / "vocals.flac"
    instrumental_flac = separated / "instrumental.flac"
    vocals_flac.write_bytes(b"trusted vocals flac")
    instrumental_flac.write_bytes(b"trusted instrumental flac")
    pipeline.write_json_atomic(
        output / "manifest.json",
        {
            "outputs": {
                "vocals": "separated/vocals.flac",
                "instrumental": "separated/instrumental.flac",
            },
            "integrity": {
                "vocals": {"size": vocals_flac.stat().st_size, "sha256": _sha(vocals_flac)},
                "instrumental": {
                    "size": instrumental_flac.stat().st_size,
                    "sha256": _sha(instrumental_flac),
                },
            },
        },
    )
    monkeypatch.setattr(
        pipeline,
        "decode_audio",
        lambda source, target, _rate: target.write_bytes(b"restored:" + source.read_bytes()),
    )
    monkeypatch.setattr(pipeline, "validate_audio", lambda _path: None)
    database = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(pipeline_service, "SessionLocal", lambda: database)
    monkeypatch.setattr(pipeline_service.repositories, "get_song", lambda _db, _song_id: SimpleNamespace())
    monkeypatch.setattr(pipeline_service.song_service, "resolve_output_dir", lambda _song: output)
    monkeypatch.setattr(pipeline_service.config, "SONG_OUTPUT_DIR", library)

    restored = []

    def run_job(_song_id):
        # This is the production ordering point immediately after _force_midi_rebuild().
        assert (output / "manifest.json").is_file()
        core = pipeline.KaraokePipeline(SimpleNamespace(sample_rate=44100), SimpleNamespace())
        restored.append(
            core._restore_optimized_separation_cache(
                StageCache(output / ".ai-cache"), key, output, vocals_wav, instrumental_wav
            )
        )

    monkeypatch.setattr(pipeline_service, "_run_job", run_job)
    pipeline_service._run_reprocessing("song")

    assert restored == [False]
    assert not vocals_wav.is_file() and not instrumental_wav.is_file()
