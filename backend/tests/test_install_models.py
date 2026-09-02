import hashlib
import os

from AI import install_models
from AI.model_registry import ModelSpec, get_model


def test_vocalparse_checkpoint_is_pinned_and_hash_verified():
    model = get_model("vocalparse")

    assert model.repo_id == "pymaster/VocalParse"
    assert len(model.revision) == 40
    assert model.filename == "model.safetensors"
    assert model.sha256 == "08a69f96082ed962950b7a6e90cd1482e87b132cecab1d805a7a024fcee7b08d"


def _make_model(tmp_path, content=b"hello world"):
    root = tmp_path / "roformer"
    root.mkdir()
    file_path = root / "model.ckpt"
    file_path.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    model = ModelSpec(
        key="test", name="Test", repo_id="x", revision="x",
        relative_path="roformer", env_var="X", expected_bytes=len(content),
        kind="file", filename="model.ckpt", sha256=digest,
    )
    return model, file_path


def test_is_valid_accepts_a_file_matching_its_expected_hash(tmp_path):
    install_models._hash_cache.clear()
    model, _ = _make_model(tmp_path)
    assert install_models.is_valid(tmp_path, model) is True


def test_is_valid_rejects_a_file_with_the_wrong_content(tmp_path):
    install_models._hash_cache.clear()
    model, file_path = _make_model(tmp_path)
    file_path.write_bytes(b"corrupted!!")
    assert install_models.is_valid(tmp_path, model) is False


def test_is_valid_only_rehashes_the_checkpoint_after_it_actually_changes(tmp_path, monkeypatch):
    # is_valid() runs at the start of every song-processing job, so a large
    # checkpoint that never changes must not be re-hashed from disk every
    # single time -- only when its (size, mtime) actually differs from what
    # was last verified.
    install_models._hash_cache.clear()
    calls = []
    real_hash = install_models._hash

    def counting_hash(path):
        calls.append(path)
        return real_hash(path)

    monkeypatch.setattr(install_models, "_hash", counting_hash)
    model, file_path = _make_model(tmp_path)

    assert install_models.is_valid(tmp_path, model) is True
    assert install_models.is_valid(tmp_path, model) is True
    assert len(calls) == 1

    new_content = b"a whole different checkpoint payload"
    file_path.write_bytes(new_content)
    # A coarse filesystem mtime clock could otherwise report the exact same
    # timestamp as before the rewrite; force it far enough away to guarantee
    # the cache key differs regardless of filesystem timestamp resolution.
    future = file_path.stat().st_mtime + 100
    os.utime(file_path, (future, future))

    assert install_models.is_valid(tmp_path, model) is False
    assert len(calls) == 2


def test_is_valid_rejects_an_incomplete_snapshot_even_with_config(tmp_path):
    root = tmp_path / "snapshot"
    root.mkdir()
    (root / "config.json").write_text("{}", encoding="utf-8")
    (root / "weights.safetensors.incomplete").write_bytes(b"partial")
    model = ModelSpec(
        key="snapshot", name="Snapshot", repo_id="x", revision="x",
        relative_path="snapshot", env_var="X", expected_bytes=8,
    )

    assert install_models.is_valid(tmp_path, model) is False


def test_is_valid_accepts_a_complete_snapshot(tmp_path):
    root = tmp_path / "snapshot"
    root.mkdir()
    (root / "config.json").write_text("{}", encoding="utf-8")
    (root / "weights.safetensors").write_bytes(b"complete")
    model = ModelSpec(
        key="snapshot", name="Snapshot", repo_id="x", revision="x",
        relative_path="snapshot", env_var="X", expected_bytes=8,
    )

    assert install_models.is_valid(tmp_path, model) is True


def test_is_valid_verifies_the_primary_snapshot_weight(tmp_path):
    install_models._hash_cache.clear()
    root = tmp_path / "snapshot"
    root.mkdir()
    (root / "config.json").write_text("{}", encoding="utf-8")
    weights = root / "model.safetensors"
    weights.write_bytes(b"trusted weights")
    model = ModelSpec(
        key="snapshot",
        name="Snapshot",
        repo_id="x",
        revision="x",
        relative_path="snapshot",
        env_var="X",
        expected_bytes=8,
        filename="model.safetensors",
        sha256=hashlib.sha256(b"trusted weights").hexdigest(),
    )

    assert install_models.is_valid(tmp_path, model)
    weights.write_bytes(b"corrupt")
    assert not install_models.is_valid(tmp_path, model)
