"""
Слой работы с SQLite. Без ORM — на чистом sqlite3 из стандартной библиотеки,
это всё что нужно для локальной десктопной программы (один файл на диске,
процесс backend — единственный, кто в него пишет).

Использование:
    from app.database import get_connection
    with get_connection() as conn:
        conn.execute("SELECT ...")
"""
import contextlib
import sqlite3
from pathlib import Path

from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    title                   TEXT NOT NULL,
    original_filename       TEXT,
    folder_name             TEXT NOT NULL UNIQUE,
    status                  TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
    error_message           TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,

    -- пользовательские переопределения (не трогают файлы AI, только отображение)
    key_override            TEXT,
    bpm_override            REAL,
    time_signature_override TEXT,
    difficulty_override     REAL,
    note_range_min          INTEGER,
    note_range_max          INTEGER,
    show_lyrics             INTEGER NOT NULL DEFAULT 1,
    show_notes              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id         INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|error|cancelled
    stage           TEXT,
    progress        REAL NOT NULL DEFAULT 0.0,
    log_tail        TEXT,
    error_message   TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id         INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    duration_sec    REAL,
    device_name     TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_analysis (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id        INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    song_id             INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|error
    overall_accuracy    REAL,
    avg_deviation_cents REAL,
    per_section_json    TEXT,
    error_message       TEXT,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_song ON processing_jobs(song_id);
CREATE INDEX IF NOT EXISTS idx_recordings_song ON recordings(song_id);
CREATE INDEX IF NOT EXISTS idx_analysis_recording ON voice_analysis(recording_id);
"""


def get_connection(db_path: Path = None) -> sqlite3.Connection:
    """Новое соединение с БД. row_factory=Row, чтобы читать как dict-подобные объекты.
    foreign_keys включены явно — в sqlite3 они по умолчанию выключены."""
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path = None) -> None:
    """Создаёт таблицы, если их ещё нет. Безопасно вызывать при каждом старте."""
    with contextlib.closing(get_connection(db_path)) as conn:
        conn.executescript(SCHEMA)
        conn.commit()