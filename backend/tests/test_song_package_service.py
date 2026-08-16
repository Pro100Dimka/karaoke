import contextlib
import hashlib
import io
import json
import stat
import wave
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models
from app.services import cache_service, song_package_service
from database import Base



def wav_bytes(frames=800, rate=8000):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


def revision_for_outputs(outputs, manifest=None, source=None, source_name="song.wav"):
    manifest = manifest or {}
    source = wav_bytes() if source is None else source
    pipeline_manifest = json.loads(outputs["manifest.json"])
    instrumental = pipeline_manifest["outputs"]["instrumental"]
    artifacts = {
        relative: hashlib.sha256(outputs[relative]).hexdigest()
        for relative in (*song_package_service.REVISION_ARTIFACTS, instrumental)
    }
    mode = str(manifest.get("karaoke_mode") or "")
    runtime = song_package_service._canonical_runtime_state(
        {field: manifest.get(field) for field in song_package_service.REVISION_RUNTIME_FIELDS}, mode
    )
    entity = song_package_service._canonical_entity_state(
        {field: manifest.get(field) for field in song_package_service.REVISION_ENTITY_FIELDS},
        source_name=str(manifest.get("original_filename") or source_name),
    )
    return song_package_service._hash_revision_payload({
        "revision_schema": song_package_service.REVISION_SCHEMA_VERSION,
        "artifacts": artifacts,
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "runtime": runtime,
        "entity": entity,
        "processing_build": pipeline_manifest.get("build") or pipeline_manifest.get("version"),
    })


def valid_outputs():
    return {
        "music.json": b"{}",
        "lyricsSync.json": b'{"words":[]}',
        "reference.json": b'{"notes":[]}',
        "songMap.json": b'{"words":[],"syllables":[],"notes":[]}',
        "separated/instrumental.wav": wav_bytes(),
        "manifest.json": b'{"version":"test","outputs":{"instrumental":"separated/instrumental.wav","music":"music.json","lyricsSync":"lyricsSync.json","reference":"reference.json","songMap":"songMap.json"}}',
    }


def write_valid_output_dir(output):
    for relative, payload in valid_outputs().items():
        path = output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def song(source, output):
    return models.Song(
        id="song-id",
        title="Song",
        artist="Artist",
        original_filename="song.wav",
        source_path=str(source),
        slug="artist-song",
        output_dir=str(output),
        status=models.SongStatus.DONE,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def test_manifest_and_package_build_filter_private_artifacts(monkeypatch, tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    (output / "pipeline.log").write_text("private", encoding="utf-8")
    (output / ".optimization-journal.json").write_text('{"created":["../victim"]}', encoding="utf-8")
    (output / ".ai-cache").mkdir()
    (output / ".ai-cache/key.json").write_text("private", encoding="utf-8")
    (output / "take-private.wav").write_bytes(b"private")
    (output / "logs").mkdir()
    (output / "logs/x").write_text("private", encoding="utf-8")
    (output / "directory").mkdir()
    symlink = output / "link"
    with contextlib.suppress(OSError):
        symlink.symlink_to(tmp_path / "outside")
    current = song(source, output)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    package = song_package_service.build_package(current)
    try:
        with zipfile.ZipFile(package) as archive:
            names = set(archive.namelist())
            assert "manifest.json" in names and "source/source.wav" in names
            assert "output/pipeline.log" not in names and "output/take-private.wav" not in names
            assert "output/.optimization-journal.json" not in names
            assert not any(name.startswith("output/.ai-cache/") for name in names)
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["id"] == "song-id"
            assert manifest["package_schema_version"] == song_package_service.PACKAGE_SCHEMA_VERSION
            assert manifest["karaoke_mode"] == "instrumental"
            assert manifest["content_revision"].startswith("sha256:")
    finally:
        package.unlink()


def test_package_build_requires_complete_files_and_cleans_archive_failure(monkeypatch, tmp_path):
    output = tmp_path / "output"
    source = tmp_path / "missing.wav"
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    with pytest.raises(ValueError, match="incomplete"):
        song_package_service.build_package(song(source, output))
    output.mkdir()
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        song_package_service.zipfile,
        "ZipFile",
        Mock(side_effect=OSError("zip failed")),
    )
    with pytest.raises(OSError, match="zip failed"):
        song_package_service.build_package(song(source, output))
    assert not list(tmp_path.glob("karaoke-song-*.zip"))


@pytest.mark.parametrize(
    "name",
    ["", "../escape", "/absolute", "C:/drive", "back\\slash", "nul\0name"],
)
def test_member_path_rejects_unsafe_names(name):
    with pytest.raises(ValueError, match="unsafe"):
        song_package_service._member_path(SimpleNamespace(filename=name))
    assert song_package_service._member_path(zipfile.ZipInfo("output/music.json")).as_posix() == (
        "output/music.json"
    )


def fake_member(name, *, size=1, compressed=1, mode=0, flags=0):
    member = zipfile.ZipInfo(name)
    member.file_size = size
    member.compress_size = compressed
    member.external_attr = mode << 16
    member.flag_bits = flags
    return member


def test_safe_members_enforces_limits_links_encryption_ratio_and_duplicates(monkeypatch):
    archive = Mock()
    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_FILES", 1)
    archive.infolist.return_value = [fake_member("a"), fake_member("b")]
    with pytest.raises(ValueError, match="too many"):
        song_package_service._safe_members(archive)

    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_FILES", 500)
    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_BYTES", 1)
    archive.infolist.return_value = [fake_member("a", size=2)]
    with pytest.raises(ValueError, match="too large"):
        song_package_service._safe_members(archive)

    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_BYTES", 2 * 1024**3)
    cases = [
        (fake_member("a", mode=stat.S_IFLNK), "symbolic"),
        (fake_member("a", flags=1), "Encrypted"),
        (fake_member("a", size=2 * 1024**2, compressed=1), "suspiciously"),
    ]
    for member, message in cases:
        archive.infolist.return_value = [member]
        with pytest.raises(ValueError, match=message):
            song_package_service._safe_members(archive)
    archive.infolist.return_value = [fake_member("a"), fake_member("a")]
    with pytest.raises(ValueError, match="duplicate"):
        song_package_service._safe_members(archive)
    archive.infolist.return_value = [fake_member("a")]
    assert song_package_service._safe_members(archive) == archive.infolist.return_value




@pytest.mark.parametrize(
    "name",
    [
        "output/.optimization-journal.json",
        "output/.optimization-journal.invalid.json",
        "output/.pipeline.lock",
        "output/.ai-cache/separation.json",
    ],
)
def test_package_rejects_internal_transaction_metadata(name):
    archive = Mock()
    archive.infolist.return_value = [fake_member(name)]
    with pytest.raises(ValueError, match="internal transaction"):
        song_package_service._safe_members(archive)


def test_manifest_identity_and_source_validation(tmp_path):
    package = tmp_path / "package.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", '{"id":"id","title":"Song"}')
        archive.writestr("source/song.wav", b"audio")
    with zipfile.ZipFile(package) as archive:
        manifest = song_package_service._read_manifest(archive)
        assert song_package_service._package_identity(manifest) == ("id", "Song")
        assert song_package_service._source_member(archive.infolist()).filename == "source/song.wav"

    for manifest in ({}, {"id": "id"}, {"title": "Song"}):
        with pytest.raises(ValueError, match="no song"):
            song_package_service._package_identity(manifest)
    with pytest.raises(ValueError, match="one source"):
        song_package_service._source_member([])
    with pytest.raises(ValueError, match="format"):
        song_package_service._source_member([fake_member("source/song.exe")])


def test_manifest_rejects_missing_invalid_and_non_object_json(tmp_path):
    package = tmp_path / "bad.zip"
    for payload in (None, b"invalid", b"[]", b"\xff"):
        with zipfile.ZipFile(package, "w") as archive:
            if payload is not None:
                archive.writestr("manifest.json", payload)
        with zipfile.ZipFile(package) as archive, pytest.raises(ValueError, match="manifest"):
            song_package_service._read_manifest(archive)


def test_copy_extract_and_song_model(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("source/song.wav", b"source")
        archive.writestr("output/music.json", b"music")
        archive.writestr("output/", b"")
        archive.writestr("other/ignored", b"ignored")
    with zipfile.ZipFile(package) as archive:
        members = archive.infolist()
        song_package_service._copy_archive_member(archive, members[0], tmp_path / "copy.wav")
        song_package_service._extract_output(archive, members, tmp_path / "extract")
    assert (tmp_path / "copy.wav").read_bytes() == b"source"
    assert (tmp_path / "extract/music.json").read_bytes() == b"music"

    current = song_package_service._song_from_manifest(
        {"artist": "Artist", "show_lyrics": False},
        song_id="id",
        title="Song",
        slug="song",
        source_path=tmp_path / "source.wav",
        output_dir=tmp_path,
    )
    assert current.status == models.SongStatus.DONE
    assert current.show_lyrics is False and current.show_notes is True and current.optimized is True


def build_import_package(path, *, song_id="id", instrumental=None):
    outputs = valid_outputs()
    if instrumental is not None:
        outputs["separated/instrumental.wav"] = instrumental
    manifest = {
        "package_schema_version": song_package_service.PACKAGE_SCHEMA_VERSION,
        "karaoke_mode": "instrumental",
        "id": song_id,
        "title": "Song",
        "slug": "Song",
    }
    source = wav_bytes()
    manifest["content_revision"] = revision_for_outputs(outputs, manifest, source)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("source/song.wav", source)
        for relative, payload in outputs.items():
            archive.writestr(f"output/{relative}", payload)


def test_import_package_rejects_semantically_incomplete_package(tmp_path):
    package = tmp_path / "partial.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"package_schema_version": song_package_service.PACKAGE_SCHEMA_VERSION, "karaoke_mode": "instrumental", "content_revision": "sha256:" + "0" * 64, "id": "id", "title": "Song"}))
        archive.writestr("source/song.wav", b"source")
    with pytest.raises(ValueError, match="missing|incomplete"):
        song_package_service.import_package(Mock(), package)


def test_import_package_is_idempotent_atomic_and_recovers_failure(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    build_import_package(package)
    database = Mock()
    existing = object()
    get = Mock(return_value=existing)
    monkeypatch.setattr(song_package_service.song_service, "get_song", get)
    monkeypatch.setattr(song_package_service, "_same_revision", Mock(return_value=True))
    assert song_package_service.import_package(database, package) is existing
    monkeypatch.setattr(song_package_service, "_same_revision", song_package_service.__dict__["_same_revision"] if False else lambda *_: False)

    library = tmp_path / "library"
    cache = tmp_path / "cache"
    library.mkdir()
    cache.mkdir()
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)
    get.side_effect = [None, None]
    monkeypatch.setattr(
        song_package_service.song_service, "make_unique_slug", Mock(return_value="song")
    )
    monkeypatch.setattr(song_package_service, "commit_refresh", lambda _db, current: current)
    imported = song_package_service.import_package(database, package)
    assert imported.id == "id"
    assert (library / "song/source.wav").read_bytes().startswith(b"RIFF")
    assert (library / "song/music.json").is_file()

    package2 = tmp_path / "package2.zip"
    build_import_package(package2)
    get.side_effect = [None, None]
    monkeypatch.setattr(
        song_package_service,
        "commit_refresh",
        Mock(side_effect=RuntimeError("database failed")),
    )
    monkeypatch.setattr(
        song_package_service.song_service, "make_unique_slug", Mock(return_value="bad")
    )
    with pytest.raises(RuntimeError, match="database failed"):
        song_package_service.import_package(database, package2)
    database.rollback.assert_called()
    assert not (library / "bad").exists()


def test_import_package_rechecks_identity_inside_lock(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    build_import_package(package)
    database = Mock()
    winner = object()
    monkeypatch.setattr(
        song_package_service.song_service,
        "get_song",
        Mock(return_value=winner),
    )
    monkeypatch.setattr(song_package_service, "_same_revision", lambda current, _revision: current is winner)
    assert song_package_service.import_package(database, package) is winner


def test_semantic_package_rejects_fake_riff_audio(tmp_path):
    package = tmp_path / "fake-audio.zip"
    build_import_package(package, instrumental=b"RIFF" + b"0" * 64)
    with zipfile.ZipFile(package) as archive:
        members = song_package_service._safe_members(archive)
        manifest = song_package_service._read_manifest(archive)
        with pytest.raises(ValueError, match="invalid WAV"):
            song_package_service._validate_semantic_package(archive, members, manifest)


def test_content_revision_includes_shared_runtime_overrides(monkeypatch, tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    first = song(source, output)
    second = song(source, output)
    first.key_override, first.tempo_override, first.difficulty_override = "C", 120, "easy"
    first.show_lyrics, first.show_notes = True, True
    second.key_override, second.tempo_override, second.difficulty_override = "F#", 180, "hard"
    second.show_lyrics, second.show_notes = False, True
    assert song_package_service.compute_content_revision(first) != song_package_service.compute_content_revision(second)


def test_package_export_rejects_revision_changed_before_snapshot(monkeypatch, tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    current = song(source, output)
    expected = song_package_service.compute_content_revision(current)
    current.tempo_override = 177
    with pytest.raises(ValueError, match="revision changed"):
        song_package_service.build_package(current, expected_revision=expected)


def test_import_rejects_package_different_from_expected_room_revision(tmp_path):
    package = tmp_path / "package.zip"
    build_import_package(package)
    with pytest.raises(ValueError, match="expected room revision"):
        song_package_service.import_package(Mock(), package, expected_revision="sha256:" + "f" * 64)


def test_non_wav_source_requires_successful_media_probe(monkeypatch, tmp_path):
    package = tmp_path / "bad-source.zip"
    outputs = valid_outputs()
    manifest = {
        "package_schema_version": song_package_service.PACKAGE_SCHEMA_VERSION,
        "karaoke_mode": "instrumental", "id": "id", "title": "Song", "slug": "song",
    }
    source = b"definitely-not-mp3"
    manifest["content_revision"] = revision_for_outputs(outputs, manifest, source, "song.mp3")
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("source/song.mp3", source)
        for relative, payload in outputs.items():
            archive.writestr(f"output/{relative}", payload)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(song_package_service.subprocess, "run", Mock(return_value=SimpleNamespace(returncode=1, stdout="", stderr="bad")))
    with zipfile.ZipFile(package) as archive:
        with pytest.raises(ValueError, match="cannot be decoded"):
            song_package_service._validate_semantic_package(archive, song_package_service._safe_members(archive), song_package_service._read_manifest(archive))


def test_revision_cache_avoids_rehash_until_semantic_state_changes(monkeypatch, tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    current = song(source, output)
    song_package_service.invalidate_content_revision(current)
    original = song_package_service._sha256_file
    hashed = Mock(side_effect=original)
    monkeypatch.setattr(song_package_service, "_sha256_file", hashed)
    first = song_package_service.content_revision(current)
    first_count = hashed.call_count
    assert song_package_service.content_revision(current) == first
    assert hashed.call_count == first_count
    current.key_override = "G"
    assert song_package_service.content_revision(current) != first
    assert hashed.call_count > first_count


def test_non_wav_source_probe_accepts_decodable_audio(monkeypatch, tmp_path):
    package = tmp_path / "source-ok.zip"
    outputs = valid_outputs()
    manifest = {
        "package_schema_version": song_package_service.PACKAGE_SCHEMA_VERSION,
        "karaoke_mode": "instrumental", "id": "id", "title": "Song", "slug": "song",
    }
    source = b"mock-flac"
    manifest["content_revision"] = revision_for_outputs(outputs, manifest, source, "song.flac")
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("source/song.flac", source)
        for relative, payload in outputs.items():
            archive.writestr(f"output/{relative}", payload)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        song_package_service.subprocess,
        "run",
        Mock(return_value=SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"streams": [{"codec_type": "audio"}], "format": {"duration": "1.25"}}),
            stderr="",
        )),
    )
    with zipfile.ZipFile(package) as archive:
        song_package_service._validate_semantic_package(
            archive, song_package_service._safe_members(archive), song_package_service._read_manifest(archive)
        )

@pytest.mark.parametrize("mode", ["instrumental", "lyrics", "melody"])
def test_revision_round_trip_is_stable_for_every_karaoke_mode(monkeypatch, tmp_path, mode):
    library = tmp_path / "library"
    cache = tmp_path / "cache"
    library.mkdir(); cache.mkdir()
    host_output = library / "host"
    host_output.mkdir()
    source = host_output / "source.wav"
    source.write_bytes(wav_bytes())
    outputs = valid_outputs()
    if mode == "lyrics":
        word = {"word": "la", "start": 0.0, "end": 0.5}
        outputs["lyricsSync.json"] = json.dumps({"words": [word]}).encode()
        outputs["songMap.json"] = json.dumps({"words": [word], "syllables": [], "notes": []}).encode()
    elif mode == "melody":
        note = {"start": 0.0, "end": 0.5, "midi_note": 60}
        outputs["reference.json"] = json.dumps({"notes": [note]}).encode()
        outputs["songMap.json"] = json.dumps({"words": [], "syllables": [], "notes": [note]}).encode()
    for relative, payload in outputs.items():
        target = host_output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    host = song(source, host_output)
    host.show_lyrics = True
    host.show_notes = True
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", ())
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)
    expected = song_package_service.content_revision(host)
    package = song_package_service.build_package(host, expected_revision=expected)

    database = Mock()
    monkeypatch.setattr(song_package_service.song_service, "get_song", Mock(side_effect=[None, None]))
    monkeypatch.setattr(song_package_service.song_service, "make_unique_slug", Mock(return_value="guest"))
    monkeypatch.setattr(song_package_service, "commit_refresh", lambda _db, current: current)
    imported = song_package_service.import_package(database, package, expected_revision=expected)
    assert song_package_service.compute_content_revision(imported) == expected
    with zipfile.ZipFile(package) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["content_revision"] == expected
    if mode == "instrumental":
        assert manifest["show_lyrics"] is False and manifest["show_notes"] is False
    elif mode == "lyrics":
        assert manifest["show_notes"] is False
    package.unlink()


def test_editor_refreshes_integrity_and_package_remains_exportable(monkeypatch, tmp_path):
    from app.services import song_editor_service

    library = tmp_path / "library"
    cache = tmp_path / "cache"
    cache.mkdir()
    output = library / "song"
    output.mkdir(parents=True)
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    outputs = valid_outputs()
    note = {"start": 0.0, "end": 0.5, "midi_note": 60}
    outputs["reference.json"] = json.dumps({"notes": [note]}).encode()
    outputs["songMap.json"] = json.dumps({"duration": 1.0, "words": [], "syllables": [], "notes": [note]}).encode()
    pipeline_manifest = json.loads(outputs["manifest.json"])
    pipeline_manifest["integrity"] = {
        "songMap": {"size": len(outputs["songMap.json"]), "sha256": hashlib.sha256(outputs["songMap.json"]).hexdigest()},
        "reference": {"size": len(outputs["reference.json"]), "sha256": hashlib.sha256(outputs["reference.json"]).hexdigest()},
    }
    outputs["manifest.json"] = json.dumps(pipeline_manifest).encode()
    for relative, payload in outputs.items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    song_editor_service.save_editor(output, [{"start": 0.0, "end": 0.5, "midi_note": 62}])
    refreshed = json.loads((output / "manifest.json").read_text())
    assert refreshed["integrity"]["songMap"]["sha256"] == hashlib.sha256((output / "songMap.json").read_bytes()).hexdigest()
    assert refreshed["integrity"]["reference"]["sha256"] == hashlib.sha256((output / "reference.json").read_bytes()).hexdigest()

    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", ())
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)
    package = song_package_service.build_package(song(source, output))
    package.unlink()


def test_optimized_flac_stem_remains_revision_and_package_compatible(monkeypatch, tmp_path):
    library = tmp_path / "library"
    cache = tmp_path / "cache"
    output = library / "song"
    output.mkdir(parents=True)
    cache.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)
    current = song(source, output)
    current.optimized = False

    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", ())
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)
    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(cache_service.config, "SONG_LIBRARY_ROOTS", ())

    def encode_flac(_source, target):
        target.write_bytes(b"fLaC" + b"\0" * 128)

    monkeypatch.setattr(cache_service, "_encode_flac", encode_flac)
    monkeypatch.setattr(cache_service, "_encode_mp3", lambda _source, target: target.write_bytes(b"mp3"))
    monkeypatch.setattr(
        song_package_service.subprocess,
        "run",
        lambda *_a, **_k: SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"streams": [{"codec_type": "audio", "duration": "1.0"}], "format": {"duration": "1.0"}}),
        ),
    )

    actions = []
    cache_service._convert_heavy_wavs(output, actions)
    assert not (output / "separated/instrumental.wav").exists()
    assert (output / "separated/instrumental.flac").is_file()
    processing = json.loads((output / "manifest.json").read_text())
    assert processing["outputs"]["instrumental"] == "separated/instrumental.flac"
    assert processing["integrity"]["instrumental"]["sha256"] == hashlib.sha256(
        (output / "separated/instrumental.flac").read_bytes()
    ).hexdigest()

    current.optimized = True
    revision = song_package_service.content_revision(current)
    package = song_package_service.build_package(current, expected_revision=revision)
    try:
        with zipfile.ZipFile(package) as archive:
            manifest = song_package_service._read_manifest(archive)
            assert manifest["content_revision"] == revision
            assert "output/separated/instrumental.flac" in archive.namelist()

        guest_library = tmp_path / "guest-library"
        guest_library.mkdir()
        monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", guest_library)
        monkeypatch.setattr(song_package_service.song_service, "get_song", Mock(return_value=None))
        monkeypatch.setattr(song_package_service.song_service, "make_unique_slug", Mock(return_value="guest"))
        monkeypatch.setattr(song_package_service, "commit_refresh", lambda _db, imported: imported)
        imported = song_package_service.import_package(Mock(), package, expected_revision=revision)
        assert (guest_library / "guest/separated/instrumental.flac").is_file()
        assert song_package_service.content_revision(imported) == revision
    finally:
        package.unlink(missing_ok=True)


def test_revision_and_package_refresh_stale_orm_inside_snapshot_lock(monkeypatch, tmp_path):
    library = tmp_path / "library"
    cache = tmp_path / "cache"
    output = library / "song"
    output.mkdir(parents=True)
    cache.mkdir()
    source = output / "source.wav"
    source.write_bytes(wav_bytes())
    write_valid_output_dir(output)

    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", ())
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)

    engine = create_engine(f"sqlite:///{tmp_path / 'snapshot.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as seed:
        row = song(source, output)
        row.tempo_override = 120.0
        seed.add(row)
        seed.commit()

    with Session(engine, expire_on_commit=False) as session_a, Session(engine) as session_b:
        stale = session_a.get(models.Song, "song-id")
        assert stale is not None and stale.tempo_override == 120.0
        updated = session_b.get(models.Song, "song-id")
        assert updated is not None
        updated.tempo_override = 180.0
        session_b.commit()
        assert stale.tempo_override == 120.0

        revision = song_package_service.content_revision_for_song(session_a, "song-id")
        assert stale.tempo_override == 180.0
        package, _slug = song_package_service.build_package_for_song(
            session_a, "song-id", expected_revision=revision,
        )
        try:
            with zipfile.ZipFile(package) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                assert manifest["tempo_override"] == 180.0
                assert manifest["content_revision"] == revision
        finally:
            package.unlink(missing_ok=True)
    engine.dispose()


def test_internal_output_namespace_recognizes_control_files_and_cache_dirs():
    from pathlib import Path, PurePosixPath
    from app.services import song_artifacts

    assert song_artifacts.is_internal_output_path(Path(".optimization-journal.json"))
    assert song_artifacts.is_internal_output_path(PurePosixPath(".ai-cache/separation.json"))
    assert song_artifacts.is_internal_output_path("nested/.optimization-recovery.json")
    assert song_artifacts.is_internal_output_path("bad\\path")
    assert song_artifacts.is_internal_output_path(object())
    assert not song_artifacts.is_internal_output_path("separated/instrumental.flac")


def test_peer_package_local_recordings_namespace_is_rejected_before_import(tmp_path):
    package = tmp_path / "peer-local.zip"
    build_import_package(package)
    rewritten = tmp_path / "rewritten.zip"
    with zipfile.ZipFile(package) as source, zipfile.ZipFile(rewritten, "w") as target:
        for info in source.infolist():
            target.writestr(info, source.read(info.filename))
        target.writestr("output/recordings/peer.wav", b"peer")
    local = tmp_path / "library/song/recordings/local.wav"
    local.parent.mkdir(parents=True)
    local.write_bytes(b"LOCAL")
    with pytest.raises(ValueError, match="local-only"):
        song_package_service.import_package(Mock(), rewritten)
    assert local.read_bytes() == b"LOCAL"


def test_room_import_recovery_restores_backup_when_db_is_old(monkeypatch, tmp_path):
    library = tmp_path / "library"
    library.mkdir()
    target = library / "song"
    backup = library / ".song.room-backup-deadbeef"
    target.mkdir()
    backup.mkdir()
    (target / "music.json").write_text('{"generation":"NEW"}', encoding="utf-8")
    (backup / "music.json").write_text('{"generation":"OLD"}', encoding="utf-8")
    journal = library / ".room-import-journal-test.json"
    song_package_service.write_json(
        journal,
        {
            "phase": "published",
            "song_id": "id",
            "target": target.name,
            "backup": backup.name,
            "new_revision": "sha256:" + "2" * 64,
        },
    )
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service, "_fresh_song_or_none", lambda _db, _id: object())
    monkeypatch.setattr(song_package_service, "compute_content_revision", lambda _song: "sha256:" + "1" * 64)

    song_package_service._recover_import_journal(Mock(), journal)

    assert json.loads((target / "music.json").read_text()) == {"generation": "OLD"}
    assert not backup.exists() and not journal.exists()


def test_room_import_recovery_finishes_committed_generation_and_preserves_recordings(monkeypatch, tmp_path):
    library = tmp_path / "library"
    library.mkdir()
    target = library / "song"
    backup = library / ".song.room-backup-deadbeef"
    target.mkdir()
    (backup / "recordings").mkdir(parents=True)
    (backup / "recordings/local.wav").write_bytes(b"LOCAL")
    journal = library / ".room-import-journal-test.json"
    revision = "sha256:" + "2" * 64
    song_package_service.write_json(
        journal,
        {
            "phase": "published",
            "song_id": "id",
            "target": target.name,
            "backup": backup.name,
            "new_revision": revision,
        },
    )
    current = SimpleNamespace(id="id")
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service, "_fresh_song_or_none", lambda _db, _id: current)
    monkeypatch.setattr(song_package_service, "compute_content_revision", lambda _song: revision)
    monkeypatch.setattr(song_package_service.revision_cache, "invalidate", Mock())

    song_package_service._recover_import_journal(Mock(), journal)

    assert (target / "recordings/local.wav").read_bytes() == b"LOCAL"
    assert not backup.exists() and not journal.exists()


def test_room_import_recovery_prepared_phase_has_no_filesystem_side_effect(monkeypatch, tmp_path):
    library = tmp_path / "library"
    library.mkdir()
    target = library / "song"
    target.mkdir()
    marker = target / "keep.txt"
    marker.write_text("KEEP", encoding="utf-8")
    journal = library / ".room-import-journal-test.json"
    song_package_service.write_json(
        journal,
        {
            "phase": "prepared",
            "song_id": "id",
            "target": "song",
            "backup": ".song.room-backup-x",
            "new_revision": "sha256:" + "1" * 64,
        },
    )
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    song_package_service._recover_import_journal(Mock(), journal)
    assert marker.read_text(encoding="utf-8") == "KEEP"
    assert not journal.exists()


@pytest.mark.parametrize("name", ["../song", "a/b", "C:\\song", ""])
def test_room_import_recovery_rejects_unsafe_library_entries(monkeypatch, tmp_path, name):
    library = tmp_path / "library"
    library.mkdir()
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    with pytest.raises(ValueError, match="journal|library"):
        song_package_service._safe_library_entry(name)


def test_startup_room_import_recovery_scans_and_keeps_failed_journal(monkeypatch, tmp_path):
    library = tmp_path / "library"
    library.mkdir()
    good = library / ".room-import-journal-a.json"
    bad = library / ".room-import-journal-b.json"
    good.write_text("{}", encoding="utf-8")
    bad.write_text("{}", encoding="utf-8")
    database = Mock()
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service, "SessionLocal", Mock(return_value=database))

    def recover(_db, path):
        if path == bad:
            raise ValueError("broken")
        path.unlink()

    monkeypatch.setattr(song_package_service, "_recover_import_journal", recover)
    song_package_service.recover_import_transactions()
    assert not good.exists() and bad.exists()
    database.rollback.assert_called_once_with()
    database.close.assert_called_once_with()


def test_startup_room_import_recovery_no_library_is_noop(monkeypatch, tmp_path):
    missing = tmp_path / "missing"
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", missing)
    session = Mock()
    monkeypatch.setattr(song_package_service, "SessionLocal", session)
    song_package_service.recover_import_transactions()
    session.assert_not_called()


def test_apply_imported_song_copies_runtime_and_entity_fields():
    target = SimpleNamespace()
    incoming = SimpleNamespace(
        title="New", artist="Artist", genre="Genre", original_filename="source.flac",
        source_path="/new/source.flac", output_dir="/new", status=models.SongStatus.DONE,
        progress_step="imported", progress_percent=100.0, error_message=None,
        key_override="C", tempo_override=123, note_range_min=40, note_range_max=80,
        difficulty_override="hard", video_url="video", show_lyrics=True, show_notes=False,
        optimized=True,
    )
    song_package_service._apply_imported_song(target, incoming)
    assert target.title == "New" and target.tempo_override == 123 and target.optimized is True


def test_same_revision_rejects_non_string_and_fails_closed(monkeypatch):
    assert song_package_service._same_revision(SimpleNamespace(), None) is False
    monkeypatch.setattr(song_package_service, "content_revision", Mock(side_effect=ValueError("bad")))
    assert song_package_service._same_revision(SimpleNamespace(), "sha256:" + "0" * 64) is False


def test_room_import_recovery_uses_historical_library_root(monkeypatch, tmp_path):
    current_root = tmp_path / "current"
    old_root = tmp_path / "old"
    current_root.mkdir()
    old_root.mkdir()
    target = old_root / "song"
    backup = old_root / ".song.room-backup-deadbeef"
    target.mkdir()
    backup.mkdir()
    (target / "music.json").write_text('{"generation":"NEW"}', encoding="utf-8")
    (backup / "music.json").write_text('{"generation":"OLD"}', encoding="utf-8")
    journal = old_root / ".room-import-journal-historical.json"
    revision = "sha256:" + "2" * 64
    song_package_service.write_json(
        journal,
        {
            "phase": "published",
            "song_id": "id",
            "library_root": str(old_root.resolve()),
            "target": target.name,
            "backup": backup.name,
            "new_revision": revision,
        },
    )
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", current_root)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", {current_root.resolve(), old_root.resolve()})
    monkeypatch.setattr(song_package_service, "_fresh_song_or_none", lambda _db, _id: object())
    monkeypatch.setattr(song_package_service, "compute_content_revision", lambda _song: "sha256:" + "1" * 64)

    song_package_service._recover_import_journal(Mock(), journal)

    assert json.loads((target / "music.json").read_text()) == {"generation": "OLD"}
    assert not backup.exists() and not journal.exists()
    assert not (current_root / "song").exists()


def test_startup_room_import_recovery_scans_all_trusted_library_roots(monkeypatch, tmp_path):
    current_root = tmp_path / "current"
    old_root = tmp_path / "old"
    current_root.mkdir()
    old_root.mkdir()
    current = current_root / ".room-import-journal-current.json"
    historical = old_root / ".room-import-journal-old.json"
    current.write_text("{}", encoding="utf-8")
    historical.write_text("{}", encoding="utf-8")
    database = Mock()
    recover = Mock(side_effect=lambda _db, path: path.unlink())
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", current_root)
    monkeypatch.setattr(song_package_service.config, "SONG_LIBRARY_ROOTS", {current_root.resolve(), old_root.resolve()})
    monkeypatch.setattr(song_package_service, "SessionLocal", Mock(return_value=database))
    monkeypatch.setattr(song_package_service, "_recover_import_journal", recover)

    song_package_service.recover_import_transactions()

    assert {call.args[1] for call in recover.call_args_list} == {current, historical}
    database.close.assert_called_once_with()


def test_peer_import_is_blocked_while_recording_is_active(monkeypatch, tmp_path):
    package = tmp_path / "song.zip"
    build_import_package(package)
    from app.services import recording_service
    monkeypatch.setattr(recording_service, "has_active_recording", Mock(return_value=True))

    with pytest.raises(ValueError, match="recording session"):
        song_package_service.import_package(Mock(), package)
