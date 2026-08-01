"""
Шаг 12. Создание проекта песни.
Собирает все файлы предыдущих шагов в единую структуру:

Song/
├── instrumental.wav
├── vocals.wav
├── pitch.json
├── reference.json
├── lyrics.json        (lyricsSync.json)
├── music.json
├── difficulty.json
├── songMap.json
├── songInfo.json
└── cover.jpg           (опционально)
"""
import argparse
import json
import shutil
from pathlib import Path

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


def build_project(project_dir: str, **sources):
    """
    sources: song_info=path, instrumental=path, vocals=path, pitch=path,
             reference=path, lyrics_sync=path, music=path, breaths=path,
             difficulty=path, song_map=path, cover=path (любые опциональны)
    """
    project_dir = Path(project_dir)
    project_dir.mkdir(parents=True, exist_ok=True)

    copied = {}
    for key, target_name in FILES_MAP.items():
        src = sources.get(key)
        if src and Path(src).exists():
            src_path = Path(src).resolve()
            dst = project_dir / target_name
            dst_path = dst.resolve()
            if src_path != dst_path:
                shutil.copy(src_path, dst_path)
            copied[key] = str(dst)

    # манифест проекта — что уже готово
    manifest = {
        "project": project_dir.name,
        "files": copied,
        "complete": all(k in copied for k in
                         ["instrumental", "vocals", "pitch", "reference",
                          "lyrics_sync", "music", "song_map"]),
    }
    with open(project_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return manifest


def main():
    parser = argparse.ArgumentParser(description="Сборка финального проекта песни")
    parser.add_argument("project_dir", help="Папка проекта, напр. Song/")
    for key in FILES_MAP:
        parser.add_argument(f"--{key.replace('_', '-')}", default=None)
    args = parser.parse_args()

    sources = {key: getattr(args, key) for key in FILES_MAP}
    manifest = build_project(args.project_dir, **sources)

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    if manifest["complete"]:
        print("\n✅ Проект полностью готов для караоке.")
    else:
        missing = [k for k in ["instrumental", "vocals", "pitch", "reference",
                                "lyrics_sync", "music", "song_map"]
                   if k not in manifest["files"]]
        print(f"\n⚠️  Не хватает: {', '.join(missing)}")


if __name__ == "__main__":
    main()
