"""
Запуск AI-пайплайна (AI/run_all.py) в фоне и отслеживание прогресса.

run_all.py уже печатает прогресс по шагам в духе "3/13 ...". Мы не лезем
внутрь AI-кода, чтобы не плодить точки соприкосновения — вместо этого
перехватываем stdout в отдельном потоке, парсим такие строки регуляркой и
пишем прогресс в БД. Так AI-пакет остаётся полностью независимым от backend'а.
"""

import contextlib
import gc
import io
import logging
import os
import re
import sys
import threading
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import TextIO, cast

import config
import models
from AI.cache import StageCache
from AI.notes import NOTE_DECODER_VERSION
from AI.pipeline import KaraokePipeline
from AI.pitch_post import PITCH_STABILIZER_VERSION
from AI.runtime import RuntimePlan, configure_runtime, format_runtime_plan
from AI.version import AI_BUILD_ID
from app import repositories
from app.services import ai_bridge, app_settings_service, cache_service, song_service
from app.services.db_utils import commit
from app.utils.json_files import read_json
from database import SessionLocal

logger = logging.getLogger(__name__)

_STEP_RE = re.compile(r"(?P<step>\d+(?:\.\d+)?)\s*/\s*13")
_NOISY_PROGRESS_RE = re.compile(
    r"(?:warning|traceback|token_id|generation[_ ](?:config|flags)|transformers_verbosity|deprecated|onnxruntime|cudaexecutionprovider)",
    re.IGNORECASE,
)

# песни, которые прямо сейчас обрабатываются (song_id -> Thread) — чтобы не
# запускать одну и ту же песню повторно, пока предыдущий запуск не завершился
_active_jobs: dict[str, threading.Thread] = {}
_active_jobs_lock = threading.RLock()
_cancelled_jobs: set[str] = set()
_progress_runtime: dict[str, dict] = {}
_progress_runtime_lock = threading.RLock()


def _configure_ai_runtime() -> RuntimePlan:
    """Apply persisted compute preferences before lazy AI imports load a runtime."""
    config.configure_ai_resource_environment(force=True)
    settings = app_settings_service.read_settings()
    configured_device = str(settings["compute_mode"])
    override = os.getenv("KARAOKE_AI_RUNTIME_OVERRIDE", "").strip().lower()
    device = override if override in {"auto", "cuda", "cpu"} else configured_device
    thread_count = int(settings["thread_count"])
    os.environ["SONGAPP_DEVICE"] = device
    # NumPy/BLAS honor these on their next initialization; PyTorch is also
    # configured explicitly when it is already available in this process.
    for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[name] = str(thread_count)
    with contextlib.suppress(ImportError, RuntimeError):
        import torch

        torch.set_num_threads(thread_count)
    return configure_runtime(device, force=True)


def _first_audio_tag(tags: object, *names: str) -> str | None:
    """Return the first non-empty easy-tag value without making tags mandatory."""
    get = getattr(tags, "get", None)
    if not callable(get):
        return None
    for name in names:
        value = get(name)
        if isinstance(value, list | tuple):
            value = next((item for item in value if isinstance(item, str) and item.strip()), None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _apply_source_metadata(song: models.Song) -> None:
    """Fill library identity from tags, then from the original filename."""
    try:
        from mutagen import File as MutagenFile

        tags = MutagenFile(song.source_path, easy=True)
    except Exception:
        tags = None

    tagged_title = _first_audio_tag(tags, "title") if tags is not None else None
    tagged_artist = _first_audio_tag(tags, "artist", "albumartist") if tags is not None else None
    filename_artist, filename_title = song_service.parse_filename_identity(song.original_filename)

    if tagged_title:
        song.title = tagged_title
        song.artist = song_service._clean_artist_tag(tagged_artist, tagged_title) or filename_artist
    else:
        if filename_artist:
            song.artist = filename_artist
            song.title = filename_title
        elif not song.title:
            song.title = filename_title

    if not song.genre:
        song.genre = _first_audio_tag(tags, "genre") if tags is not None else None


# The expensive AI stages receive a larger share of the indicator.  This makes
# progress meaningful instead of pretending that thirteen very different jobs
# each take the same amount of time.
_STEP_PLAN = {
    1.0: (0.0, 3.0, 3),
    2.0: (3.0, 7.0, 12),
    3.0: (7.0, 28.0, 120),
    3.5: (28.0, 33.0, 20),
    4.0: (33.0, 39.0, 18),
    5.0: (39.0, 58.0, 90),
    6.0: (58.0, 65.0, 16),
    7.0: (65.0, 69.0, 14),
    8.0: (69.0, 79.0, 70),
    9.0: (79.0, 89.0, 70),
    9.5: (89.0, 92.0, 12),
    10.0: (92.0, 95.0, 10),
    11.0: (95.0, 97.0, 8),
    11.5: (97.0, 98.0, 8),
    12.0: (98.0, 99.0, 7),
    13.0: (99.0, 99.7, 5),
}

# AI Core reports semantic stages instead of the historical N/13 counter.
# Each entry describes the next observable boundary, a conservative duration
# and text intended for a person rather than an internal engine log.
_AI_STAGE_PLAN = {
    "decode": (8.0, 5, "Подготавливаем аудио"),
    "separation": (35.0, 120, "Отделяем голос исполнителя от музыки"),
    "tempo": (55.0, 20, "Определяем темп и тональность"),
    "pitch": (70.0, 45, "Определяем мелодию голоса"),
    "transcription": (82.0, 75, "Распознаём слова песни"),
    "alignment": (82.0, 75, "Синхронизируем слова с голосом"),
    "syllables": (90.0, 15, "Уточняем слоги и вокальные ноты"),
    "midi": (96.0, 10, "Создаём ноты для караоке"),
    "manifest": (99.7, 4, "Проверяем результат"),
    "complete": (99.7, 2, "Завершаем обработку"),
}


class ProcessingCancelled(RuntimeError):
    """Raised at a safe pipeline boundary after a user cancellation."""


class _ProgressCapture(io.TextIOBase):
    """Файлоподобный объект: пишет во внутренний лог-файл И вытаскивает
    последнюю замеченную "N/13" для обновления прогресса в БД."""

    def __init__(self, song_id: str, log_path: Path):
        self._song_id = song_id
        self._lock = threading.RLock()
        self._closed = False
        # The stream deliberately stays open for the lifetime of the capture.
        self._log_file = open(log_path, "a", encoding="utf-8")  # noqa: SIM115

    def write(self, text: str) -> int:
        with self._lock:
            if self._closed:
                raise ValueError("I/O operation on closed progress capture")
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
        with self._lock:
            if not self._closed:
                self._log_file.flush()

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
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
        now = time.monotonic()
        runtime = _progress_runtime.setdefault(
            song_id,
            {
                "started_at": now,
                "step": 0.0,
                "step_started_at": now,
                "completed_step_seconds": {},
            },
        )
        previous_step = float(runtime.get("step", 0.0))

        # A long-running tool may repeat its current "N/13" message.  That
        # is a progress update, not a new stage: resetting its clock here was
        # the source of the jumping and incorrect remaining-time estimate.
        if step <= previous_step:
            runtime["detail"] = detail[:120]
            return

        if previous_step in _STEP_PLAN:
            completed = runtime.setdefault("completed_step_seconds", {})
            completed[previous_step] = max(0.0, now - runtime.get("step_started_at", now))
        runtime.update({"step": step, "step_started_at": now, "detail": detail[:120]})


def _set_runtime_detail(song_id: str, log_text: str) -> None:
    detail = log_text.strip().splitlines()[-1].strip()
    # stdout/stderr is also used by third-party ML libraries.  Their warnings
    # belong in processing.log, never in the user-facing stage label.
    if not detail or len(detail) > 160 or _NOISY_PROGRESS_RE.search(detail):
        return
    with _progress_runtime_lock:
        runtime = _progress_runtime.get(song_id)
        if runtime:
            # Semantic callbacks already supplied a translated stage label.
            # Do not replace it with captured internal log output.
            if "direct_percent" in runtime:
                return
            runtime["detail"] = detail


def _begin_runtime_progress(song_id: str) -> None:
    now = time.monotonic()
    with _progress_runtime_lock:
        _progress_runtime[song_id] = {
            "started_at": now,
            "step": 0.0,
            "step_started_at": now,
            "completed_step_seconds": {},
            "completed_stage_seconds": {},
            "detail": "Подготавливаем обработку песни",
        }


def _end_runtime_progress(song_id: str) -> None:
    with _progress_runtime_lock:
        _progress_runtime.pop(song_id, None)


def _runtime_speed_factor(completed_steps: dict) -> float:
    """Estimate relative pipeline speed from completed weighted stages."""
    expected_total = 0.0
    actual_total = 0.0
    for completed_step, seconds in completed_steps.items():
        plan = _STEP_PLAN.get(float(completed_step))
        if plan is None:
            continue
        expected_total += plan[2]
        actual_total += float(seconds)
    if expected_total < 10.0 or actual_total <= 0:
        return 1.0
    return min(3.0, max(0.25, actual_total / expected_total))


def _remaining_seconds(step: float, expected: float, elapsed: float, speed_factor: float) -> int:
    remaining = max(0.0, expected * speed_factor - elapsed)
    remaining += sum(
        seconds * speed_factor
        for plan_step, (_, _, seconds) in _STEP_PLAN.items()
        if plan_step > step
    )
    return max(1, int(round(remaining)))


def get_processing_telemetry(song_id: str) -> dict:
    """Return live sub-step, weighted percent and a conservative ETA."""
    with _progress_runtime_lock:
        runtime = dict(_progress_runtime.get(song_id, {}))
    if not runtime:
        return {}

    if "direct_percent" in runtime:
        now = time.monotonic()
        stage = str(runtime.get("stage") or "")
        base = float(runtime.get("direct_percent", 0.0))
        next_percent, expected, _label = _AI_STAGE_PLAN.get(
            stage, (min(99.7, base + 1.0), 10, runtime.get("detail") or "Обрабатываем песню")
        )
        elapsed = max(0.0, now - float(runtime.get("stage_started_at", now)))
        completed = runtime.get("completed_stage_seconds", {})
        expected_done = sum(_AI_STAGE_PLAN[name][1] for name in completed if name in _AI_STAGE_PLAN)
        actual_done = sum(float(value) for value in completed.values())
        speed_factor = (
            min(3.0, max(0.35, actual_done / expected_done))
            if expected_done >= 5 and actual_done > 0
            else 1.0
        )
        fraction = min(0.94, elapsed / max(1.0, expected * speed_factor))
        percent = base + (next_percent - base) * fraction
        stage_names = list(_AI_STAGE_PLAN)
        try:
            stage_index = stage_names.index(stage)
        except ValueError:
            stage_index = len(stage_names) - 1
        remaining = max(0.0, expected * speed_factor - elapsed)
        remaining += sum(
            _AI_STAGE_PLAN[name][1] * speed_factor for name in stage_names[stage_index + 1 :]
        )
        return {
            "step": float(runtime.get("step", 0.0)),
            "progress_percent": round(min(99.7, percent), 1),
            "progress_detail": runtime.get("detail"),
            "eta_seconds": max(1, int(round(remaining))),
            "semantic": True,
        }

    now = time.monotonic()
    step = float(runtime.get("step", 0.0))
    if step <= 0:
        return {
            "step": 0.0,
            "progress_percent": 0.5,
            "progress_detail": runtime.get("detail"),
            "eta_seconds": None,
        }
    base, end, expected = _STEP_PLAN.get(step, (0.0, 1.0, 10))
    elapsed = max(0.0, now - runtime.get("step_started_at", now))
    fraction = min(0.94, elapsed / max(1, expected))
    speed_factor = _runtime_speed_factor(runtime.get("completed_step_seconds", {}))
    return {
        "step": step,
        "progress_percent": round(base + (end - base) * fraction, 1),
        "progress_detail": runtime.get("detail"),
        "eta_seconds": _remaining_seconds(step, expected, elapsed, speed_factor),
    }


def _progress_heartbeat(song_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(1.0):
        try:
            telemetry = get_processing_telemetry(song_id)
            if telemetry:
                step = telemetry["step"]
                detail = telemetry.get("progress_detail") or "Обработка AI"
                label = detail if telemetry.get("semantic") else f"{step:g}/13 · {detail}"
                _update_progress(
                    song_id,
                    step_label=label,
                    percent=telemetry["progress_percent"],
                )
        except Exception:  # A transient SQLite error must not kill telemetry forever.
            logger.warning(
                "Could not persist pipeline heartbeat for song %s", song_id, exc_info=True
            )


def _update_progress(
    song_id: str,
    step_label: str | None = None,
    percent: float | None = None,
    status: models.SongStatus | None = None,
    error_message: str | None = None,
) -> None:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
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
        commit(db)
    finally:
        db.close()


def is_processing(song_id: str) -> bool:
    with _active_jobs_lock:
        thread = _active_jobs.get(song_id)
        return thread is not None and thread.is_alive()


def _release_active_job(song_id: str) -> None:
    """Remove a job only when the calling worker still owns that slot."""
    with _active_jobs_lock:
        if _active_jobs.get(song_id) is threading.current_thread():
            _active_jobs.pop(song_id, None)


def _job_entrypoint(song_id: str, target) -> None:
    """Run one worker and always release all per-job runtime state."""
    try:
        target(song_id)
    finally:
        with _active_jobs_lock:
            _cancelled_jobs.discard(song_id)
        _release_active_job(song_id)
        # Release temporary tensors/arrays while intentionally retaining loaded
        # model weights for the next song. No worker process survives a job.
        gc.collect()
        torch = sys.modules.get("torch")
        with contextlib.suppress(AttributeError, RuntimeError):
            if torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()


def _start_background_job(song_id: str, target) -> bool:
    """Reserve one processing slot and start its daemon worker atomically."""
    with _active_jobs_lock:
        _cancelled_jobs.discard(song_id)
        if is_processing(song_id):
            return False
        thread = threading.Thread(
            target=_job_entrypoint,
            args=(song_id, target),
            daemon=True,
        )
        _active_jobs[song_id] = thread
        try:
            thread.start()
        except Exception:
            _active_jobs.pop(song_id, None)
            raise
        return True


def start_processing(song_id: str) -> bool:
    """Start a full processing job unless this song already has one running."""
    return _start_background_job(song_id, _run_job)


def start_reprocessing(song_id: str) -> bool:
    """Start a clean full reprocessing run for one song."""
    return _start_background_job(song_id, _run_reprocessing)


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


def _load_job_paths(song_id: str) -> tuple[str, Path] | None:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None:
            return None
        stored_output = getattr(song, "output_dir", None)
        if isinstance(stored_output, (str, os.PathLike)) and str(stored_output):
            out_dir = song_service.resolve_output_dir(song)
        else:
            out_dir = config.SONG_OUTPUT_DIR / song.slug
        return song.source_path, out_dir
    finally:
        db.close()


def _load_ai_inputs(song_id: str, out_dir: Path) -> tuple[Path | None, float | None, str | None]:
    """Return user-authored lyrics and authoritative musical overrides for AI Core.

    These values used to stop at the DB/UI layer. Reprocessing then silently
    re-detected BPM/key and rediscovered lyrics, so the note decoder could work
    from different inputs than the user had already corrected.
    """
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None:
            return None, None, None

        candidate_lyrics_path = out_dir / config.TRUSTED_LYRICS_FILENAME
        lyrics_path: Path | None = (
            candidate_lyrics_path
            if candidate_lyrics_path.is_file()
            and candidate_lyrics_path.read_text(encoding="utf-8-sig", errors="ignore").strip()
            else None
        )

        tempo_value = getattr(song, "tempo_override", None)
        key_value = getattr(song, "key_override", None)
        tempo_edited = bool(getattr(song, "tempo_user_edited", tempo_value is not None))
        key_edited = bool(getattr(song, "key_user_edited", key_value is not None))

        bpm_override = float(tempo_value) if tempo_edited and tempo_value is not None else None
        key_override = str(key_value).strip() if key_edited and key_value else None
        return lyrics_path, bpm_override, key_override
    finally:
        db.close()


def _load_searchable_title(song_id: str) -> str | None:
    """Build a clean lyrics query from source identity.

    Metadata wins. Without metadata the original filename is parsed as
    ``artist + title`` first, so a filename containing artist, title and a
    duplicate suffix becomes a clean artist/title query instead of one opaque filename.
    """
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None:
            return None
        artist, title = song_service._read_source_identity(
            Path(song.source_path), song.original_filename, song.title
        )
        if artist and title:
            return f"{artist} - {title}"
        return (title or artist or "").strip() or None
    finally:
        db.close()


def _start_progress_heartbeat(song_id: str) -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=_progress_heartbeat,
        args=(song_id, stop_event),
        daemon=True,
    )
    thread.start()
    return stop_event, thread


def _create_progress_capture(song_id: str, out_dir: Path) -> _ProgressCapture:
    log_dir = out_dir / config.LOGS_DIRNAME
    log_dir.mkdir(parents=True, exist_ok=True)
    return _ProgressCapture(song_id, log_dir / "pipeline.log")


def _stop_progress_heartbeat(
    stop_event: threading.Event | None,
    thread: threading.Thread | None,
) -> None:
    """Stop a heartbeat created during worker setup without leaking a thread."""
    if stop_event is None:
        return
    stop_event.set()
    if thread is not None and thread is not threading.current_thread():
        thread.join(timeout=2.0)


def _format_processing_error(exc: BaseException) -> str:
    """Return a useful error even for exceptions whose ``str(exc)`` is empty."""
    error_type = type(exc).__name__
    message = str(exc).strip()
    return f"{error_type}: {message}" if message else error_type


def _write_pipeline_error(capture: _ProgressCapture | None, exc: Exception) -> None:
    """Persist a worker traceback when its log stream was created successfully."""
    if capture is None:
        logger.exception("Song processing failed before pipeline.log was available")
        return
    with contextlib.suppress(OSError, ValueError):
        capture.write(
            f"\n[backend] ОШИБКА: {_format_processing_error(exc)}\n{traceback.format_exc()}\n"
        )


def _create_ai_progress_callback(
    song_id: str, capture: _ProgressCapture
) -> Callable[[str, float, str], None]:
    def on_ai_progress(stage: str, percent: float, detail: str) -> None:
        if _is_cancelled(song_id):
            raise ProcessingCancelled("Processing cancelled by user")
        bounded_percent = max(0.0, min(99.7, float(percent)))
        friendly = _AI_STAGE_PLAN.get(stage, (0, 0, "Обрабатываем песню"))[2]
        with _progress_runtime_lock:
            runtime = _progress_runtime.get(song_id)
            if runtime is not None:
                now = time.monotonic()
                previous_stage = runtime.get("stage")
                if previous_stage and previous_stage != stage:
                    completed = runtime.setdefault("completed_stage_seconds", {})
                    completed[previous_stage] = max(
                        0.0, now - float(runtime.get("stage_started_at", now))
                    )
                if previous_stage != stage:
                    runtime["stage_started_at"] = now
                runtime["stage"] = stage
                runtime["direct_percent"] = bounded_percent
                runtime["detail"] = friendly
        _update_progress(song_id, step_label=friendly, percent=bounded_percent)
        capture.write(f"[AI] {bounded_percent:5.1f}% {stage} · {detail}\n")

    return on_ai_progress


def _run_job(song_id: str) -> None:
    paths = _load_job_paths(song_id)
    if paths is None or _is_cancelled(song_id):
        return
    source_path, out_dir = paths
    searchable_title = _load_searchable_title(song_id)
    lyrics_path, bpm_override, key_override = _load_ai_inputs(song_id, out_dir)

    capture: _ProgressCapture | None = None
    heartbeat_stop: threading.Event | None = None
    heartbeat_thread: threading.Thread | None = None
    try:
        _update_progress(
            song_id,
            status=models.SongStatus.PROCESSING,
            percent=0.0,
            step_label="0/13",
        )
        _begin_runtime_progress(song_id)
        heartbeat_stop, heartbeat_thread = _start_progress_heartbeat(song_id)
        capture = _create_progress_capture(song_id, out_dir)

        runtime_plan = _configure_ai_runtime()
        capture.write(
            f"[backend] AI build={AI_BUILD_ID} pipeline={KaraokePipeline.VERSION} "
            f"decoder={NOTE_DECODER_VERSION} pitch={PITCH_STABILIZER_VERSION}\n"
        )
        capture.write(f"[backend] AI module={Path(__file__).resolve()}\n")
        for line in format_runtime_plan(runtime_plan):
            capture.write(f"[backend] AI runtime: {line}\n")

        on_ai_progress = _create_ai_progress_callback(song_id, capture)

        with (
            contextlib.redirect_stdout(cast(TextIO, capture)),
            contextlib.redirect_stderr(cast(TextIO, capture)),
        ):
            ai_bridge.process_song(
                source_path,
                out_dir,
                language=None if lyrics_path is not None else config.DEFAULT_LANGUAGE,
                lyrics_path=lyrics_path,
                title=searchable_title,
                bpm_override=bpm_override,
                key_override=key_override,
                progress=on_ai_progress,
                cancelled=lambda: _is_cancelled(song_id),
            )
    except ProcessingCancelled:
        _update_progress(song_id, status=models.SongStatus.CANCELLED, step_label="Отменено")
        return
    except Exception as exc:  # noqa: BLE001 — background-worker boundary
        if _is_cancelled(song_id):
            _update_progress(song_id, status=models.SongStatus.CANCELLED, step_label="Отменено")
            return
        _write_pipeline_error(capture, exc)
        _update_progress(
            song_id,
            status=models.SongStatus.ERROR,
            error_message=_format_processing_error(exc),
        )
        return
    finally:
        if capture is not None:
            capture.close()
        _stop_progress_heartbeat(heartbeat_stop, heartbeat_thread)
        _end_runtime_progress(song_id)

    if not _is_cancelled(song_id):
        try:
            _finalize_success(song_id, out_dir)
        except Exception as exc:  # noqa: BLE001 - finalization is a worker boundary
            _update_progress(
                song_id,
                status=models.SongStatus.ERROR,
                error_message=(
                    f"Could not finalize processing results: {_format_processing_error(exc)}"
                ),
            )


_MIDI_REBUILD_FILES = (
    "pitchRaw.json",
    "pitch.json",
    "syllables.json",
    "reference.json",
    "acousticNotes.json",
    "melodyContour.json",
    "vocal.mid",
    "game.mid",
    "songMap.json",
    "songInfo.json",
    "difficulty.json",
    "quality.json",
    "diagnostics.json",
    "alignmentDebug.json",
    "manifest.json",
)


def _force_midi_rebuild(out_dir: Path) -> None:
    """Remove every downstream melody artefact and its cache entries.

    Reprocessing previously claimed to clear generated melody files but simply
    called the normal cached pipeline.  That made it possible to keep showing an
    old reference/MIDI after code changes.  Preserve expensive decode/separation,
    music analysis and trusted lyric alignment, but force pitch -> notes -> MIDI
    -> song map to be produced again by the code loaded in this process.
    """
    cache = StageCache(out_dir / ".ai-cache")
    cache.invalidate("pitch", "derivation", "midi", "song-map")
    for relative in _MIDI_REBUILD_FILES:
        with contextlib.suppress(OSError):
            (out_dir / relative).unlink(missing_ok=True)
    with contextlib.suppress(OSError):
        (out_dir / "acousticNotes.json").unlink(missing_ok=True)


def _run_reprocessing(song_id: str) -> None:
    """Incrementally rebuild stale AI artefacts while retaining expensive stems."""
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None:
            return
        out_dir = song_service.resolve_output_dir(song)
    finally:
        db.close()
    output_root = config.SONG_OUTPUT_DIR.resolve()
    target_dir = out_dir.resolve()
    if target_dir.parent != output_root:
        _update_progress(
            song_id,
            status=models.SongStatus.ERROR,
            error_message="Недопустимый путь к результатам песни",
        )
        return
    _force_midi_rebuild(out_dir)
    _run_job(song_id)


def _read_optional_generated_json(path: Path, default):
    try:
        return read_json(path, default=default)
    except (OSError, ValueError, TypeError):
        return default


def _apply_generated_metadata(song: models.Song, out_dir: Path) -> None:
    """Persist optional metadata discovered in generated pipeline files."""
    music = _read_optional_generated_json(out_dir / "music.json", {})
    if isinstance(music, dict):
        key_user_edited = getattr(
            song, "key_user_edited", getattr(song, "key_override", None) is not None
        )
        tempo_user_edited = getattr(
            song, "tempo_user_edited", getattr(song, "tempo_override", None) is not None
        )
        if not key_user_edited and music.get("key"):
            song.key_override = music["key"]
        detected_bpm = music.get("bpm")
        if detected_bpm is not None and not tempo_user_edited:
            song.tempo_override = int(round(float(detected_bpm)))

    reference = _read_optional_generated_json(out_dir / "reference.json", {})
    if isinstance(reference, dict):
        reference = reference.get("notes", [])
    if not isinstance(reference, list):
        return
    try:
        midi = []
        for note in reference:
            if not isinstance(note, dict):
                continue
            value = note.get("midi_note", note.get("midi"))
            if value is not None:
                midi.append(int(value))
    except (TypeError, ValueError):
        return
    if not midi:
        return
    # Populate only values that are still unset. Explicit/user-preserved limits
    # must not be overwritten by a reprocess; doing so also made the backend's
    # generated-metadata contract inconsistent with key/tempo handling above.
    if getattr(song, "note_range_min", None) is None:
        song.note_range_min = min(midi)
    if getattr(song, "note_range_max", None) is None:
        song.note_range_max = max(midi)


def _finalize_success(song_id: str, out_dir: Path) -> None:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None:
            return
        song.output_dir = str(out_dir)
        _apply_source_metadata(song)
        # Persist the facts discovered by the pipeline so the library and the
        # song editor do not need to infer them from generated files again.
        _apply_generated_metadata(song, out_dir)
        song.status = models.SongStatus.DONE
        song.progress_percent = 100.0
        song.progress_step = "13/13"
        song.error_message = None
        commit(db)
    finally:
        db.close()

    # Пост-обработка: перевод тяжёлых wav в mp3 + чистка временных файлов.
    # Не должна валить успешно завершённый пайплайн, если что-то пойдёт не так.
    with contextlib.suppress(Exception):
        cache_service.optimize_song_files(song_id)
