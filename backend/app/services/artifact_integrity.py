
from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.utils.hashing import sha256_file


def refresh_manifest_integrity(
    root: Path,
    manifest: dict[str, Any],
    relatives: Iterable[str],
    *,
    remove_missing: bool = False,
) -> None:
    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict): return
    integrity = manifest.get("integrity")
    if not isinstance(integrity, dict):
        integrity = {}
        manifest["integrity"] = integrity
    wanted = set(relatives)
    for key, relative in list(outputs.items()):
        if not isinstance(relative, str) or relative not in wanted: continue
        artifact = root / relative
        if not artifact.is_file():
            if remove_missing:
                outputs.pop(key, None)
                integrity.pop(key, None)
            continue
        integrity[key] = {"size": artifact.stat().st_size, "sha256": sha256_file(artifact)}
