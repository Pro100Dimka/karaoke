
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPS = Path(os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload, *, ensure_ascii=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=ensure_ascii, indent=2),
        encoding="utf-8",
    )


def reset_cached_tree(source: Path, target: Path, invalidated):
    if target.exists(): shutil.rmtree(target)
    shutil.copytree(source, target); index_path = target / ".ai-cache/index.json"; cache = json.loads(index_path.read_text(encoding="utf-8"))
    for stage in cache["stages"].values():
        stage["outputs"] = {
            str(target / Path(path).relative_to(source)): metadata
            for path, metadata in stage["outputs"].items()
        }
    write_json(index_path, cache)
    for name in invalidated: (target / name).unlink(missing_ok=True)

def ffmpeg(source: Path, target: Path, *arguments: str, required="ffmpeg is required"):
    import subprocess

    executable = shutil.which("ffmpeg")
    if not executable: raise RuntimeError(required)
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [executable, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), *arguments, str(target)],
        check=True,
    )
