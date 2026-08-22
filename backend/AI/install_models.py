from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import time
from pathlib import Path

from .model_registry import MODELS, ModelSpec, model_path


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def is_valid(models_root: Path, model: ModelSpec) -> bool:
    path = model_path(Path(models_root), model)
    if model.kind == "file":
        return path.is_file() and path.stat().st_size >= max(1, model.expected_bytes // 2) and (not model.sha256 or _hash(path) == model.sha256)
    return path.is_dir() and (path / "config.json").is_file()


class ProgressReporter:
    def __init__(self, models_root: Path, path: Path | None):
        self.models_root, self.path, self.started = Path(models_root), path, time.monotonic()

    def _write(self, **values):
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text("\n".join(f"{key}={value}" for key, value in values.items()), encoding="utf-8")

    def start(self):
        self._write(downloaded_bytes=0, total_bytes=sum(model.expected_bytes for model in MODELS), remaining_seconds=0)

    def model_started(self, name):
        self._write(current_model=name, downloaded_bytes=0, total_bytes=0, remaining_seconds=0)

    def model_finished(self, _name):
        return None

    def finish(self, success):
        self._write(status="ready" if success else "error", remaining_seconds=0)


def install_one(models_root: Path, cache_dir: Path, model: ModelSpec, retries=3):
    if is_valid(models_root, model):
        return model.name, "ready"
    target = model_path(models_root, model)
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for _ in range(max(1, retries)):
        try:
            if model.kind == "file":
                from huggingface_hub import hf_hub_download
                downloaded = hf_hub_download(model.repo_id, model.filename, revision=model.revision, cache_dir=cache_dir)
                temporary = target.with_suffix(target.suffix + ".download")
                try:
                    shutil.copy2(downloaded, temporary)
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
            else:
                from huggingface_hub import snapshot_download
                snapshot_download(model.repo_id, revision=model.revision, local_dir=target, ignore_patterns=model.ignore_patterns)
            if not is_valid(models_root, model):
                raise RuntimeError(f"{model.name} verification failed")
            return model.name, "downloaded"
        except Exception as error:
            last_error = error
    raise last_error or RuntimeError(f"Unable to install {model.name}")


def verify_all(models_root: Path) -> bool:
    return all(is_valid(models_root, model) for model in MODELS)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--quick-check", action="store_true")
    parser.add_argument("--msst", type=Path)
    parser.add_argument("--env", type=Path)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args(argv)
    models_root = args.downloads / "models"
    if args.check or args.quick_check:
        return 0 if verify_all(models_root) else 1
    for model in MODELS:
        install_one(models_root, args.downloads / ".cache", model)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
