from __future__ import annotations

import hashlib
import json
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

    def key_matches(self, *_args) -> bool:
        return False

    def hit(self, *_args, **_kwargs) -> bool:
        return False

    def commit(self, _stage, _key, outputs=None) -> None:
        if missing := [str(path) for path in outputs or [] if not Path(path).is_file()]:
            raise FileNotFoundError(", ".join(missing))

    def invalidate(self, *_stages) -> None:
        return None
