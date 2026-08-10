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


def _env_int(name: str, default: int, *, minimum: int, maximum: int | None = None) -> int:
    """Read a bounded integer environment variable with an actionable error."""
    raw = os.environ.get(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum or (maximum is not None and value > maximum):
        range_text = f"{minimum}..{maximum}" if maximum is not None else f">= {minimum}"
        raise ValueError(f"{name} must be in range {range_text}, got {value}")
    return value


def _unique_csv(name: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
    """Read a comma-separated setting, trim it and preserve unique order."""
    raw = os.environ.get(name, ",".join(defaults))
    return tuple(dict.fromkeys(item.strip() for item in raw.split(",") if item.strip()))


# --------------------------------------------------------------------
# Базовые пути
# --------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
IS_FROZEN = bool(getattr(sys, "frozen", False))
# PyInstaller places bundled read-only files in _MEIPASS.
RUNTIME_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
PROJECT_ROOT = BASE_DIR.parent


def _default_data_dir() -> Path:
    if not IS_FROZEN:
        return PROJECT_ROOT / "data"
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / "A&D Voice"


AI_DIR = _env_path("SONGAPP_AI_DIR", RUNTIME_DIR / "AI")
DOWNLOADS_DIR = _env_path("SONGAPP_DOWNLOADS_DIR", PROJECT_ROOT / "downloads")
MODELS_DIR = _env_path(
    "SONGAPP_MODELS_DIR", RUNTIME_DIR / "models" if IS_FROZEN else DOWNLOADS_DIR / "models"
)
EXTERNAL_ENGINES_DIR = _env_path(
    "SONGAPP_ENGINES_DIR", RUNTIME_DIR / "engines" if IS_FROZEN else DOWNLOADS_DIR / "engines"
)
RECORDINGS_DIRNAME = "recordings"  # подпапка внутри Song/<slug>/ для записей пользователя
LOGS_DIRNAME = "logs"  # подпапка внутри Song/<slug>/ для логов обработки
TRUSTED_LYRICS_FILENAME = "trusted_lyrics.txt"

# Можно переопределить SONGAPP_DATA_DIR — например, чтобы хранить данные в
# %APPDATA%/SongApp на Windows или ~/Library/Application Support/SongApp на
# macOS при упаковке в инсталлятор.
DATA_DIR = _env_path("SONGAPP_DATA_DIR", _default_data_dir())
DB_PATH = DATA_DIR / "app.db"
_DEFAULT_LOG_DIR = DATA_DIR / "logs" if IS_FROZEN else PROJECT_ROOT / "logs"
APP_LOG_DIR = _env_path("SONGAPP_LOG_DIR", _DEFAULT_LOG_DIR)

# Source uploads and generated artefacts live in one owned library. The original
# upload is replaced by the pipeline's normalized song.mp3 after processing, so
# the application never keeps a second full-song copy indefinitely.
_DEFAULT_SONGS_DIR = DATA_DIR / "karaoke_songs" if IS_FROZEN else PROJECT_ROOT / "karaoke_songs"
SONG_OUTPUT_DIR = _env_path("SONGAPP_SONG_OUTPUT_DIR", _DEFAULT_SONGS_DIR)
UPLOAD_TEMP_DIR = SONG_OUTPUT_DIR / ".incoming"


def configure_ai_resource_environment() -> None:
    """Point the AI core at local resources without machine-specific bat files."""
    preferred_asr = MODELS_DIR / "qwen" / "Qwen3-ASR-1.7B"
    legacy_asr = MODELS_DIR / "qwen" / "Qwen3-ASR-0.6B"
    asr_model = preferred_asr if preferred_asr.is_dir() else legacy_asr
    aligner_model = MODELS_DIR / "qwen" / "Qwen3-ForcedAligner-0.6B"
    ctc_ru_model = MODELS_DIR / "ctc" / "wav2vec2-large-xlsr-53-russian"
    ctc_uk_model = MODELS_DIR / "ctc" / "wav2vec2-xls-r-300m-uk"
    roformer = MODELS_DIR / "roformer" / "MelBandRoformer.ckpt"
    msst = EXTERNAL_ENGINES_DIR / "msst"
    msst_config = msst / "configs" / "KimberleyJensen" / "config_vocals_mel_band_roformer_kj.yaml"

    def set_resource(name: str, path: Path, *, directory: bool = False) -> None:
        configured = os.environ.get(name)
        configured_path = Path(configured).expanduser() if configured else None
        configured_exists = (
            configured_path.is_dir()
            if configured_path and directory
            else configured_path.is_file()
            if configured_path
            else False
        )
        if not configured_exists and (path.is_dir() if directory else path.is_file()):
            os.environ[name] = str(path)

    set_resource("KARAOKE_AI_ASR_MODEL", asr_model, directory=True)
    set_resource("KARAOKE_AI_ALIGNER_MODEL", aligner_model, directory=True)
    set_resource("KARAOKE_AI_CTC_RU_MODEL", ctc_ru_model, directory=True)
    set_resource("KARAOKE_AI_CTC_UK_MODEL", ctc_uk_model, directory=True)
    os.environ.setdefault("KARAOKE_AI_REQUIRE_CTC", "1")
    set_resource("MSST_CHECKPOINT", roformer)
    set_resource("MSST_ENGINE_DIR", msst, directory=True)
    if msst_config.is_file():
        set_resource("MSST_CONFIG", msst_config)


# --------------------------------------------------------------------
# База данных
# --------------------------------------------------------------------

DATABASE_URL = f"sqlite:///{DB_PATH}"

# --------------------------------------------------------------------
# AI-пайплайн
# --------------------------------------------------------------------

DEFAULT_WHISPER_MODEL = "turbo"
DEFAULT_LANGUAGE = None  # автоопределение

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
MAX_AUDIO_UPLOAD_BYTES = _env_int("SONGAPP_MAX_AUDIO_UPLOAD_BYTES", 2 * 1024**3, minimum=1)
UPLOAD_CHUNK_SIZE = _env_int("SONGAPP_UPLOAD_CHUNK_SIZE", 1024 * 1024, minimum=4096)

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

HOST = os.environ.get("SONGAPP_HOST", "127.0.0.1")  # локальный десктоп-бекенд — наружу не торчит
PORT = _env_int("SONGAPP_PORT", 8000, minimum=1, maximum=65535)
DEFAULT_UI_ORIGINS = (
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
)
CORS_ORIGINS = _unique_csv("SONGAPP_CORS_ORIGINS", DEFAULT_UI_ORIGINS)


def ensure_directories() -> None:
    """Создаёт все рабочие директории при первом запуске, если их ещё нет."""
    for path in (SONG_OUTPUT_DIR, UPLOAD_TEMP_DIR, DATA_DIR, APP_LOG_DIR):
        path.mkdir(parents=True, exist_ok=True)


ensure_directories()
configure_ai_resource_environment()
