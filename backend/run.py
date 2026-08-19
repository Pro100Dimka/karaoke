"""
Точка запуска backend'а.

Запускать из корня backend/:

    python run.py

Хост/порт настраиваются через config.py (переменные окружения
SONGAPP_HOST / SONGAPP_PORT — см. config.py).
"""

import importlib
import json
import logging
import os
import socket
import sys
import urllib.request
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, BinaryIO

import uvicorn


class _StreamToLogFile:
    """Mirror a raw text stream into the backend's rotating log file.

    Progress/diagnostic lines throughout the AI pipeline (``print(f"[AI] ...")``)
    never went through ``logging``, so they only ever reached the terminal --
    or, in the packaged app, a second, separate ``backend-process.log`` that
    Electron captured on its own. Emitting straight to the same file handler
    (bypassing the logger dispatch chain, so nothing is printed twice) keeps
    every backend line, log calls and plain prints alike, in one place.
    """

    def __init__(self, file_handler: RotatingFileHandler, level: int, original): self._file_handler = file_handler; self._level = level; self._original = original

    def write(self, message: str) -> int:
        self._original.write(message)
        for line in message.splitlines():
            if line.strip():
                record = logging.LogRecord("stdout", self._level, "", 0, line, (), None); self._file_handler.emit(record)
        return len(message)

    def flush(self) -> None: self._original.flush()

    def isatty(self) -> bool: return False


def configure_logging() -> None:
    import config; from app.services.remote_log_service import RemoteErrorLogHandler

    log_path = config.APP_LOG_DIR / "backend.log"; file_handler, remote_handler = RotatingFileHandler(log_path, maxBytes=2000000, backupCount=3, encoding='utf-8'), RemoteErrorLogHandler()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[file_handler, logging.StreamHandler(sys.stdout), remote_handler],
        force=True,
    )
    sys.stdout = _StreamToLogFile(file_handler, logging.INFO, sys.stdout); sys.stderr = _StreamToLogFile(file_handler, logging.ERROR, sys.stderr)





class _SingleInstanceLock:
    """Cross-process lock acquired before importing the FastAPI application."""

    def __init__(self, path: Path): self.path = path; self._file: BinaryIO | None = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True); handle = self.path.open("a+b")
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                if handle.tell() == 0 and handle.read(1) == b"":
                    handle.write(b"0"); handle.flush()
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl: Any = importlib.import_module("fcntl"); fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            handle.close(); return False
        self._file = handle; return True

    def release(self) -> None:
        handle, self._file = self._file, None
        if handle is None: return
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl: Any = importlib.import_module("fcntl"); fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally: handle.close()

def _existing_backend_is_healthy(host: str, port: int) -> bool:
    """Detect our already-running backend before importing app/main.

    Importing app.main runs lifespan later; avoiding a duplicate Uvicorn launch
    also prevents a losing process from marking live jobs as interrupted.
    """
    try:
        with socket.create_connection((host, port), timeout=0.35): pass
    except OSError: return False
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/diagnostics/health", timeout=0.7) as response:
            payload = json.loads(response.read().decode("utf-8")); return response.status == 200 and bool(payload)
    except Exception: return False

def main() -> None:
    if "--install-ai-models" in sys.argv:
        from AI.install_models import main as install_models

        args = [arg for arg in sys.argv[1:] if arg != "--install-ai-models"]; raise SystemExit(install_models(args))

    if "--verify-ai-runtime" in sys.argv:
        from pathlib import Path

        import torchfcpe

        checkpoint = Path(torchfcpe.__file__).resolve().parent / "assets" / "fcpe_c_v001.pt"
        if not checkpoint.is_file(): raise FileNotFoundError(f"Bundled TorchFCPE checkpoint is missing: {checkpoint}")
        model = torchfcpe.spawn_bundled_infer_model(device="cpu"); print(f"TorchFCPE runtime ready: {type(model).__name__} ({checkpoint})"); return

    if "--verify-qwen-runtime" in sys.argv:
        import importlib

        # Import the exact public runtime path used by production.  qwen_asr
        # imports Qwen3ForcedAligner, which imports nagisa; on nagisa 0.2.x
        # that transitively exercises its native prepro/nagisa_utils modules.
        # Do not require those private extensions to be importable as explicit
        # build-time top-level modules: the packaged smoke test itself is the
        # authoritative proof that the frozen application contains them.
        qwen_asr = importlib.import_module("qwen_asr"); asr_model = qwen_asr.Qwen3ASRModel; aligner_model = qwen_asr.Qwen3ForcedAligner; nagisa = importlib.import_module("nagisa")
        tagged = nagisa.tagging("テスト")
        if not getattr(tagged, "words", None): raise RuntimeError("Nagisa tokenizer smoke test returned no tokens")
        print(
            "Qwen runtime ready: "
            f"ASR={asr_model.__name__}, aligner={aligner_model.__name__}, "
            f"nagisa={getattr(nagisa, '__version__', 'installed')}, "
            f"tokens={len(tagged.words)}"
        )
        return

    import config

    configure_logging(); lock = _SingleInstanceLock(config.DATA_DIR / "backend.instance.lock")
    if not lock.acquire():
        logging.getLogger(__name__).info("Backend instance lock is already held; duplicate launch skipped"); raise SystemExit(23)
    try:
        if _existing_backend_is_healthy(config.HOST, config.PORT):
            logging.getLogger(__name__).info("Backend is already running on %s:%s; duplicate launch skipped", config.HOST, config.PORT); raise SystemExit(23)

        from AI.utils.env import env_flag; from app.main import app

        # Request access lines (GET /songs/... 200 OK) drown out the AI logs in
        # desktop development.  Keep warnings/errors, and allow temporary
        # re-enabling with SONGAPP_ACCESS_LOG=1 when HTTP tracing is needed.
        access_log = env_flag("SONGAPP_ACCESS_LOG")
        uvicorn.run(
            app,
            host=config.HOST,
            port=config.PORT,
            access_log=access_log,
            log_level=os.getenv("SONGAPP_UVICORN_LOG_LEVEL", "warning"),
        )
    finally: lock.release()


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    main()
