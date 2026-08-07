"""
Настройка локальной SQLite-базы через SQLAlchemy.

SQLite выбрана потому, что это десктоп-программа: один файл на диске,
не нужен отдельный процесс сервера БД, работает "из коробки" без установки
чего-либо дополнительного пользователем.
"""

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

import config

# check_same_thread=False — нужно, т.к. FastAPI обрабатывает запросы в разных
# потоках (и фоновая обработка песни в pipeline_service тоже работает в
# отдельном потоке). Сама SQLite при этом не потокобезопасна "из коробки" для
# ОДНОГО соединения, поэтому мы открываем новую Session на каждый запрос/
# фоновую задачу через SessionLocal(), а не шарим одно соединение.
engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _configure_sqlite(dbapi_connection, _connection_record) -> None:
    """Enable integrity and concurrency settings for every SQLite connection."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
    finally:
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Shared declarative base for all persisted application models."""


_SONG_COLUMN_MIGRATIONS = {
    "video_url": "ALTER TABLE songs ADD COLUMN video_url VARCHAR",
    "artist": "ALTER TABLE songs ADD COLUMN artist VARCHAR",
    "genre": "ALTER TABLE songs ADD COLUMN genre VARCHAR",
}

_AUDIO_COLUMN_MIGRATIONS = {
    "audio_driver": (
        "ALTER TABLE audio_settings ADD COLUMN audio_driver VARCHAR DEFAULT 'auto'"
    ),
    "asio_driver_name": "ALTER TABLE audio_settings ADD COLUMN asio_driver_name VARCHAR",
    "buffer_size": "ALTER TABLE audio_settings ADD COLUMN buffer_size INTEGER DEFAULT 64",
    "output_device_id": "ALTER TABLE audio_settings ADD COLUMN output_device_id INTEGER",
    "reverb": "ALTER TABLE audio_settings ADD COLUMN reverb FLOAT DEFAULT 0",
    "echo": "ALTER TABLE audio_settings ADD COLUMN echo FLOAT DEFAULT 0",
    "delay": "ALTER TABLE audio_settings ADD COLUMN delay FLOAT DEFAULT 0",
}


def _apply_additive_migrations(connection, existing: set[str], migrations: dict[str, str]) -> None:
    """Apply missing-column migrations without rebuilding user tables."""
    for column, statement in migrations.items():
        if column not in existing:
            connection.execute(text(statement))




def _repair_invalid_audio_settings_datetime(connection) -> None:
    """Repair legacy/corrupted SQLite datetime values before ORM reads them."""
    inspector = inspect(connection)
    if "audio_settings" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("audio_settings")}
    if "updated_at" not in columns:
        return
    # SQLAlchemy's SQLite DateTime processor uses datetime.fromisoformat().
    # SQLite datetime(value) returns NULL for malformed values, letting us
    # repair only rows that the ORM would otherwise fail to deserialize.
    connection.execute(
        text(
            "UPDATE audio_settings "
            "SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') "
            "WHERE updated_at IS NULL "
            "OR typeof(updated_at) != 'text' "
            "OR datetime(updated_at) IS NULL"
        )
    )



def _repair_corrupted_audio_settings(connection) -> None:
    """Reset only the audio settings row when legacy values no longer fit the schema.

    Older application builds changed the AudioSettings layout several times. SQLite is
    dynamically typed, so a legacy row can survive migrations with values such as an
    ASIO driver name stored in a numeric effects column.  SQLAlchemy then either fails
    while deserializing the row or FastAPI rejects the response.  Audio settings are
    user preferences, not library data, so the safest recovery is to discard only the
    corrupted settings row and let the ORM recreate it with current defaults.
    """
    inspector = inspect(connection)
    if "audio_settings" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("audio_settings")}
    required = {
        "id", "volume", "sensitivity", "latency_ms", "audio_driver",
        "buffer_size", "monitoring_enabled", "reverb", "echo", "delay",
    }
    if not required.issubset(columns):
        return

    rows = connection.execute(
        text(
            "SELECT id, volume, sensitivity, latency_ms, audio_driver, buffer_size, "
            "monitoring_enabled, reverb, echo, delay FROM audio_settings"
        )
    ).mappings().all()

    def is_number(value) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    def in_range(value, low: float, high: float) -> bool:
        return is_number(value) and low <= float(value) <= high

    corrupted_ids: list[int] = []
    for row in rows:
        valid = (
            isinstance(row["id"], int)
            and in_range(row["volume"], 0.0, 4.0)
            and in_range(row["sensitivity"], 0.0, 1.0)
            and isinstance(row["latency_ms"], int)
            and row["latency_ms"] >= 0
            and isinstance(row["audio_driver"], str)
            and row["audio_driver"] in {"auto", "asio"}
            and isinstance(row["buffer_size"], int)
            and 16 <= row["buffer_size"] <= 2048
            and isinstance(row["monitoring_enabled"], int)
            and row["monitoring_enabled"] in {0, 1}
            and in_range(row["reverb"], 0.0, 1.0)
            and in_range(row["echo"], 0.0, 1.0)
            and in_range(row["delay"], 0.0, 1.0)
        )
        if not valid:
            corrupted_ids.append(int(row["id"]))

    for settings_id in corrupted_ids:
        connection.execute(
            text("DELETE FROM audio_settings WHERE id = :settings_id"),
            {"settings_id": settings_id},
        )


def _mark_interrupted_jobs(connection) -> None:
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


def init_db() -> None:
    """Create tables and apply backward-compatible SQLite migrations."""
    import models  # noqa: F401  (registers models before create_all)

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    song_columns = {column["name"] for column in inspector.get_columns("songs")}
    audio_columns = {column["name"] for column in inspector.get_columns("audio_settings")}
    with engine.begin() as connection:
        _apply_additive_migrations(connection, song_columns, _SONG_COLUMN_MIGRATIONS)
        _apply_additive_migrations(connection, audio_columns, _AUDIO_COLUMN_MIGRATIONS)
        _repair_invalid_audio_settings_datetime(connection)
        _repair_corrupted_audio_settings(connection)
        _mark_interrupted_jobs(connection)


def get_db():
    """FastAPI-зависимость: одна Session на запрос, всегда закрывается."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
