"""Assemble generated artefacts into the final song project directory."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from src.common.json_io import save_json

FILES_MAP = {
    "song_info": "songInfo.json",
    "instrumental": "instrumental.wav",
    "vocals": "vocals.wav",
    "pitch": "pitch.json",
    "reference": "reference.json",
    "lyrics_sync": "lyrics.json",
    "music": "music.json",
    "breaths": "breaths.json",
    "difficulty": "difficulty.json",
    "song_map": "songMap.json",
    "midi": "melody.mid",
    "cover": "cover.jpg",
}
REQUIRED_PROJECT_FILES = frozenset(
    {"instrumental", "vocals", "pitch", "reference", "lyrics_sync", "music", "song_map"}
)


def _copy_source(source: str | Path, destination: Path) -> bool:
    source_path = Path(source)
    if not source_path.is_file():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source_path.resolve() != destination.resolve():
        shutil.copy2(source_path, destination)
    return True


def build_project(project_dir: str, **sources):
    project = Path(project_dir)
    project.mkdir(parents=True, exist_ok=True)

    copied = {}
    for key, target_name in FILES_MAP.items():
        source = sources.get(key)
        destination = project / target_name
        if source and _copy_source(source, destination):
            copied[key] = str(destination)

    manifest = {
        "project": project.name,
        "files": copied,
        "complete": REQUIRED_PROJECT_FILES.issubset(copied),
    }
    save_json(manifest, project / "manifest.json")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка финального проекта песни")
    parser.add_argument("project_dir", help="Папка проекта, напр. Song/")
    for key in FILES_MAP:
        parser.add_argument(f"--{key.replace('_', '-')}", default=None)
    args = parser.parse_args()

    manifest = build_project(
        args.project_dir, **{key: getattr(args, key) for key in FILES_MAP}
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    if manifest["complete"]:
        print("\n✅ Проект полностью готов для караоке.")
    else:
        missing = sorted(REQUIRED_PROJECT_FILES.difference(manifest["files"]))
        print(f"\n⚠️  Не хватает: {', '.join(missing)}")


if __name__ == "__main__":
    main()
