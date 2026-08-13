from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from unittest.mock import Mock

import pytest

from AI import install_models as install
from AI.model_registry import ModelSpec


def specs():
    file_data = b"weights"
    file_model = ModelSpec(
        "file",
        "File",
        "repo/file",
        "rev",
        "file-model",
        "FILE_MODEL",
        kind="file",
        filename="weights.bin",
        sha256=hashlib.sha256(file_data).hexdigest(),
        expected_bytes=len(file_data),
    )
    snapshot = ModelSpec(
        "snapshot",
        "Snapshot",
        "repo/snapshot",
        "rev",
        "snapshot",
        "SNAPSHOT_MODEL",
        ignore_patterns=("unused/**",),
        expected_bytes=100,
    )
    return file_model, snapshot, file_data


def test_progress_reporter_counts_writes_and_finishes(monkeypatch, tmp_path):
    file_model, snapshot, data = specs()
    monkeypatch.setattr(install, "MODELS", (file_model, snapshot))
    file_dir = tmp_path / file_model.relative_path
    file_dir.mkdir()
    (file_dir / file_model.filename).write_bytes(data)
    snap_dir = tmp_path / snapshot.relative_path
    snap_dir.mkdir()
    (snap_dir / "part").write_bytes(b"x" * 200)
    reporter = install.ProgressReporter(tmp_path, tmp_path / "progress.txt")
    assert reporter.downloaded_bytes() == 107
    reporter.started_at -= 10
    reporter.model_started("File")
    reporter.model_finished("File")
    payload = reporter.progress_file.read_text()
    assert "ready_count=1" in payload and "active=" in payload
    reporter.start()
    reporter.finish(True)
    assert "complete=1" in reporter.progress_file.read_text()
    no_file = install.ProgressReporter(tmp_path, None)
    no_file.start()
    no_file.write()
    no_file.finish(False)


def test_progress_reporter_tolerates_size_and_write_errors(monkeypatch, tmp_path):
    file_model, _, _ = specs()
    monkeypatch.setattr(install, "MODELS", (file_model,))
    broken_directory = Mock()
    broken_directory.rglob.side_effect = OSError("unreadable")
    monkeypatch.setattr(install, "model_directory", lambda *_: broken_directory)
    reporter = install.ProgressReporter(tmp_path, tmp_path / "progress")
    assert reporter.downloaded_bytes() == 0
    waits = iter([False, True])
    reporter._stop = Mock(wait=lambda _: next(waits))
    reporter.write = Mock()
    reporter._run()
    reporter.write.assert_called_once()
    reporter.write = install.ProgressReporter.write.__get__(reporter)
    monkeypatch.setattr(Path, "write_text", Mock(side_effect=OSError("locked")))
    reporter.write()


def test_configure_logging_and_sha256(tmp_path):
    log = tmp_path / "nested" / "models.log"
    install.configure_logging(log)
    logging.getLogger("ai-model-installer").info("hello")
    assert log.exists()
    path = tmp_path / "value"
    path.write_bytes(b"abc")
    assert install._sha256(path) == hashlib.sha256(b"abc").hexdigest()


def test_complete_weights_variants(tmp_path):
    assert not install._has_complete_weights(tmp_path)
    (tmp_path / "model.safetensors").touch()
    assert install._has_complete_weights(tmp_path)
    (tmp_path / "model.safetensors").unlink()
    index = tmp_path / "model.safetensors.index.json"
    index.write_text("bad")
    assert not install._has_complete_weights(tmp_path)
    index.write_text('{"weight_map": {}}')
    assert not install._has_complete_weights(tmp_path)
    index.write_text('{"weight_map": {"a": "part.safetensors"}}')
    assert not install._has_complete_weights(tmp_path)
    (tmp_path / "part.safetensors").touch()
    assert install._has_complete_weights(tmp_path)


def test_model_validation_file_and_snapshot(monkeypatch, tmp_path):
    file_model, snapshot, data = specs()
    assert not install.is_valid(tmp_path, file_model)
    path = tmp_path / file_model.relative_path / file_model.filename
    path.parent.mkdir()
    path.write_bytes(b"bad")
    assert not install.is_valid(tmp_path, file_model)
    path.write_bytes(data)
    assert install.is_valid(tmp_path, file_model)
    no_hash = ModelSpec("x", "x", "r", "v", "x", "X", kind="file", filename="x")
    target = tmp_path / "x" / "x"
    target.parent.mkdir()
    target.touch()
    assert install.is_valid(tmp_path, no_hash)
    directory = tmp_path / snapshot.relative_path
    directory.mkdir()
    assert not install.is_valid(tmp_path, snapshot)
    (directory / "config.json").touch()
    (directory / "model.safetensors").touch()
    assert install.is_valid(tmp_path, snapshot)


def test_prune_unused_files_and_directories(tmp_path):
    model = ModelSpec("x", "x", "r", "v", "m", "X", ignore_patterns=("unused*",))
    root = tmp_path / "m"
    root.mkdir()
    (root / "unused-file").touch()
    directory = root / "unused-dir"
    directory.mkdir()
    (directory / "x").touch()
    assert install.prune_unused_artifacts(tmp_path, model) == 2
    assert not list(root.iterdir())


def test_download_file_snapshot_and_missing_filename(monkeypatch, tmp_path):
    file_model, snapshot, _ = specs()
    file_download = Mock()
    snapshot_download = Mock()
    monkeypatch.setattr(install, "hf_hub_download", file_download)
    monkeypatch.setattr(install, "snapshot_download", snapshot_download)
    install._download(tmp_path, tmp_path / "cache", file_model)
    assert file_download.call_args.kwargs["filename"] == file_model.filename
    install._download(tmp_path, tmp_path / "cache", snapshot)
    assert snapshot_download.call_args.kwargs["max_workers"] == 4
    missing = ModelSpec("x", "x", "r", "v", "m", "X", kind="file")
    with pytest.raises(RuntimeError, match="filename"):
        install._download(tmp_path, tmp_path / "cache", missing)


def test_install_one_ready_retry_download_and_verification(monkeypatch, tmp_path):
    model, _, _ = specs()
    monkeypatch.setattr(install, "prune_unused_artifacts", lambda *_: 0)
    states = iter([True])
    monkeypatch.setattr(install, "is_valid", lambda *_: next(states))
    assert install.install_one(tmp_path, tmp_path, model, 1) == (model.name, "ready")

    calls = 0

    def download(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError("network")

    states = iter([False, True])
    monkeypatch.setattr(install, "is_valid", lambda *_: next(states))
    monkeypatch.setattr(install, "_download", download)
    monkeypatch.setattr(install.time, "sleep", Mock())
    assert install.install_one(tmp_path, tmp_path, model, 2)[1] == "downloaded"
    assert calls == 2

    monkeypatch.setattr(install, "is_valid", lambda *_: False)
    monkeypatch.setattr(install, "_download", lambda *_: None)
    with pytest.raises(RuntimeError, match="verification failed"):
        install.install_one(tmp_path, tmp_path, model, 1)
    monkeypatch.setattr(install, "_download", Mock(side_effect=OSError("offline")))
    with pytest.raises(OSError, match="offline"):
        install.install_one(tmp_path, tmp_path, model, 1)


def test_write_environment_and_verify_all(monkeypatch, tmp_path):
    file_model, snapshot, _ = specs()
    monkeypatch.setattr(install, "MODELS", (file_model, snapshot))
    env = tmp_path / "env" / "models.bat"
    install.write_environment(tmp_path, tmp_path / "models", tmp_path / "msst", env)
    text = env.read_text()
    assert "KARAOKE_AI_REQUIRE_CTC=1" in text and "FILE_MODEL=" in text
    monkeypatch.setattr(install, "prune_unused_artifacts", Mock(return_value=1))
    values = iter([True, False])
    monkeypatch.setattr(install, "is_valid", lambda *_: next(values))
    assert not install.verify_all(tmp_path)


def test_main_check_install_success_and_failure(monkeypatch, tmp_path):
    file_model, snapshot, _ = specs()
    monkeypatch.setattr(install, "MODELS", (file_model, snapshot))
    monkeypatch.setattr(install, "configure_logging", Mock())
    monkeypatch.setattr(install, "write_environment", Mock())
    monkeypatch.setattr(install, "verify_all", lambda _: True)
    root = tmp_path / "models"
    assert (
        install.main(
            [
                "--models-root",
                str(root),
                "--check",
                "--msst",
                str(tmp_path),
                "--env",
                str(tmp_path / "env"),
            ]
        )
        == 0
    )
    monkeypatch.setattr(install, "verify_all", lambda _: False)
    assert install.main(["--downloads", str(tmp_path / "downloads"), "--check"]) == 1

    valid = {file_model.name}
    monkeypatch.setattr(install, "is_valid", lambda _root, model: model.name in valid)
    monkeypatch.setattr(install, "install_one", lambda *_: (snapshot.name, "downloaded"))
    monkeypatch.setattr(install, "verify_all", lambda _: True)
    assert (
        install.main(
            [
                "--models-root",
                str(root),
                "--workers",
                "99",
                "--retries",
                "0",
                "--msst",
                str(tmp_path),
                "--env",
                str(tmp_path / "installed-env"),
            ]
        )
        == 0
    )

    monkeypatch.setattr(install, "is_valid", lambda *_: False)
    monkeypatch.setattr(install, "install_one", Mock(side_effect=RuntimeError("failed")))
    assert install.main(["--models-root", str(root)]) == 1
    with pytest.raises(SystemExit):
        install.main([])
