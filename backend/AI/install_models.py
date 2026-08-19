from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import threading
import time
import traceback
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import disable_progress_bars

from AI.model_registry import MODELS, ModelSpec, model_directory, model_path

LOGGER = logging.getLogger("ai-model-installer")


class ProgressReporter:

    def __init__(self, models_root: Path, progress_file: Path | None): self.models_root = models_root; self.progress_file = progress_file; self.total_bytes = sum(model.expected_bytes for model in MODELS); self.started_at = time.monotonic(); self.initial_bytes = self.downloaded_bytes(); self.active: set[str] = set(); self.ready_count = 0; self.complete = False; self._lock = threading.Lock(); self._stop = threading.Event(); self._thread: threading.Thread | None = None

    def downloaded_bytes(self) -> int:
        total = 0
        for model in MODELS:
            directory = model_directory(self.models_root, model)
            try:
                size = sum(
                    path.stat().st_size
                    for path in directory.rglob("*")
                    if path.is_file() and ".cache" not in path.parts
                )
            except OSError: size = 0
            total += min(size, model.expected_bytes or size)
        return min(total, self.total_bytes)

    def start(self) -> None:
        if not self.progress_file: return
        self.progress_file.parent.mkdir(parents=True, exist_ok=True); self.write(); self._thread = threading.Thread(target=self._run, name="model-progress", daemon=True); self._thread.start()

    def model_started(self, name: str) -> None:
        with self._lock: self.active.add(name)
        self.write()

    def model_finished(self, name: str) -> None:
        with self._lock:
            self.active.discard(name); self.ready_count += 1
        self.write()

    def finish(self, success: bool) -> None:
        self.complete = success; self._stop.set()
        if self._thread: self._thread.join(timeout=2)
        self.write()

    def _run(self) -> None:
        while not self._stop.wait(1): self.write()

    def write(self) -> None:
        if not self.progress_file: return
        downloaded, elapsed = self.total_bytes if self.complete else self.downloaded_bytes(), max(0.001, time.monotonic() - self.started_at); transferred = max(0, downloaded - self.initial_bytes); speed, remaining = transferred / elapsed, max(0, self.total_bytes - downloaded); eta = round(remaining / speed) if speed > 64 * 1024 else -1
        with self._lock:
            active = ", ".join(sorted(self.active)); ready_count = self.ready_count
        payload, temporary = '\n'.join((f'downloaded_bytes={downloaded}', f'total_bytes={self.total_bytes}', f'downloaded_mb={downloaded // (1024 * 1024)}', f'total_mb={self.total_bytes // (1024 * 1024)}', f'remaining_seconds={eta}', f'ready_count={ready_count}', f'model_count={len(MODELS)}', f'complete={int(self.complete)}', f'active={active}')), self.progress_file.with_suffix(self.progress_file.suffix + '.tmp')
        try:
            temporary.write_text(payload + "\n", encoding="utf-8"); temporary.replace(self.progress_file)
        except OSError: LOGGER.debug("Could not update model progress file", exc_info=True)


def configure_logging(log_file: Path | None) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True); handlers.append(logging.FileHandler(log_file, encoding="utf-8", mode="a"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest().lower()


def _indexed_weight_files(path: Path) -> tuple[set[str], bool]:
    indexes = list(path.glob("*.safetensors.index.json")) + list(
        path.glob("pytorch_model.bin.index.json")
    )
    shards: set[str] = set()
    for index in indexes:
        try:
            manifest = json.loads(index.read_text(encoding="utf-8")); weight_map = manifest["weight_map"]
            if not isinstance(weight_map, dict): return set(), False
            shards.update(str(value) for value in weight_map.values() if value)
        except (OSError, KeyError, TypeError, json.JSONDecodeError): return set(), False
    return shards, bool(indexes)


def _has_complete_weights(path: Path) -> bool: shards, indexed = _indexed_weight_files(path); return bool(shards) and all(((path / shard).is_file() for shard in shards)) if indexed else any(path.glob('*.safetensors')) or (path / 'pytorch_model.bin').is_file()


def missing_snapshot_files(path: Path) -> list[str]: shards, indexed = _indexed_weight_files(path); return [] if not indexed else sorted((shard for shard in shards if not (path / shard).is_file()))


def is_valid(models_root: Path, model: ModelSpec) -> bool:
    if model.kind == "file":
        path = model_path(models_root, model)
        if not path.is_file(): return False
        return not model.sha256 or _sha256(path) == model.sha256.lower()

    if model.kind == "bundle":
        directory = model_directory(models_root, model)
        return bool(model.files) and all(
            _valid_bundle_file(directory / item.relative_path, item) for item in model.files
        )

    directory = model_directory(models_root, model); return (directory / "config.json").is_file() and _has_complete_weights(directory)



def _valid_bundle_file(path: Path, item, *, verify_hash: bool = True) -> bool:
    if not path.is_file(): return False
    try: size = path.stat().st_size
    except OSError: return False
    if size < item.min_bytes or (item.expected_bytes and size != item.expected_bytes): return False
    if verify_hash and item.sha256 and _sha256(path) != item.sha256.lower(): return False
    if item.contains:
        try: text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError): return False
        if not all(token in text for token in item.contains): return False
    return True


def quick_is_valid(models_root: Path, model: ModelSpec) -> bool:
    if model.kind == "file":
        path = model_path(models_root, model); return path.is_file() and (not model.expected_bytes or path.stat().st_size == model.expected_bytes)
    if model.kind == "bundle":
        directory = model_directory(models_root, model)
        return bool(model.files) and all(
            _valid_bundle_file(directory / item.relative_path, item, verify_hash=False)
            for item in model.files
        )
    directory = model_directory(models_root, model); return (directory / "config.json").is_file() and _has_complete_weights(directory)

def prune_unused_artifacts(models_root: Path, model: ModelSpec) -> int:
    directory, removed = model_directory(models_root, model), 0
    for pattern in model.ignore_patterns:
        for path in directory.glob(pattern):
            if path.is_dir():
                shutil.rmtree(path)
            elif path.is_file(): path.unlink()
            removed += 1
    return removed


def _download(models_root: Path, cache_dir: Path, model: ModelSpec) -> None:
    directory = model_directory(models_root, model)
    if model.kind == "bundle":
        for item in model.files:
            target = directory / item.relative_path; target.parent.mkdir(parents=True, exist_ok=True); temporary = target.with_suffix(target.suffix + ".part")
            try:
                with (
                    urllib.request.urlopen(item.url, timeout=120) as source,
                    temporary.open("wb") as destination,
                ):
                    shutil.copyfileobj(source, destination, 1024 * 1024)
                if not _valid_bundle_file(temporary, item): raise RuntimeError(f"{model.name}: invalid download {item.relative_path}")
                os.replace(temporary, target)
            finally: temporary.unlink(missing_ok=True)
        return
    common = {
        "repo_id": model.repo_id,
        "revision": model.revision,
        "local_dir": str(directory),
        "cache_dir": str(cache_dir),
    }
    if model.kind == "file":
        if not model.filename: raise RuntimeError(f"{model.name}: filename is missing in model registry")
        hf_hub_download(filename=model.filename, **common)
    else:
        snapshot_download(
            ignore_patterns=list(model.ignore_patterns) or None,
            max_workers=4,
            **common,
        )
        for shard in missing_snapshot_files(directory):
            LOGGER.warning("[REPAIR] %s: restoring missing shard %s", model.name, shard)
            hf_hub_download(
                filename=shard,
                force_download=True,
                **common,
            )


def install_one(
    models_root: Path,
    cache_dir: Path,
    model: ModelSpec,
    retries: int,
) -> tuple[str, str]:
    prune_unused_artifacts(models_root, model)
    if is_valid(models_root, model): return model.name, "ready"

    directory = model_directory(models_root, model); directory.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, retries + 1):
        LOGGER.info(
            "[DOWNLOAD] %s (%s), attempt %d/%d",
            model.name,
            model.repo_id,
            attempt,
            retries,
        )
        try:
            _download(models_root, cache_dir, model); break
        except Exception:
            LOGGER.error("Download attempt failed for %s:\n%s", model.name, traceback.format_exc())
            if attempt == retries: raise
            time.sleep(min(2**attempt, 10))

    if not is_valid(models_root, model): raise RuntimeError(f"{model.name}: verification failed after download")

    return model.name, "downloaded"


def write_environment(downloads: Path, models_root: Path, msst: Path, env_file: Path) -> None:
    values = {
        "HF_HOME": downloads / "cache" / "huggingface",
        "HF_HUB_CACHE": downloads / "cache" / "huggingface" / "hub",
        "KARAOKE_AI_ALLOW_FALLBACK": "false",
        "KARAOKE_AI_REQUIRE_CTC": "1",
        "MSST_ENGINE_DIR": msst,
        "MSST_CONFIG": msst
        / "configs"
        / "KimberleyJensen"
        / "config_vocals_mel_band_roformer_kj.yaml",
    }
    for model in MODELS: values[model.env_var] = model_path(models_root, model)

    fcpe_onnx = models_root / "optimized" / "fcpe" / "fcpe-core.onnx"
    if fcpe_onnx.is_file(): values["KARAOKE_AI_FCPE_ONNX"] = fcpe_onnx
    directml_runtime = downloads / "runtimes" / "onnxruntime-directml"
    if (directml_runtime / "onnxruntime").is_dir(): values["KARAOKE_AI_ORT_DIRECTML_PATH"] = directml_runtime

    env_file.parent.mkdir(parents=True, exist_ok=True)
    with env_file.open("w", encoding="utf-8", newline="\r\n") as handle:
        handle.write("@echo off\r\n")
        for name, value in values.items(): handle.write(f'set "{name}={value}"\r\n')


def verify_all(models_root: Path) -> bool:
    ok = True
    for model in MODELS:
        if removed := prune_unused_artifacts(models_root, model): LOGGER.info("[PRUNE] %s: removed %d unused artifacts", model.name, removed)
        valid = is_valid(models_root, model)
        if not valid and model.kind == "snapshot":
            for missing in missing_snapshot_files(model_directory(models_root, model)): LOGGER.error("[MISSING SHARD] %s: %s", model.name, missing)
        LOGGER.info("[%s] %s", "OK" if valid else "MISSING", model.name); ok = ok and valid
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--downloads", type=Path); parser.add_argument("--models-root", type=Path); parser.add_argument("--msst", type=Path)
    parser.add_argument("--env", type=Path); parser.add_argument("--cache-dir", type=Path); parser.add_argument("--workers", type=int, default=2); parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--log-file", type=Path); parser.add_argument("--progress-file", type=Path); parser.add_argument("--check", action="store_true"); parser.add_argument("--quick-check", action="store_true")
    args = parser.parse_args(argv)

    if args.models_root:
        models_root = args.models_root.resolve(); downloads = args.downloads.resolve() if args.downloads else models_root.parent
    elif args.downloads:
        downloads = args.downloads.resolve(); models_root = downloads / "models"
    else:
        parser.error("one of --downloads or --models-root is required")

    models_root.mkdir(parents=True, exist_ok=True); configure_logging(args.log_file.resolve() if args.log_file else None)

    cache_dir = (args.cache_dir or downloads / "cache" / "huggingface").resolve(); os.environ.setdefault("HF_HOME", str(cache_dir)); os.environ.setdefault("HF_HUB_CACHE", str(cache_dir / "hub")); os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    if args.check or args.quick_check:
        ok = (
            all(quick_is_valid(models_root, model) for model in MODELS)
            if args.quick_check
            else verify_all(models_root)
        )
        if ok and args.msst and args.env: write_environment(downloads, models_root, args.msst.resolve(), args.env.resolve())
        return 0 if ok else 1

    disable_progress_bars()

    reporter = ProgressReporter(
        models_root,
        args.progress_file.resolve() if args.progress_file else None,
    )
    reporter.start(); workers, retries = max(1, min(args.workers, len(MODELS))), max(1, args.retries)
    LOGGER.info(
        "Installing %d model resources with %d parallel workers and %d attempts per model",
        len(MODELS),
        workers,
        retries,
    )

    failed = False
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ai-model") as pool:
        for model in MODELS:
            if is_valid(models_root, model): reporter.model_finished(model.name)
        futures = {
            pool.submit(install_one, models_root, cache_dir, model, retries): model
            for model in MODELS
            if not is_valid(models_root, model)
        }
        for model in futures.values(): reporter.model_started(model.name)
        for future in as_completed(futures):
            model = futures[future]
            try:
                name, status = future.result(); LOGGER.info("[%s] %s", "SKIP" if status == "ready" else "DONE", name); reporter.model_finished(name)
            except Exception as exc:
                failed = True; LOGGER.error("[ERROR] %s: %s", model.name, exc)

    success = not failed and verify_all(models_root); reporter.finish(success)
    if not success: return 1

    if args.msst and args.env: write_environment(downloads, models_root, args.msst.resolve(), args.env.resolve())
    LOGGER.info("All registered AI models are ready."); return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main(argv)
    raise SystemExit(main())
