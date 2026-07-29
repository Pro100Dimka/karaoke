"""
CRUD над таблицей songs. Не знает про HTTP — роутер app/routers/songs.py
просто вызывает эти функции и превращает результат в JSON.
"""
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone


class SongNotFound(Exception):
    pass


class DuplicateFolderName(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify_folder_name(title: str) -> str:
    """
    Делает имя папки из названия песни. AI-пайплайн кладёт результаты
    в Song/<folder_name>/, поэтому имя должно быть безопасным для
    файловой системы, но само название (кириллица и т.д.) сохраняем —
    как и в исходном проекте (там папки типа "TRITIA-31-я весна").
    Убираем только символы, реально запрещённые в путях Windows/*nix.
    """
    name = unicodedata.normalize("NFC", title).strip()
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = re.sub(r"\s+", " ", name)
    return name[:150] if name else "untitled"


def create_song(conn: sqlite3.Connection, title: str, original_filename: str = None) -> dict:
    folder_name = slugify_folder_name(title)
    base_folder = folder_name
    suffix = 1
    while conn.execute("SELECT 1 FROM songs WHERE folder_name = ?", (folder_name,)).fetchone():
        suffix += 1
        folder_name = f"{base_folder} ({suffix})"

    now = _now()
    cur = conn.execute(
        """INSERT INTO songs (title, original_filename, folder_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?)""",
        (title, original_filename, folder_name, now, now),
    )
    conn.commit()
    return get_song(conn, cur.lastrowid)


def get_song(conn: sqlite3.Connection, song_id: int) -> dict:
    row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if row is None:
        raise SongNotFound(f"song {song_id} not found")
    return dict(row)


def get_song_by_folder(conn: sqlite3.Connection, folder_name: str) -> dict | None:
    row = conn.execute("SELECT * FROM songs WHERE folder_name = ?", (folder_name,)).fetchone()
    return dict(row) if row else None


def list_songs(conn: sqlite3.Connection, status: str = None) -> list:
    if status:
        rows = conn.execute(
            "SELECT * FROM songs WHERE status = ? ORDER BY created_at DESC", (status,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM songs ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


# поля, которые пользователь имеет право менять через PATCH /songs/{id}
EDITABLE_FIELDS = {
    "title", "key_override", "bpm_override", "time_signature_override",
    "difficulty_override", "note_range_min", "note_range_max",
    "show_lyrics", "show_notes",
}


def update_song(conn: sqlite3.Connection, song_id: int, fields: dict) -> dict:
    get_song(conn, song_id)  # 404, если нет
    updates = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not updates:
        return get_song(conn, song_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [_now(), song_id]
    conn.execute(f"UPDATE songs SET {set_clause}, updated_at = ? WHERE id = ?", params)
    conn.commit()
    return get_song(conn, song_id)


def set_status(conn: sqlite3.Connection, song_id: int, status: str, error_message: str = None) -> dict:
    get_song(conn, song_id)
    conn.execute(
        "UPDATE songs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
        (status, error_message, _now(), song_id),
    )
    conn.commit()
    return get_song(conn, song_id)


def delete_song(conn: sqlite3.Connection, song_id: int) -> None:
    get_song(conn, song_id)
    conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))  # каскад удалит jobs/recordings/analysis
    conn.commit()