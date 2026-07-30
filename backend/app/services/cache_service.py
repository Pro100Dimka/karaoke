"""
Кэш и производительность: сколько места занято, что можно почистить,
пост-обработка результатов AI (перевод тяжёлых wav в mp3, удаление
промежуточных файлов после успешной сборки песни).
"""
import shutil
import subprocess
from pathlib import Path

import config
import models
from database import SessionLocal

# Промежуточные артефакты AI-пайплайна, которые не нужны после того как
# финальные результаты (json/mid/mp3) уже посчитаны.
_HEAVY_INTERMEDIATE_DIRNAMES = ("separated", "tmp", "__pycache__")
_HEAVY_KEEP_AS_MP3 = ("song.wav", "vocals.wav", "instrumental.wav")


def _encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    """AI/src/build/convert.py умеет писать только PCM (wav) — его convert()
    жёстко ставит pcm_s16le/pcm_s24le кодек независимо от расширения
    выходного файла, так что для сжатия в mp3 здесь отдельный, прямой вызов
    ffmpeg с libmp3lame."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(wav_path),
            "-codec:a", "libmp3lame", "-qscale:a", "2",
            str(mp3_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def _dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _human(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def cache_size() -> dict:
    breakdown = {
        "full_songs": _dir_size_bytes(config.FULL_SONGS_DIR),
        "song_results": _dir_size_bytes(config.SONG_OUTPUT_DIR),
        "database": Path(config.DB_PATH).stat().st_size if Path(config.DB_PATH).exists() else 0,
    }
    total = sum(breakdown.values())
    return {"total_bytes": total, "total_human": _human(total), "breakdown": breakdown}


def free_space() -> dict:
    usage = shutil.disk_usage(config.BASE_DIR)
    return {
        "free_bytes": usage.free,
        "free_human": _human(usage.free),
        "total_bytes": usage.total,
        "total_human": _human(usage.total),
    }


def clear_temp_files() -> int:
    """Удаляет заведомо временные файлы/папки (промежуточные артефакты
    сепарации и т.п.) во всех Song/<slug>/. Не трогает финальные результаты."""
    freed = 0
    if not config.SONG_OUTPUT_DIR.exists():
        return 0
    for song_dir in config.SONG_OUTPUT_DIR.iterdir():
        if not song_dir.is_dir():
            continue
        for name in _HEAVY_INTERMEDIATE_DIRNAMES:
            target = song_dir / name
            if target.exists():
                freed += _dir_size_bytes(target)
                shutil.rmtree(target, ignore_errors=True)
    return freed


def optimize_song_files(song_id: str) -> dict:
    """Пост-обработка одной песни после успешной сборки:
    - конвертирует тяжёлые wav (song/vocals/instrumental) в mp3;
    - удаляет исходные wav и промежуточные артефакты сепарации;
    - оставляет мелодию (melody.mid) и все json как есть — они лёгкие и
      нужны как есть.
    Идемпотентна: повторный вызов на уже оптимизированной песне ничего не
    ломает, просто не находит, что делать."""
    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == song_id).first()
        if song is None or not song.output_dir:
            return {"song_id": song_id, "freed_bytes": 0, "freed_human": "0.0 B", "actions": []}

        out_dir = Path(song.output_dir)
        actions: list[str] = []
        freed = 0

        for wav_name in _HEAVY_KEEP_AS_MP3:
            wav_path = out_dir / wav_name
            if not wav_path.exists():
                continue
            mp3_path = wav_path.with_suffix(".mp3")
            try:
                _encode_mp3(wav_path, mp3_path)
            except Exception:
                # если конвертация не удалась — не удаляем исходник, лучше
                # оставить тяжёлый wav, чем потерять файл вовсе
                continue
            freed += wav_path.stat().st_size
            wav_path.unlink()
            actions.append(f"{wav_name} -> {mp3_path.name}")

        for name in _HEAVY_INTERMEDIATE_DIRNAMES:
            target = out_dir / name
            if target.exists():
                freed += _dir_size_bytes(target)
                shutil.rmtree(target, ignore_errors=True)
                actions.append(f"удалена временная папка {name}/")

        song.optimized = True
        db.commit()

        return {"song_id": song_id, "freed_bytes": freed, "freed_human": _human(freed), "actions": actions}
    finally:
        db.close()
