"""
Кэш и производительность: сколько места занято, что можно почистить,
пост-обработка результатов AI (перевод тяжёлых wav в mp3, удаление
промежуточных файлов после успешной сборки песни).
"""

import copy
import shutil
import subprocess
from pathlib import Path, PurePosixPath

import config
from app import repositories
from app.services import artifact_integrity, revision_cache, song_service
from app.services.db_utils import commit
from app.utils.json_files import read_json, write_json
from database import SessionLocal

# Промежуточные артефакты AI-пайплайна, которые не нужны после того как
# финальные результаты (json/mid/mp3) уже посчитаны.
_HEAVY_INTERMEDIATE_DIRNAMES = ("tmp", "__pycache__")
_HEAVY_KEEP_AS_MP3 = ("song.wav",)
_LOSSLESS_STEMS = ("separated/vocals.wav", "separated/instrumental.wav")


def _run_ffmpeg_transcode(wav_path: Path, output_path: Path, *codec_args: str) -> None:
    subprocess.run(
        [config.FFMPEG_EXE, "-y", "-i", str(wav_path), *codec_args, str(output_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def _encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    """AI/src/build/convert.py умеет писать только PCM (wav) — его convert()
    жёстко ставит pcm_s16le/pcm_s24le кодек независимо от расширения
    выходного файла, так что для сжатия в mp3 здесь отдельный, прямой вызов
    ffmpeg с libmp3lame."""
    _run_ffmpeg_transcode(wav_path, mp3_path, "-codec:a", "libmp3lame", "-b:a", "320k")


def _encode_flac(wav_path: Path, flac_path: Path) -> None:
    """Compress AI stems losslessly so they remain a reusable processing cache."""
    _run_ffmpeg_transcode(wav_path, flac_path, "-codec:a", "flac", "-compression_level", "5")



def _retarget_manifest_output(out_dir: Path, old_relative: str, new_relative: str) -> bool:
    """Atomically retarget tracked output/integrity before deleting its old artifact."""
    manifest_path = out_dir / "manifest.json"
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("outputs"), dict):
        return False
    outputs = manifest["outputs"]
    keys = [key for key, relative in outputs.items() if relative == old_relative]
    if not keys:
        return False
    for key in keys:
        outputs[key] = new_relative
    artifact_integrity.refresh_manifest_integrity(out_dir, manifest, {new_relative})
    write_json(manifest_path, manifest)
    return True


_OPTIMIZATION_JOURNAL = ".optimization-journal.json"


def _safe_journal_path(out_dir: Path, value: object) -> Path:
    """Resolve one journal entry without ever allowing it to escape the song root."""
    if not isinstance(value, str) or not value or any(token in value for token in ("\\", ":", "\x00")):
        raise ValueError("Optimization journal contains an unsafe path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("Optimization journal contains an unsafe path")
    root = out_dir.resolve()
    candidate = (root / Path(*relative.parts)).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("Optimization journal path escapes the song directory")
    return candidate


def _journal_paths(out_dir: Path, journal: dict, key: str) -> list[Path]:
    values = journal.get(key, [])
    if not isinstance(values, list):
        raise ValueError("Optimization journal is invalid")
    return [_safe_journal_path(out_dir, value) for value in values]


def _restore_precommit_optimization(out_dir: Path, journal: dict) -> None:
    # Validate every executable path before performing the first filesystem mutation.
    created = _journal_paths(out_dir, journal, "created")
    _journal_paths(out_dir, journal, "retire")
    manifest_before = journal.get("manifest_before")
    if manifest_before is not None and not isinstance(manifest_before, dict):
        raise ValueError("Optimization journal is invalid")
    if isinstance(manifest_before, dict):
        write_json(out_dir / "manifest.json", manifest_before)
    for path in created:
        path.unlink(missing_ok=True)
    (out_dir / _OPTIMIZATION_JOURNAL).unlink(missing_ok=True)


def _recover_optimization(out_dir: Path, *, committed: bool) -> None:
    journal_path = out_dir / _OPTIMIZATION_JOURNAL
    journal: object = read_json(journal_path, default={})
    if not isinstance(journal, dict) or not journal:
        return
    # Journal is local transient state. Invalid recovery metadata fails closed;
    # it is never interpreted as a path and never mutates files outside out_dir.
    if not committed:
        _restore_precommit_optimization(out_dir, journal)
        return
    retire = _journal_paths(out_dir, journal, "retire")
    _journal_paths(out_dir, journal, "created")
    published_outputs = journal.get("published_outputs")
    published_integrity = journal.get("published_integrity")
    # Round16 journals did not carry generation identity. Never infer that an
    # old boolean optimized flag authorizes deletion of reusable path names.
    if not isinstance(published_outputs, dict) or not isinstance(published_integrity, dict):
        journal_path.unlink(missing_ok=True)
        return
    current_manifest: object = read_json(out_dir / "manifest.json", default={})
    current_outputs = current_manifest.get("outputs") if isinstance(current_manifest, dict) else None
    current_integrity = current_manifest.get("integrity") if isinstance(current_manifest, dict) else None
    if not isinstance(current_outputs, dict) or not isinstance(current_integrity, dict):
        raise ValueError("Current processing manifest is invalid")
    # A committed journal may survive until a later reprocess generation. Path
    # names are reusable, so require both logical mappings and hashes/sizes from
    # the exact compressed generation before retiring any old WAV path.
    if (
        any(current_outputs.get(key) != value for key, value in published_outputs.items())
        or any(current_integrity.get(key) != value for key, value in published_integrity.items())
    ):
        journal_path.unlink(missing_ok=True)
        return
    for path in retire:
        path.unlink(missing_ok=True)
    journal_path.unlink(missing_ok=True)


def _prepare_optimization(out_dir: Path, actions: list[str]) -> tuple[dict, list[str], list[str]]:
    """Prepare an all-or-nothing optimization generation.

    A failed encoder leaves the song retryable: no partial manifest is published
    and every compressed file created by this attempt is removed.
    """
    manifest = read_json(out_dir / "manifest.json")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("outputs"), dict):
        raise ValueError("Song processing manifest is invalid")
    updated = copy.deepcopy(manifest)
    created: list[str] = []
    retire: list[str] = []

    conversions = [("song.wav", ".mp3", _encode_mp3)] + [
        (relative, ".flac", _encode_flac) for relative in _LOSSLESS_STEMS
    ]
    try:
        for relative, suffix, encoder in conversions:
            source = out_dir / relative
            if not source.is_file():
                continue
            target = source.with_suffix(suffix)
            # Any sidecar while the canonical WAV still exists is disposable
            # generated state from an interrupted/older optimization attempt.
            target.unlink(missing_ok=True)
            target.parent.mkdir(parents=True, exist_ok=True)
            encoder(source, target)
            if not target.is_file() or target.stat().st_size <= 0:
                raise RuntimeError(f"Optimization encoder produced no output: {relative}")
            target_relative = target.relative_to(out_dir).as_posix()
            tracked_keys = [
                key for key, value in updated["outputs"].items() if value == relative
            ]
            if relative == "separated/instrumental.wav" and not tracked_keys:
                raise ValueError("Song processing manifest does not track instrumental.wav")
            trial = copy.deepcopy(updated)
            for key in tracked_keys:
                trial["outputs"][key] = target_relative
            artifact_integrity.refresh_manifest_integrity(out_dir, trial, {target_relative})
            updated = trial
            created.append(target_relative)
            retire.append(relative)
            label = " (lossless)" if suffix == ".flac" else ""
            actions.append(f"{relative} -> {target.name}{label}")
    except Exception:
        for relative in created:
            _safe_journal_path(out_dir, relative).unlink(missing_ok=True)
        # The currently failing target may have been created before the encoder raised.
        for relative, suffix, _encoder in conversions:
            source = out_dir / relative
            if source.is_file():
                source.with_suffix(suffix).unlink(missing_ok=True)
        raise
    for key in ("song", "vocals", "instrumental"):
        relative = updated["outputs"].get(key)
        if relative is None:
            continue
        if not isinstance(relative, str) or not _safe_journal_path(out_dir, relative).is_file():
            raise ValueError(f"Optimization would leave a missing {key} artifact")
    return updated, created, retire

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
        flac_relative = flac_path.relative_to(out_dir).as_posix()
        try:
            _encode_flac(wav_path, flac_path)
            tracked = _retarget_manifest_output(out_dir, wav_name, flac_relative)
            if wav_name == "separated/instrumental.wav" and not tracked:
                flac_path.unlink(missing_ok=True)
                continue
        except Exception:
            flac_path.unlink(missing_ok=True)
            continue
        freed += max(0, wav_path.stat().st_size - flac_path.stat().st_size)
        wav_path.unlink()
        actions.append(f"{wav_name} -> {flac_path.name} (lossless)")
    return freed


def recover_optimization_state(out_dir: Path, *, committed: bool) -> None:
    """Recover one local optimization transaction before a new generation mutates paths."""
    _recover_optimization(out_dir, committed=committed)


def recover_optimization_transactions() -> None:
    """Recover durable optimization journals at backend startup."""
    db = SessionLocal()
    try:
        for song in song_service.list_songs(db):
            try:
                out_dir = song_service.resolve_output_dir(song)
                if (out_dir / _OPTIMIZATION_JOURNAL).is_file():
                    with song_service.song_content_lock(song.id), song_service.library_write_lock():
                        db.refresh(song)
                        _recover_optimization(out_dir, committed=bool(song.optimized))
                        revision_cache.invalidate(song)
            except Exception:
                db.rollback()
                continue
    finally:
        db.close()


def optimize_song_files(song_id: str) -> dict:
    """Optimize generated audio without exposing DB/filesystem split-brain state."""
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None or not song.output_dir:
            return _optimization_result(song_id)

        with song_service.song_content_lock(song_id), song_service.library_write_lock():
            db.refresh(song)
            out_dir = song_service.resolve_output_dir(song)
            _recover_optimization(out_dir, committed=bool(song.optimized))
            actions: list[str] = []
            manifest_before = read_json(out_dir / "manifest.json")
            if not isinstance(manifest_before, dict):
                raise ValueError("Song processing manifest is invalid")
            created: list[str] = []
            retire: list[str] = []
            try:
                updated_manifest, created, retire = _prepare_optimization(out_dir, actions)
                published_outputs = {
                    key: value for key, value in updated_manifest.get("outputs", {}).items()
                    if key in {"song", "vocals", "instrumental"}
                }
                integrity = updated_manifest.get("integrity", {})
                published_integrity = {
                    key: copy.deepcopy(integrity.get(key)) for key in published_outputs
                    if isinstance(integrity, dict) and key in integrity
                }
                journal = {
                    "manifest_before": manifest_before,
                    "created": created,
                    "retire": retire,
                    "published_outputs": published_outputs,
                    "published_integrity": published_integrity,
                }
                write_json(out_dir / _OPTIMIZATION_JOURNAL, journal)
                write_json(out_dir / "manifest.json", updated_manifest)
                song.optimized = True
                commit(db)
            except Exception:
                if created or (out_dir / _OPTIMIZATION_JOURNAL).exists():
                    _restore_precommit_optimization(
                        out_dir,
                        read_json(out_dir / _OPTIMIZATION_JOURNAL, default={}) or {
                            "manifest_before": manifest_before,
                            "created": created,
                        },
                    )
                raise

            freed = 0
            for relative in retire:
                old = out_dir / relative
                new = old.with_suffix(".mp3" if relative == "song.wav" else ".flac")
                if old.is_file() and new.is_file():
                    freed += max(0, old.stat().st_size - new.stat().st_size)
                    old.unlink(missing_ok=True)
            (out_dir / _OPTIMIZATION_JOURNAL).unlink(missing_ok=True)
            freed += _remove_intermediate_directories(out_dir, actions)
            # Preserve the original source.* as the authoritative AI input.
            # song.mp3 is only an optimized generated playback/cache artifact.
            revision_cache.invalidate(song)
            return _optimization_result(song_id, freed, actions)
    finally:
        db.close()
