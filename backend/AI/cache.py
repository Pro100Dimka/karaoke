from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable
from pathlib import Path

from .locks import FileLock
from .utils.io import read_json, write_json_atomic

Validator = Callable[[Path], object]


class StageCache:
    """Thread- and process-safe per-song content cache."""

    INDEX_VERSION = 5
    LOCK_TIMEOUT_SEC = 30.0

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "index.json"
        self.lock_path = self.root / "index.lock"
        self._hash_memo: dict[tuple[str, int, int, int], str] = {}
        self._lock = threading.RLock()
        self.index = self._load_index()

    def _load_index(self) -> dict:
        loaded = read_json(self.index_path, {}) or {}
        if not isinstance(loaded, dict) or loaded.get("version") != self.INDEX_VERSION:
            return {"version": self.INDEX_VERSION, "stages": {}}
        if not isinstance(loaded.get("stages"), dict):
            loaded["stages"] = {}
        return loaded

    def _process_lock(self):
        return FileLock(self.lock_path, timeout_sec=self.LOCK_TIMEOUT_SEC)

    def file_hash(self, path: str | Path, block: int = 1024 * 1024) -> str:
        source = Path(path)
        stat = source.stat()
        memo_key = (
            str(source.resolve()),
            stat.st_size,
            stat.st_mtime_ns,
            getattr(stat, "st_ctime_ns", 0),
        )
        with self._lock:
            cached = self._hash_memo.get(memo_key)
        if cached is not None:
            return cached
        digest = hashlib.sha256()
        with source.open("rb") as stream:
            while chunk := stream.read(block):
                digest.update(chunk)
        value = digest.hexdigest()
        with self._lock:
            if len(self._hash_memo) > 4096:
                self._hash_memo.clear()
            self._hash_memo[memo_key] = value
        return value

    def optional_file_hash(self, path: str | Path | None) -> str | None:
        if path is None:
            return None
        candidate = Path(path)
        if not candidate.is_file():
            return f"missing:{candidate.resolve()}"
        return self.file_hash(candidate)

    @staticmethod
    def key(stage: str, payload: dict) -> str:
        raw = json.dumps(
            {"stage": stage, "payload": payload},
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def key_matches(self, stage: str, key: str) -> bool:
        """Return whether the persisted stage provenance matches ``key``."""
        with self._lock:
            self.index = self._load_index()
            entry = self.index.get("stages", {}).get(stage)
        return isinstance(entry, dict) and entry.get("key") == key

    def hit(
        self,
        stage: str,
        key: str,
        outputs: list[Path],
        validators: dict[Path, Validator] | None = None,
    ) -> bool:
        with self._lock:
            self.index = self._load_index()
            entry = self.index.get("stages", {}).get(stage)
        if not isinstance(entry, dict) or entry.get("key") != key:
            return False
        recorded = entry.get("outputs")
        if not isinstance(recorded, dict):
            return False
        try:
            for output in outputs:
                path = Path(output)
                metadata = recorded.get(str(path.resolve()))
                if not isinstance(metadata, dict) or not path.is_file():
                    return False
                stat = path.stat()
                if stat.st_size <= 0 or stat.st_size != metadata.get("size"):
                    return False
                if self.file_hash(path) != metadata.get("sha256"):
                    return False
                validator = validators.get(path) if validators else None
                if validator is not None:
                    validator(path)
        except (OSError, ValueError, RuntimeError, TypeError):
            return False
        return True

    def commit(self, stage: str, key: str, outputs: list[Path] | None = None) -> None:
        artifact_data: dict[str, dict[str, object]] = {}
        for output in outputs or []:
            path = Path(output)
            if not path.is_file() or path.stat().st_size <= 0:
                raise FileNotFoundError(f"Cannot cache missing artifact: {path}")
            artifact_data[str(path.resolve())] = {
                "size": path.stat().st_size,
                "sha256": self.file_hash(path),
            }
        with self._lock, self._process_lock():
            self.index = self._load_index()
            self.index.setdefault("stages", {})[stage] = {"key": key, "outputs": artifact_data}
            write_json_atomic(self.index_path, self.index)

    def invalidate(self, *stages: str) -> None:
        with self._lock, self._process_lock():
            self.index = self._load_index()
            data = self.index.setdefault("stages", {})
            for stage in stages:
                data.pop(stage, None)
            write_json_atomic(self.index_path, self.index)
