from __future__ import annotations

import argparse
import hashlib
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .model_registry import MODELS, ModelSpec, model_path

logger = logging.getLogger(__name__)


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


# is_valid() runs at the start of every song-processing job (via
# ensure_ready_sync), and for a large checkpoint (e.g. the ~900MB
# MelBandRoformer) that meant re-reading and re-hashing the entire file from
# disk on every single request even though it never changes between runs.
# Caching the digest against the file's (size, mtime) means it's only
# recomputed when the file has actually been replaced -- by a repair/
# re-download, which changes its mtime.
_hash_cache: dict[Path, tuple[int, int, str]] = {}
_hash_cache_lock = threading.Lock()


def _cached_hash(path: Path) -> str:
    stat = path.stat()
    key = (stat.st_size, stat.st_mtime_ns)
    with _hash_cache_lock:
        cached = _hash_cache.get(path)
        if cached is not None and cached[:2] == key:
            return cached[2]
    digest = _hash(path)
    with _hash_cache_lock:
        _hash_cache[path] = (*key, digest)
    return digest


def _size(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
        if path.is_dir():
            return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    except OSError:
        pass
    return 0


def is_valid(models_root: Path, model: ModelSpec) -> bool:
    path = model_path(Path(models_root), model)
    if model.kind == "file":
        return (
            path.is_file()
            and path.stat().st_size >= max(1, model.expected_bytes // 2)
            and (not model.sha256 or _cached_hash(path) == model.sha256)
        )
    return path.is_dir() and (path / "config.json").is_file()


class ProgressReporter:
    def __init__(self, models_root: Path, path: Path | None):
        self.models_root = Path(models_root)
        self.path = Path(path) if path else None
        self.started = time.monotonic()
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active: set[str] = set()
        self._completed: set[str] = set()
        self._last_bytes = 0
        self._last_time = self.started
        self._bytes_per_second = 0.0

    @property
    def total_bytes(self) -> int:
        return sum(max(0, model.expected_bytes) for model in MODELS)

    def _downloaded_bytes(self) -> int:
        total = 0
        for model in MODELS:
            if model.name in self._completed:
                total += model.expected_bytes
                continue
            actual = _size(model_path(self.models_root, model))
            total += min(max(0, actual), max(0, model.expected_bytes))
        return min(total, self.total_bytes)

    def _snapshot(self, **extra) -> dict[str, object]:
        now = time.monotonic()
        downloaded = self._downloaded_bytes()
        elapsed = max(0.001, now - self._last_time)
        delta = max(0, downloaded - self._last_bytes)
        instant_rate = delta / elapsed
        if instant_rate > 0:
            self._bytes_per_second = (
                instant_rate
                if self._bytes_per_second <= 0
                else self._bytes_per_second * 0.75 + instant_rate * 0.25
            )
        self._last_bytes, self._last_time = downloaded, now

        remaining = max(0, self.total_bytes - downloaded)
        eta = int(remaining / self._bytes_per_second) if self._bytes_per_second > 0 else -1
        active = ", ".join(sorted(self._active))
        values: dict[str, object] = {
            "status": "downloading",
            "active": active,
            "current_model": active,
            "downloaded_bytes": downloaded,
            "total_bytes": self.total_bytes,
            "downloaded_mb": downloaded // (1024 * 1024),
            "total_mb": self.total_bytes // (1024 * 1024),
            "remaining_seconds": eta,
        }
        values.update(extra)
        return values

    def _write(self, **values) -> None:
        if not self.path:
            return
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            temporary.write_text(
                "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, self.path)

    def refresh(self, **extra) -> None:
        with self._lock:
            self._write(**self._snapshot(**extra))

    def _monitor(self) -> None:
        while not self._stop.wait(1.0):
            try:
                self.refresh()
            except Exception:
                logger.debug("Unable to update model download progress", exc_info=True)

    def start(self) -> None:
        self.started = time.monotonic()
        self._last_time = self.started
        self._completed = {model.name for model in MODELS if is_valid(self.models_root, model)}
        self._last_bytes = self._downloaded_bytes()
        self._bytes_per_second = 0.0
        self._stop.clear()
        self.refresh()
        if self.path and (self._thread is None or not self._thread.is_alive()):
            self._thread = threading.Thread(
                target=self._monitor,
                name="model-install-progress",
                daemon=True,
            )
            self._thread.start()

    def model_started(self, name: str) -> None:
        with self._lock:
            self._active.add(name)
        self.refresh()

    def model_finished(self, name: str) -> None:
        with self._lock:
            self._active.discard(name)
            model = next((item for item in MODELS if item.name == name), None)
            if model is not None and is_valid(self.models_root, model):
                self._completed.add(name)
        self.refresh()

    def finish(self, success: bool, error: str | None = None) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        with self._lock:
            self._active.clear()
            values = self._snapshot(
                status="ready" if success else "error",
                remaining_seconds=0 if success else -1,
            )
            if error:
                values["error"] = str(error).replace("\r", " ").replace("\n", " ")[:2000]
            self._write(**values)


def _download_single_file(target: Path, model: ModelSpec) -> Path:
    """Download a single-file model directly into its final model directory.

    Hugging Face's cache API returns a path inside its cache. On Windows that path
    can contain a symlink/reparse point. Copying that returned path caused
    WinError 448 ("untrusted mount point") on real installer runs. Using
    ``local_dir`` asks huggingface_hub to materialize the file in the destination
    directory itself, so there is no cache-path traversal or copy step afterward.
    The local-dir metadata still lets huggingface_hub resume/reuse the download.
    """
    from huggingface_hub import hf_hub_download

    if not model.filename:
        raise RuntimeError(f"{model.name} has no filename")

    target.parent.mkdir(parents=True, exist_ok=True)
    downloaded = Path(
        hf_hub_download(
            repo_id=model.repo_id,
            filename=model.filename,
            revision=model.revision,
            local_dir=target.parent,
        )
    )
    expected = target.parent / model.filename
    if downloaded != expected and downloaded.name != target.name:
        raise RuntimeError(
            f"{model.name} downloaded to an unexpected path: {downloaded}"
        )
    if not target.is_file():
        raise FileNotFoundError(f"Downloaded model file is missing: {target}")
    return target


def install_one(
    models_root: Path,
    cache_dir: Path,
    model: ModelSpec,
    retries: int = 3,
):
    models_root, cache_dir = Path(models_root), Path(cache_dir)
    if is_valid(models_root, model):
        return model.name, "ready"

    target = model_path(models_root, model)
    target.parent.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    attempts = max(1, int(retries))

    for attempt in range(1, attempts + 1):
        try:
            logger.info("Installing AI model %s (attempt %d/%d)", model.name, attempt, attempts)
            if model.kind == "file":
                _download_single_file(target, model)
            else:
                from huggingface_hub import snapshot_download

                snapshot_download(
                    repo_id=model.repo_id,
                    revision=model.revision,
                    local_dir=target,
                    cache_dir=cache_dir,
                    ignore_patterns=model.ignore_patterns,
                )

            if not is_valid(models_root, model):
                raise RuntimeError(f"{model.name} verification failed")
            logger.info("AI model ready: %s", model.name)
            return model.name, "downloaded"
        except Exception as error:
            last_error = error
            logger.exception("AI model install attempt failed: %s", model.name)
            if attempt < attempts:
                time.sleep(min(5.0, float(attempt)))

    raise last_error or RuntimeError(f"Unable to install {model.name}")


def verify_all(models_root: Path) -> bool:
    return all(is_valid(models_root, model) for model in MODELS)


def _prepare_log_file(log_file: Path) -> None:
    """Make the log readable by Windows PowerShell 5.x as well as UTF-8 tools."""
    log_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not log_file.exists() or log_file.stat().st_size == 0:
            log_file.write_bytes(b"\xef\xbb\xbf")
    except OSError:
        pass


def _configure_logging(log_file: Path | None) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file:
        log_file = Path(log_file)
        _prepare_log_file(log_file)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def _install_models(
    models_root: Path,
    cache_dir: Path,
    reporter: ProgressReporter,
    workers: int,
    retries: int,
) -> None:
    missing = [model for model in MODELS if not is_valid(models_root, model)]
    for model in MODELS:
        if model not in missing:
            reporter.model_finished(model.name)

    if not missing:
        return

    def install(model: ModelSpec):
        reporter.model_started(model.name)
        try:
            return install_one(models_root, cache_dir, model, retries=retries)
        finally:
            reporter.model_finished(model.name)

    worker_count = min(max(1, int(workers)), len(missing))
    if worker_count == 1:
        for model in missing:
            install(model)
        return

    with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="model-download") as executor:
        futures = {executor.submit(install, model): model for model in missing}
        for future in as_completed(futures):
            future.result()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Install or verify A&D Voice AI models")
    parser.add_argument(
        "--downloads",
        type=Path,
        help="Legacy download root; models go to <downloads>/models",
    )
    parser.add_argument("--models-root", type=Path, help="Explicit model installation directory")
    parser.add_argument("--cache-dir", type=Path, help="Resumable Hugging Face download cache")
    parser.add_argument("--progress-file", type=Path, help="key=value progress file for installer/UI")
    parser.add_argument("--log-file", type=Path, help="Model installation log file")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--quick-check", action="store_true")
    parser.add_argument("--msst", type=Path)
    parser.add_argument("--env", type=Path)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args(argv)

    _configure_logging(args.log_file)

    if args.models_root:
        models_root = args.models_root.resolve()
    elif args.downloads:
        models_root = (args.downloads / "models").resolve()
    else:
        parser.error("one of --models-root or --downloads is required")

    if args.cache_dir:
        cache_dir = args.cache_dir.resolve()
    elif args.downloads:
        cache_dir = (args.downloads / ".cache").resolve()
    else:
        cache_dir = (models_root.parent / "generated" / "temp" / "model-downloads").resolve()

    models_root.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    if args.check or args.quick_check:
        ready = verify_all(models_root)
        logger.info("AI model verification: %s", "ready" if ready else "missing")
        return 0 if ready else 1

    reporter = ProgressReporter(models_root, args.progress_file)
    reporter.start()
    try:
        _install_models(
            models_root,
            cache_dir,
            reporter,
            workers=max(1, args.workers),
            retries=max(1, args.retries),
        )
        if not verify_all(models_root):
            raise RuntimeError("AI model verification failed after installation")
        reporter.finish(True)
        logger.info("All AI models are ready in %s", models_root)
        return 0
    except Exception as error:
        reporter.finish(False, str(error))
        logger.exception("AI model installation failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
