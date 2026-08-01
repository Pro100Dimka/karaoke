"""
Настройка локальной SQLite-базы через SQLAlchemy.

SQLite выбрана потому, что это десктоп-программа: один файл на диске,
не нужен отдельный процесс сервера БД, работает "из коробки" без установки
чего-либо дополнительного пользователем.
"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

import config

# check_same_thread=False — нужно, т.к. FastAPI обрабатывает запросы в разных
# потоках (и фоновая обработка песни в pipeline_service тоже работает в
# отдельном потоке). Сама SQLite при этом не потокобезопасна "из коробки" для
# ОДНОГО соединения, поэтому мы открываем новую Session на каждый запрос/
# фоновую задачу через SessionLocal(), а не шарим одно соединение.
engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    """Shared declarative base for all persisted application models."""


def init_db() -> None:
    """Создаёт таблицы, если их ещё нет. Вызывается один раз при старте приложения."""
    import models  # noqa: F401  (регистрирует модели в Base.metadata перед create_all)
    Base.metadata.create_all(bind=engine)
    # create_all deliberately does not alter existing SQLite tables. Keep
    # additive migrations so installed libraries upgrade without data loss.
    song_columns = {column["name"] for column in inspect(engine).get_columns("songs")}
    audio_columns = {column["name"] for column in inspect(engine).get_columns("audio_settings")}
    with engine.begin() as connection:
        if "video_url" not in song_columns:
            connection.execute(text("ALTER TABLE songs ADD COLUMN video_url VARCHAR"))
        for column in ("artist", "genre"):
            if column not in song_columns:
                connection.execute(text(f"ALTER TABLE songs ADD COLUMN {column} VARCHAR"))
        if "audio_driver" not in audio_columns:
            connection.execute(text("ALTER TABLE audio_settings ADD COLUMN audio_driver VARCHAR DEFAULT 'auto'"))
        if "asio_driver_name" not in audio_columns:
            connection.execute(text("ALTER TABLE audio_settings ADD COLUMN asio_driver_name VARCHAR"))
        if "buffer_size" not in audio_columns:
            connection.execute(text("ALTER TABLE audio_settings ADD COLUMN buffer_size INTEGER DEFAULT 64"))
        if "output_device_id" not in audio_columns:
            connection.execute(text("ALTER TABLE audio_settings ADD COLUMN output_device_id INTEGER"))
        # Background AI workers are in-process threads. They cannot survive a
        # backend restart, so retaining PROCESSING/QUEUED would leave a song
        # permanently locked in the UI. Make only those orphaned states
        # actionable again; completed and pending library entries are intact.
        connection.execute(
            text(
                "UPDATE songs "
                "SET status = :cancelled, progress_step = :step, progress_percent = 0, "
                "error_message = :message "
                "WHERE status IN (:queued, :processing)"
            ),
            {
                "cancelled": "CANCELLED",
                "queued": "QUEUED",
                "processing": "PROCESSING",
                "step": "Interrupted",
                "message": "Processing was interrupted by an application restart",
            },
        )


def get_db():
    """FastAPI-зависимость: одна Session на запрос, всегда закрывается."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
