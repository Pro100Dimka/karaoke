from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path


class StageCache:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def file_hash(path: str | Path, block=1024 * 1024) -> str:
        digest = hashlib.sha256()
        with Path(path).open("rb") as stream:
            while chunk := stream.read(block):
                digest.update(chunk)
        return digest.hexdigest()

    def optional_file_hash(self, path):
        return self.file_hash(path) if path and Path(path).is_file() else None

    @staticmethod
    def key(stage: str, payload: dict) -> str:
        return hashlib.sha256(json.dumps([stage, payload], sort_keys=True, default=str).encode()).hexdigest()

    def _metadata_path(self, stage: str) -> Path:
        safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in str(stage))
        return self.root / f"{safe}.json"

    def key_matches(self, stage: str, key: str) -> bool:
        try:
            data = json.loads(self._metadata_path(stage).read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, ValueError, TypeError):
            return False
        return data.get("key") == key

    def hit(self, stage: str, key: str, outputs=None) -> bool:
        return self.key_matches(stage, key) and all(Path(path).is_file() for path in outputs or ())

    def commit(self, stage, key, outputs=None) -> None:
        if missing := [str(path) for path in outputs or [] if not Path(path).is_file()]:
            raise FileNotFoundError(", ".join(missing))
        metadata = self._metadata_path(stage)
        handle, temporary = tempfile.mkstemp(prefix=f".{metadata.name}.", dir=self.root)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump({"key": str(key)}, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, metadata)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def invalidate(self, *stages) -> None:
        targets = (self._metadata_path(stage) for stage in stages) if stages else self.root.glob("*.json")
        for target in targets:
            target.unlink(missing_ok=True)
