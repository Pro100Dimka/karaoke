"""
Запуск AI-пайплайна (AI/run_all.py) в фоне и отслеживание прогресса.

run_all.py уже печатает прогресс по шагам в духе "3/13 ...". Мы не лезем
внутрь AI-кода, чтобы не плодить точки соприкосновения — вместо этого
перехватываем stdout в отдельном потоке, парсим такие строки регуляркой и
пишем прогресс в БД. Так AI-пакет остаётся полностью независимым от backend'а.
"""
import contextlib
import io
import re
import threading
import traceback
from pathlib import Path

import config
import models
from database import SessionLocal
from app.services import ai_bridge, cache_service

_STEP_RE = re.compile(r"(?P<step>\d+(?:\.\d+)?)\s*/\s*13")

# песни, которые прямо сейчас обрабатываются (song_id -> Thread) — чтобы не
# запускать одну и ту же песню повторно, пока предыдущий запуск не завершился
_active_jobs: dict[str, threading.Thread] = {}
_active_jobs_lock = threading.Lock()


class _ProgressCapture(io.TextIOBase):
    """Файлоподобный объект: пишет во внутренний лог-файл И вытаскивает
    последнюю замеченную "N/13" для обновления прогресса в БД."""

    def __init__(self, song_id: str, log_path: Path):
        self._song_id = song_id
        self._log_file = open(log_path, "a", encoding="utf-8")

    def write(self, text: str) -> int:
        self._log_file.write(text)
        self._log_file.flush()
        match = _STEP_RE.search(text)
        if match:
            step = match.group("step")
            _update_progress(self._song_id, step_label=f"{step}/13", percent=_percent_from_step(step))
        return len(text)

    def flush(self) -> None:
        self._log_file.flush()

    def close(self) -> None:
        self._log_file.close()


def _percent_from_step(step_str: str) -> float:
    try:
        return round(min(100.0, (float(step_str) / 13.0) * 100.0), 1)
    except ValueError:
        return 0.0


def _update_progress(song_id: str, step_label: str | None = None, percent: float | None = None,
                      status: models.SongStatus | None = None, error_message: str | None = None) -> None:
    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == song_id).first()
        if song is None:
            return
        if step_label is not None:
            song.progress_step = step_label
        if percent is not None:
            song.progress_percent = percent
        if status is not None:
            song.status = status
        if error_message is not None:
            song.error_message = error_message
        db.commit()
    finally:
        db.close()


def is_processing(song_id: str) -> bool:
    with _active_jobs_lock:
        thread = _active_jobs.get(song_id)
        return thread is not None and thread.is_alive()


def start_processing(song_id: str) -> bool:
    """Запускает обработку в фоновом потоке. Возвращает False, если песня
    уже обрабатывается (чтобы не плодить параллельные запуски одной и той же
    песни)."""
    with _active_jobs_lock:
        if is_processing(song_id):
            return False
        thread = threading.Thread(target=_run_job, args=(song_id,), daemon=True)
        _active_jobs[song_id] = thread
        thread.start()
    return True


def _run_job(song_id: str) -> None:
    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == song_id).first()
        if song is None:
            return
        source_path = song.source_path
        slug = song.slug
    finally:
        db.close()

    _update_progress(song_id, status=models.SongStatus.PROCESSING, percent=0.0, step_label="0/13")

    out_dir = config.SONG_OUTPUT_DIR / slug
    log_dir = out_dir / config.LOGS_DIRNAME
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "pipeline.log"

    capture = _ProgressCapture(song_id, log_path)
    try:
        run_pipeline = ai_bridge.get_run_all_pipeline()
        with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
            # run_all.run(input_mp3, out_dir, ...) — out_dir тут должен быть
            # УЖЕ конечной папкой песни (Song/<slug>), а не родительским Song/:
            # именно так его вызывает и сам run_all.py в своём main().
            run_pipeline(
                source_path,
                str(out_dir),
                whisper_model=config.DEFAULT_WHISPER_MODEL,
                language=config.DEFAULT_LANGUAGE,
            )
    except Exception as exc:  # noqa: BLE001 — сознательно широкий catch: это фоновый воркер
        capture.write(f"\n[backend] ОШИБКА: {exc}\n{traceback.format_exc()}\n")
        _update_progress(
            song_id,
            status=models.SongStatus.ERROR,
            error_message=str(exc),
        )
        return
    finally:
        capture.close()

    _finalize_success(song_id, out_dir)


def _finalize_success(song_id: str, out_dir: Path) -> None:
    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == song_id).first()
        if song is None:
            return
        song.output_dir = str(out_dir)
        song.status = models.SongStatus.DONE
        song.progress_percent = 100.0
        song.progress_step = "13/13"
        song.error_message = None
        db.commit()
    finally:
        db.close()

    # Пост-обработка: перевод тяжёлых wav в mp3 + чистка временных файлов.
    # Не должна валить успешно завершённый пайплайн, если что-то пойдёт не так.
    try:
        cache_service.optimize_song_files(song_id)
    except Exception:  # noqa: BLE001
        pass
