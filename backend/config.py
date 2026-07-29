"""
Центральная конфигурация backend'а.

Всё локально: одна папка данных приложения (по умолчанию рядом с backend/,
но можно переопределить переменной окружения SONGAPP_DATA_DIR — например,
чтобы хранить данные в %APPDATA%/SongApp на Windows или ~/Library/Application
Support/SongApp на macOS при упаковке в инсталлятор).

Структура данных приложения:
    <data_dir>/
        app.db                — SQLite база (метаданные, статусы, настройки)
        songs/<folder_name>/  — результаты AI-пайплайна (копия/то же, что AI/Song/<...>)
        recordings/<song_id>/ — записи голоса пользователя (.wav)
        cache/                — временные файлы, которые можно чистить

Путь до самого AI-пайплайна (папка AI/ из предыдущего архива) — отдельная
настройка AI_ROOT, т.к. это внешний, уже готовый код, который backend
только запускает как подпроцесс.
"""
import os
from pathlib import Path


def _env_path(name: str, default: Path) -> Path:
    val = os.environ.get(name)
    return Path(val).expanduser().resolve() if val else default


# Корень backend-проекта (.../KARAOKE-T/backend)
BACKEND_ROOT = Path(__file__).resolve().parent

# Корень всего проекта (.../KARAOKE-T)
PROJECT_ROOT = BACKEND_ROOT.parent

# Где лежит AI-пайплайн (папка с run_all.py, src/, requirements.txt).
# У тебя AI/ находится внутри backend/, поэтому дефолт ставим туда.
AI_ROOT = _env_path("SONGAPP_AI_ROOT", BACKEND_ROOT / "AI")
AI_RUN_ALL = AI_ROOT / "run_all.py"
AI_SONG_DIR = AI_ROOT / "Song"          # куда AI кладёт результаты по умолчанию
AI_FULL_SONGS_DIR = AI_ROOT / "full_songs"  # куда AI ждёт входной mp3/wav

# Папка с данными самого приложения (БД, записи, кэш)
DATA_DIR = _env_path("SONGAPP_DATA_DIR", PROJECT_ROOT / "data")
DB_PATH = DATA_DIR / "app.db"
RECORDINGS_DIR = DATA_DIR / "recordings"
CACHE_DIR = DATA_DIR / "cache"
SONGS_STORAGE_DIR = DATA_DIR / "songs"  # финальные (облегчённые) результаты после file_service

for d in (DATA_DIR, RECORDINGS_DIR, CACHE_DIR, SONGS_STORAGE_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Какие файлы из AI/Song/<name>/ считаются "тяжёлыми и временными"
HEAVY_TEMP_FILENAMES = {
    "vocals.wav",
    "instrumental.wav",
    "no_vocals.wav",
}
HEAVY_TEMP_DIRNAMES = {
    "separated",  # промежуточные стемы demucs
}

# Хост/порт локального API
HOST = os.environ.get("SONGAPP_HOST", "127.0.0.1")
PORT = int(os.environ.get("SONGAPP_PORT", "8756"))
