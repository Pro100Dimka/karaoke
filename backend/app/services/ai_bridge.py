"""
Мост к существующему AI-пайплайну (backend/AI/...).

AI/ — самостоятельный пакет со своими импортами вида `from src.analyze...`,
рассчитанный на запуск из своей собственной директории (см. AI/run_all.py).
Чтобы переиспользовать его функции напрямую из backend'а (а не только как
внешний процесс), достаточно один раз добавить AI/ в sys.path — тогда
`import run_all` и `from src...` внутри AI-пакета резолвятся так же, как
если бы мы находились в AI/.

Все импорты — ленивые (внутри функций), чтобы:
  1) backend стартовал и без тяжёлых зависимостей AI (librosa/torch/whisper/
     demucs), если они ещё не установлены — сломается только при попытке
     реально обработать песню, а не при старте сервера;
  2) diagnostics-роутер мог аккуратно проверить, что чего не хватает,
     не роняя весь процесс.
"""
import sys

from backend.app import config

_AI_PATH_ADDED = False


def _ensure_ai_on_path() -> None:
    global _AI_PATH_ADDED
    if _AI_PATH_ADDED:
        return
    ai_dir = str(config.AI_DIR)
    if ai_dir not in sys.path:
        sys.path.insert(0, ai_dir)
    _AI_PATH_ADDED = True


def get_run_all_pipeline():
    """Возвращает функцию run_all.run(input_mp3, out_dir, whisper_model, language)."""
    _ensure_ai_on_path()
    from run_all import run  # type: ignore
    return run


def get_analyze_vocal():
    _ensure_ai_on_path()
    from src.analyze.vocal import analyze_vocal  # type: ignore
    return analyze_vocal


def get_build_reference():
    _ensure_ai_on_path()
    from src.build.reference import build_reference  # type: ignore
    return build_reference


def get_convert():
    _ensure_ai_on_path()
    from src.build.convert import convert  # type: ignore
    return convert