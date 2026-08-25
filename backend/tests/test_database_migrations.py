from unittest.mock import MagicMock, Mock

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

import database
from tests._shared import patch_attrs, raises


def test_sqlite_connection_configuration_always_closes_cursor():
    cursor, connection = Mock(), Mock()
    connection.cursor.return_value = cursor

    database._configure_sqlite(connection, None)

    assert [call.args[0] for call in cursor.execute.call_args_list] == [
        "PRAGMA foreign_keys=ON",
        "PRAGMA journal_mode=WAL",
        "PRAGMA synchronous=NORMAL",
        "PRAGMA busy_timeout=30000",
    ]
    cursor.close.assert_called_once_with()

    cursor.reset_mock()
    cursor.execute.side_effect = RuntimeError("pragma failed")
    raises(RuntimeError, lambda: database._configure_sqlite(connection, None), match='pragma failed')
    cursor.close.assert_called_once_with()


def test_additive_migrations_execute_only_missing_columns():
    connection = Mock()
    database._apply_additive_migrations(
        connection,
        {"existing"},
        {"existing": "ALTER existing", "missing": "ALTER missing"},
    )
    assert str(connection.execute.call_args.args[0]) == "ALTER missing"


def test_audio_datetime_repair_handles_absent_and_incomplete_tables(monkeypatch):
    connection, inspector = Mock(), Mock()
    monkeypatch.setattr(database, "inspect", Mock(return_value=inspector))

    inspector.get_table_names.return_value = []
    database._repair_invalid_audio_settings_datetime(connection)
    connection.execute.assert_not_called()

    inspector.get_table_names.return_value = ["audio_settings"]
    inspector.get_columns.return_value = [{"name": "id"}]
    database._repair_invalid_audio_settings_datetime(connection)
    connection.execute.assert_not_called()

    inspector.get_columns.return_value = [{"name": "updated_at"}]
    database._repair_invalid_audio_settings_datetime(connection)
    assert "UPDATE audio_settings" in str(connection.execute.call_args.args[0])


def test_corrupted_audio_settings_repair_removes_only_invalid_rows():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE audio_settings ("
                "id INTEGER, volume, sensitivity, latency_ms, audio_driver, buffer_size, "
                "monitoring_enabled, reverb, echo, delay)"
            )
        )
        valid = {
            "id": 1,
            "volume": 1.0,
            "sensitivity": 0.5,
            "latency_ms": 50,
            "audio_driver": "auto",
            "buffer_size": 64,
            "monitoring_enabled": 0,
            "reverb": 0.0,
            "echo": 0.0,
            "delay": 0.0,
        }
        columns = ", ".join(valid)
        parameters = ", ".join(f":{name}" for name in valid)
        connection.execute(
            text(f"INSERT INTO audio_settings ({columns}) VALUES ({parameters})"), valid
        )
        connection.execute(
            text(f"INSERT INTO audio_settings ({columns}) VALUES ({parameters})"),
            valid | {"id": 2, "reverb": "broken"},
        )
        database._repair_corrupted_audio_settings(connection)
        assert connection.execute(text("SELECT id FROM audio_settings")).scalars().all() == [1]
    engine.dispose()


def test_corrupted_audio_settings_repair_skips_absent_or_legacy_table(monkeypatch):
    connection, inspector = Mock(), Mock()
    monkeypatch.setattr(database, "inspect", Mock(return_value=inspector))

    inspector.get_table_names.return_value = []
    database._repair_corrupted_audio_settings(connection)
    connection.execute.assert_not_called()

    inspector.get_table_names.return_value = ["audio_settings"]
    inspector.get_columns.return_value = [{"name": "id"}]
    database._repair_corrupted_audio_settings(connection)
    connection.execute.assert_not_called()


def test_interrupted_jobs_are_cancelled():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE songs (status TEXT, progress_step TEXT, "
                "progress_percent FLOAT, error_message TEXT)"
            )
        )
        connection.execute(text("INSERT INTO songs (status) VALUES ('QUEUED'), ('DONE')"))
        database._mark_interrupted_jobs(connection)
        rows = connection.execute(
            text("SELECT status, progress_step, progress_percent FROM songs ORDER BY rowid")
        ).all()
        assert rows == [("CANCELLED", "Interrupted", 0.0), ("DONE", None, None)]
    engine.dispose()


def test_init_db_orchestrates_schema_migrations_and_repairs(monkeypatch):
    engine, inspector = MagicMock(), Mock()
    inspector.get_columns.side_effect = [
        [{"name": "title"}],
        [{"name": "volume"}],
        [{"name": "filename"}],
    ]
    connection = engine.begin.return_value.__enter__.return_value
    patch_attrs(monkeypatch, database, engine=engine, inspect=Mock(return_value=inspector))
    create_all = Mock()
    monkeypatch.setattr(database.Base.metadata, "create_all", create_all)
    additive, datetime_repair, settings_repair, interrupted = Mock(), Mock(), Mock(), Mock()
    patch_attrs(monkeypatch, database, _apply_additive_migrations=additive, _repair_invalid_audio_settings_datetime=datetime_repair, _repair_corrupted_audio_settings=settings_repair, _mark_interrupted_jobs=interrupted)

    database.init_db()

    create_all.assert_called_once_with(bind=engine)
    assert additive.call_count == 3
    datetime_repair.assert_called_once_with(connection)
    settings_repair.assert_called_once_with(connection)
    interrupted.assert_called_once_with(connection)


def test_init_db_upgrades_a_real_pre_migration_database_in_place(monkeypatch):
    # A minimal stand-in for a database file saved by an old release: only the
    # columns that existed before every additive migration below was added.
    # This exercises the actual upgrade path end-to-end (not mocked), on a
    # StaticPool sqlite:// engine so the schema persists across connections
    # like a real file would, and checks existing data survives untouched.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, "
            "original_filename TEXT NOT NULL, source_path TEXT NOT NULL, "
            "slug TEXT UNIQUE NOT NULL, output_dir TEXT, status TEXT NOT NULL DEFAULT 'PENDING', "
            "progress_step TEXT, progress_percent FLOAT, error_message TEXT, "
            "key_override TEXT, tempo_override FLOAT, note_range_min INTEGER, "
            "note_range_max INTEGER, difficulty_override TEXT, show_lyrics BOOLEAN, "
            "show_notes BOOLEAN, optimized BOOLEAN, created_at DATETIME, updated_at DATETIME)"
        ))
        connection.execute(text(
            "INSERT INTO songs (id, title, original_filename, source_path, slug) "
            "VALUES ('old-song', 'Old Song', 'old.mp3', '/library/old-song/source.mp3', 'old-song')"
        ))
        connection.execute(text(
            "CREATE TABLE recordings (id TEXT PRIMARY KEY, song_id TEXT, filename TEXT NOT NULL, "
            "path TEXT NOT NULL, duration_sec FLOAT, sample_rate INTEGER, created_at DATETIME)"
        ))
        connection.execute(text(
            "INSERT INTO recordings (id, song_id, filename, path) "
            "VALUES ('old-rec', 'old-song', 'take.wav', '/library/old-song/recordings/take.wav')"
        ))

    patch_attrs(monkeypatch, database, engine=engine)
    # Real create_all: it only creates TABLES that don't exist yet (audio_settings,
    # playback_state, ...) and leaves the already-existing songs/recordings tables
    # alone, so this still exercises the additive-column-migration path for them.
    database.init_db()

    with engine.begin() as connection:
        song_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(songs)"))}
        recording_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(recordings)"))}
        assert {"video_url", "artist", "genre", "key_user_edited", "tempo_user_edited"} <= song_columns
        assert "playback_offset_sec" in recording_columns

        song = connection.execute(text("SELECT title, video_url FROM songs WHERE id = 'old-song'")).one()
        assert song == ("Old Song", None)
        recording = connection.execute(
            text("SELECT filename, playback_offset_sec FROM recordings WHERE id = 'old-rec'")
        ).one()
        assert recording == ("take.wav", 0)
    engine.dispose()


def test_database_dependency_closes_session(monkeypatch):
    session = Mock()
    monkeypatch.setattr(database, "SessionLocal", Mock(return_value=session))
    dependency = database.get_db()
    assert next(dependency) is session
    dependency.close()
    session.close.assert_called_once_with()
