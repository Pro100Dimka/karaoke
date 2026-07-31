"""
Центральная конфигурация backend'а.

Всё, что завязано на пути к папкам/файлам, дефолты пайплайна и настройки
БД — собрано здесь в одном месте, чтобы не расползалось по роутерам и
сервисам. Все пути считаются от расположения этого файла (корень backend/),
поэтому программу можно установить/скопировать в любую директорию на диске
пользователя — ничего не захардкожено абсолютным путём.
"""
import os
import sys
from pathlib import Path


def _env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser().resolve() if value else default


# --------------------------------------------------------------------
# Базовые пути
# --------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
IS_FROZEN = bool(getattr(sys, "frozen", False))
# PyInstaller places bundled read-only files in _MEIPASS.
RUNTIME_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))

AI_DIR = _env_path("SONGAPP_AI_DIR", RUNTIME_DIR / "AI")
RECORDINGS_DIRNAME = "recordings"            # подпапка внутри Song/<slug>/ для записей пользователя
LOGS_DIRNAME = "logs"                        # подпапка внутри Song/<slug>/ для логов обработки

# Можно переопределить SONGAPP_DATA_DIR — например, чтобы хранить данные в
# %APPDATA%/SongApp на Windows или ~/Library/Application Support/SongApp на
# macOS при упаковке в инсталлятор.
DATA_DIR = _env_path("SONGAPP_DATA_DIR", BASE_DIR / "data")
DB_PATH = DATA_DIR / "app.db"

# Keep the development layout. The packaged application gets SONGAPP_DATA_DIR
# from Electron, so updates never overwrite songs, recordings or the database.
_CONTENT_DIR = DATA_DIR if IS_FROZEN else BASE_DIR
FULL_SONGS_DIR = _env_path("SONGAPP_FULL_SONGS_DIR", _CONTENT_DIR / "full_songs")
SONG_OUTPUT_DIR = _env_path("SONGAPP_SONG_OUTPUT_DIR", _CONTENT_DIR / "Song")

# --------------------------------------------------------------------
# База данных
# --------------------------------------------------------------------

DATABASE_URL = f"sqlite:///{DB_PATH}"

# --------------------------------------------------------------------
# AI-пайплайн
# --------------------------------------------------------------------

DEFAULT_WHISPER_MODEL = "medium"
DEFAULT_LANGUAGE = None  # автоопределение

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}

# Стандартный формат аудио, который backend гарантирует на выходе
# (используется при оптимизации/конвертации файлов песни, см. cache_service).
STANDARD_SAMPLE_RATE = 44100
STANDARD_BIT_DEPTH = 24

# --------------------------------------------------------------------
# Запись голоса
# --------------------------------------------------------------------

RECORDING_SAMPLE_RATE = 44100
RECORDING_CHANNELS = 1

# --------------------------------------------------------------------
# Сервер
# --------------------------------------------------------------------

HOST = os.environ.get("SONGAPP_HOST", "127.0.0.1")   # локальный десктоп-бекенд — наружу не торчит
PORT = int(os.environ.get("SONGAPP_PORT", "8000"))


def ensure_directories() -> None:
    """Создаёт все рабочие директории при первом запуске, если их ещё нет."""
    for path in (AI_DIR, FULL_SONGS_DIR, SONG_OUTPUT_DIR, DATA_DIR):
        path.mkdir(parents=True, exist_ok=True)


ensure_directories()
