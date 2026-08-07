# Karaoke AI Backend

Локальный FastAPI backend для Karaoke Studio: библиотека песен, AI-обработка, плеер, запись голоса, анализ, диагностика и настройки аудио.

## Требования

- Python 3.11–3.13
- FFmpeg в `PATH`
- Windows для ASIO-моста
- CUDA-совместимая среда опциональна

## Установка

Для разработки API без тяжёлых ML-зависимостей:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-api.txt -r requirements-dev.txt
```

Полная среда AI:

```bash
pip install -r requirements.txt -r requirements-dev.txt
```

## Запуск

```bash
python run.py
```

По умолчанию API доступен только на `127.0.0.1:8000`. Рабочие данные и разрешённые CORS origins настраиваются переменными из `.env.example`.

## Проверки

```bash
python scripts/check.py
```

Команда последовательно запускает компиляцию, Ruff, mypy, архитектурный аудит и pytest с branch coverage. Тесты не должны зависеть от пользовательской библиотеки песен или установленного аудиооборудования.

## Структура

- `app/routers` — HTTP-контракты и преобразование ошибок в ответы API.
- `app/services` — бизнес-логика, файловые операции и фоновые процессы.
- `AI` — независимый AI-пайплайн и его тесты.
- `models.py` — ORM-модели SQLite.
- `schemas.py` — публичные Pydantic-схемы.
- `config.py` — единственная точка конфигурации путей и runtime-параметров.
- `engines` — нативные и сторонние движки; результаты сборки не хранятся в Git.

## Правила проекта

Не добавляйте в репозиторий `__pycache__`, базы, пользовательские песни, логи, CMake build-каталоги, установщики и сгенерированные модели. Новая логика должна иметь тест и проходить `python scripts/check.py`.

## AI Core 2026 integration

The backend now imports the new `AI` package directly (`AI.service`) instead of
legacy `run_all/src/...` modules.  Canonical generated files are
`lyricsSync.json`, `songMap.json`, and object-shaped `reference.json`.
`app.services.ai_bridge` creates temporary compatibility JSON files used by the
current frontend (`lyrics.json`, `songInfo.json`, `difficulty.json`,
`structure.json`, `breaths.json`) without modifying the canonical AI artefacts.

Production AI dependencies are listed in `AI/requirements.txt`.  Model weights
are intentionally **not** part of the PyInstaller bundle or repository archive;
they should be installed to the external models directory used by the app.
