"""
Кэш и производительность: сколько места занято, что можно почистить,
пост-обработка результатов AI (перевод тяжёлых wav в mp3, удаление
промежуточных файлов после успешной сборки песни).
"""

import shutil
import subprocess
from pathlib import Path

import config
from app import repositories
from app.services import song_service
from app.services.db_utils import commit
from database import SessionLocal

# Промежуточные артефакты AI-пайплайна, которые не нужны после того как
# финальные результаты (json/mid/mp3) уже посчитаны.
_HEAVY_INTERMEDIATE_DIRNAMES = ("tmp", "__pycache__")
_HEAVY_KEEP_AS_MP3 = ("song.wav",)
_LOSSLESS_STEMS = ("separated/vocals.wav", "separated/instrumental.wav")


def _encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    """AI/src/build/convert.py умеет писать только PCM (wav) — его convert()
    жёстко ставит pcm_s16le/pcm_s24le кодек независимо от расширения
    выходного файла, так что для сжатия в mp3 здесь отдельный, прямой вызов
    ffmpeg с libmp3lame."""
    subprocess.run(
        [
            config.FFMPEG_EXE,
            "-y",
            "-i",
            str(wav_path),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "320k",
            str(mp3_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def _encode_flac(wav_path: Path, flac_path: Path) -> None:
    """Compress AI stems losslessly so they remain a reusable processing cache."""
    subprocess.run(
        [
            config.FFMPEG_EXE,
            "-y",
            "-i",
            str(wav_path),
            "-codec:a",
            "flac",
            "-compression_level",
            "5",
            str(flac_path),
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
        "karaoke_songs": _dir_size_bytes(config.SONG_OUTPUT_DIR),
        "database": Path(config.DB_PATH).stat().st_size if Path(config.DB_PATH).exists() else 0,
        "cache": _dir_size_bytes(config.CACHE_DIR),
    }
    total = sum(breakdown.values())
    return {"total_bytes": total, "total_human": _human(total), "breakdown": breakdown}


def free_space() -> dict:
    usage = shutil.disk_usage(config.CACHE_DIR)
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


def _optimization_result(song_id: str, freed: int = 0, actions: list[str] | None = None) -> dict:
    return {
        "song_id": song_id,
        "freed_bytes": freed,
        "freed_human": _human(freed),
        "actions": actions or [],
    }


def _remove_intermediate_directories(out_dir: Path, actions: list[str]) -> int:
    freed = 0
    for name in _HEAVY_INTERMEDIATE_DIRNAMES:
        target = out_dir / name
        if not target.exists():
            continue
        freed += _dir_size_bytes(target)
        shutil.rmtree(target, ignore_errors=True)
        actions.append(f"удалена временная папка {name}/")
    return freed


def _convert_heavy_wavs(out_dir: Path, actions: list[str]) -> int:
    freed = 0
    for wav_name in _HEAVY_KEEP_AS_MP3:
        wav_path = out_dir / wav_name
        if not wav_path.exists():
            continue
        mp3_path = wav_path.with_suffix(".mp3")
        mp3_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            _encode_mp3(wav_path, mp3_path)
        except Exception:
            # Preserve the source when conversion fails; losing a large WAV is
            # worse than postponing optimization.
            continue
        freed += max(0, wav_path.stat().st_size - mp3_path.stat().st_size)
        wav_path.unlink()
        actions.append(f"{wav_name} -> {mp3_path.name}")
    for wav_name in _LOSSLESS_STEMS:
        wav_path = out_dir / wav_name
        if not wav_path.exists():
            continue
        flac_path = wav_path.with_suffix(".flac")
        try:
            _encode_flac(wav_path, flac_path)
        except Exception:
            continue
        freed += max(0, wav_path.stat().st_size - flac_path.stat().st_size)
        wav_path.unlink()
        actions.append(f"{wav_name} -> {flac_path.name} (lossless)")
    return freed


def optimize_song_files(song_id: str) -> dict:
    """Convert heavy WAV files and remove disposable pipeline artefacts."""
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None or not song.output_dir:
            return _optimization_result(song_id)

        out_dir = song_service.resolve_output_dir(song)
        actions: list[str] = []
        freed = _convert_heavy_wavs(out_dir, actions)
        freed += _remove_intermediate_directories(out_dir, actions)

        normalized_source = out_dir / "song.mp3"
        previous_source = song_service.resolve_source_path(song)
        if normalized_source.is_file() and previous_source != normalized_source:
            if previous_source.is_file():
                freed += previous_source.stat().st_size
                previous_source.unlink()
                actions.append(f"removed duplicate source {previous_source.name}")
            song.source_path = str(normalized_source)

        song.optimized = True
        commit(db)
        return _optimization_result(song_id, freed, actions)
    finally:
        db.close()
