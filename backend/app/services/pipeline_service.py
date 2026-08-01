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
import shutil
import threading
import time
import traceback
from pathlib import Path
from typing import TextIO, cast

import config
import models
from app.services import ai_bridge, cache_service
from database import SessionLocal

_STEP_RE = re.compile(r"(?P<step>\d+(?:\.\d+)?)\s*/\s*13")

# песни, которые прямо сейчас обрабатываются (song_id -> Thread) — чтобы не
# запускать одну и ту же песню повторно, пока предыдущий запуск не завершился
_active_jobs: dict[str, threading.Thread] = {}
_active_jobs_lock = threading.RLock()
_cancelled_jobs: set[str] = set()
_progress_runtime: dict[str, dict] = {}
_progress_runtime_lock = threading.RLock()

# The expensive AI stages receive a larger share of the indicator.  This makes
# progress meaningful instead of pretending that thirteen very different jobs
# each take the same amount of time.
_STEP_PLAN = {
    1.0: (0.0, 3.0, 3), 2.0: (3.0, 7.0, 12), 3.0: (7.0, 28.0, 120),
    3.5: (28.0, 33.0, 20), 4.0: (33.0, 39.0, 18), 5.0: (39.0, 58.0, 90),
    6.0: (58.0, 65.0, 16), 7.0: (65.0, 69.0, 14), 8.0: (69.0, 79.0, 70),
    9.0: (79.0, 89.0, 70), 9.5: (89.0, 92.0, 12), 10.0: (92.0, 95.0, 10),
    11.0: (95.0, 97.0, 8), 11.5: (97.0, 98.0, 8), 12.0: (98.0, 99.0, 7),
    13.0: (99.0, 99.7, 5),
}


class ProcessingCancelled(RuntimeError):
    """Raised at a safe pipeline boundary after a user cancellation."""


class _ProgressCapture(io.TextIOBase):
    """Файлоподобный объект: пишет во внутренний лог-файл И вытаскивает
    последнюю замеченную "N/13" для обновления прогресса в БД."""

    def __init__(self, song_id: str, log_path: Path):
        self._song_id = song_id
        # The stream deliberately stays open for the lifetime of the capture.
        self._log_file = open(log_path, "a", encoding="utf-8")  # noqa: SIM115

    def write(self, text: str) -> int:
        if _is_cancelled(self._song_id):
            raise ProcessingCancelled("Processing cancelled by user")
        self._log_file.write(text)
        self._log_file.flush()
        match = _STEP_RE.search(text)
        if match:
            step = match.group("step")
            _set_runtime_step(self._song_id, float(step), text)
            _update_progress(
                self._song_id,
                step_label=f"{step}/13",
                percent=_percent_from_step(step),
            )
        elif text.strip():
            _set_runtime_detail(self._song_id, text)
        return len(text)

    def flush(self) -> None:
        self._log_file.flush()

    def close(self) -> None:
        self._log_file.close()


def _percent_from_step(step_str: str) -> float:
    try:
        step = float(step_str)
        return _STEP_PLAN.get(step, (min(99.0, step / 13.0 * 100.0), 100.0, 1))[0]
    except ValueError:
        return 0.0


def _set_runtime_step(song_id: str, step: float, log_line: str) -> None:
    detail = log_line.strip().splitlines()[0]
    detail = re.sub(r"^\d+(?:\.\d+)?\s*/\s*13\s*", "", detail).strip(" .—-")
    with _progress_runtime_lock:
        runtime = _progress_runtime.setdefault(song_id, {"started_at": time.monotonic()})
        runtime.update({"step": step, "step_started_at": time.monotonic(), "detail": detail[:120]})


def _set_runtime_detail(song_id: str, log_text: str) -> None:
    detail = log_text.strip().splitlines()[-1].strip()
    if not detail or len(detail) > 160:
        return
    with _progress_runtime_lock:
        runtime = _progress_runtime.get(song_id)
        if runtime:
            runtime["detail"] = detail


def _begin_runtime_progress(song_id: str) -> None:
    with _progress_runtime_lock:
        _progress_runtime[song_id] = {
            "started_at": time.monotonic(),
            "step": 0.0,
            "step_started_at": time.monotonic(),
            "detail": "Подготовка AI-пайплайна",
        }


def _end_runtime_progress(song_id: str) -> None:
    with _progress_runtime_lock:
        _progress_runtime.pop(song_id, None)


def get_processing_telemetry(song_id: str) -> dict:
    """Return live sub-step, weighted percent and a conservative ETA."""
    with _progress_runtime_lock:
        runtime = dict(_progress_runtime.get(song_id, {}))
    if not runtime:
        return {}

    now = time.monotonic()
    step = float(runtime.get("step", 0.0))
    base, end, expected = _STEP_PLAN.get(step, (0.0, 1.0, 10))
    elapsed_step = max(0.0, now - runtime.get("step_started_at", now))
    # Move smoothly inside a stage but never claim completion before the next
    # real pipeline signal arrives.
    fraction = min(0.94, elapsed_step / max(1, expected))
    percent = round(base + (end - base) * fraction, 1)
    remaining = max(0.0, expected - elapsed_step)
    for plan_step, (_, _, seconds) in _STEP_PLAN.items():
        if plan_step > step:
            remaining += seconds
    return {
        "step": step,
        "progress_percent": percent,
        "progress_detail": runtime.get("detail"),
        "eta_seconds": max(1, int(round(remaining))),
    }


def _progress_heartbeat(song_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(1.0):
        telemetry = get_processing_telemetry(song_id)
        if telemetry:
            step = telemetry["step"]
            detail = telemetry.get("progress_detail") or "Обработка AI"
            _update_progress(
                song_id,
                step_label=f"{step:g}/13 · {detail}",
                percent=telemetry["progress_percent"],
            )


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
        _cancelled_jobs.discard(song_id)
        if is_processing(song_id):
            return False
        thread = threading.Thread(target=_run_job, args=(song_id,), daemon=True)
        _active_jobs[song_id] = thread
        thread.start()
    return True


def start_reprocessing(song_id: str) -> bool:
    """Start a clean full reprocessing run for one song."""
    with _active_jobs_lock:
        _cancelled_jobs.discard(song_id)
        if is_processing(song_id):
            return False
        thread = threading.Thread(
            target=_run_reprocessing, args=(song_id,), daemon=True
        )
        _active_jobs[song_id] = thread
        thread.start()
    return True


def cancel_processing(song_id: str) -> bool:
    """Request cancellation without terminating a worker thread unsafely."""
    with _active_jobs_lock:
        if not is_processing(song_id):
            return False
        _cancelled_jobs.add(song_id)
    _update_progress(song_id, status=models.SongStatus.CANCELLED)
    return True


def _is_cancelled(song_id: str) -> bool:
    with _active_jobs_lock:
        return song_id in _cancelled_jobs


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

    if _is_cancelled(song_id):
        return

    if _is_cancelled(song_id):
        return
    _update_progress(song_id, status=models.SongStatus.PROCESSING, percent=0.0, step_label="0/13")
    _begin_runtime_progress(song_id)
    heartbeat_stop = threading.Event()
    heartbeat = threading.Thread(
        target=_progress_heartbeat,
        args=(song_id, heartbeat_stop),
        daemon=True,
    )
    heartbeat.start()

    out_dir = config.SONG_OUTPUT_DIR / slug
    log_dir = out_dir / config.LOGS_DIRNAME
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "pipeline.log"

    capture = _ProgressCapture(song_id, log_path)
    try:
        run_pipeline = ai_bridge.get_run_all_pipeline()
        with (
            contextlib.redirect_stdout(cast(TextIO, capture)),
            contextlib.redirect_stderr(cast(TextIO, capture)),
        ):
            # run_all.run(input_mp3, out_dir, ...) — out_dir тут должен быть
            # УЖЕ конечной папкой песни (Song/<slug>), а не родительским Song/:
            # именно так его вызывает и сам run_all.py в своём main().
            run_pipeline(
                source_path,
                str(out_dir),
                whisper_model=config.DEFAULT_WHISPER_MODEL,
                language=config.DEFAULT_LANGUAGE,
            )
    except ProcessingCancelled:
        _update_progress(song_id, status=models.SongStatus.CANCELLED, step_label="Отменено")
        return
    except Exception as exc:  # noqa: BLE001 — сознательно широкий catch: это фоновый воркер
        if _is_cancelled(song_id):
            _update_progress(song_id, status=models.SongStatus.CANCELLED, step_label="Отменено")
            return
        capture.write(f"\n[backend] ОШИБКА: {exc}\n{traceback.format_exc()}\n")
        _update_progress(
            song_id,
            status=models.SongStatus.ERROR,
            error_message=str(exc),
        )
        return
    finally:
        capture.close()
        heartbeat_stop.set()
        _end_runtime_progress(song_id)
        with _active_jobs_lock:
            _active_jobs.pop(song_id, None)

    if not _is_cancelled(song_id):
        _finalize_success(song_id, out_dir)


def _run_reprocessing(song_id: str) -> None:
    """Safely clear generated files, then run the regular full pipeline."""
    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == song_id).first()
        if song is None:
            return
        out_dir = Path(song.output_dir) if song.output_dir else config.SONG_OUTPUT_DIR / song.slug
    finally:
        db.close()

    try:
        output_root = config.SONG_OUTPUT_DIR.resolve()
        target_dir = out_dir.resolve()
        if target_dir.parent != output_root:
            raise ValueError("Недопустимый путь к результатам песни")
        if target_dir.exists():
            shutil.rmtree(target_dir)
    except Exception as exc:  # noqa: BLE001
        if _is_cancelled(song_id):
            _update_progress(song_id, status=models.SongStatus.CANCELLED, step_label="Отменено")
            return
        _update_progress(
            song_id,
            status=models.SongStatus.ERROR,
            error_message=f"Не удалось очистить старые результаты: {exc}",
        )
        return

    _run_job(song_id)


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
    with contextlib.suppress(Exception):
        cache_service.optimize_song_files(song_id)
