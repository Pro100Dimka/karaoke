from pathlib import Path

from sqlalchemy import create_engine, text

import database
from app.routers import songs as songs_router
from app.services import cache_service


def test_corrupted_audio_settings_row_is_reset():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text("""
            CREATE TABLE audio_settings (
                id INTEGER PRIMARY KEY,
                input_device_id INTEGER,
                input_device_name VARCHAR,
                output_device_id INTEGER,
                volume FLOAT,
                sensitivity FLOAT,
                latency_ms INTEGER,
                audio_driver VARCHAR,
                asio_driver_name VARCHAR,
                buffer_size INTEGER,
                monitoring_enabled BOOLEAN,
                reverb FLOAT,
                echo FLOAT,
                delay FLOAT,
                updated_at DATETIME
            )
        """)
        )
        connection.execute(
            text("""
            INSERT INTO audio_settings (
                id, volume, sensitivity, latency_ms, audio_driver,
                asio_driver_name, buffer_size, monitoring_enabled,
                reverb, echo, delay, updated_at
            ) VALUES (
                1, 1.0, 0.5, 50, 'asio', NULL, 64, 0,
                'Audient USB Audio ASIO Driver', 0.0, 0.0,
                '2026-08-07 20:00:00.000'
            )
        """)
        )
        database._repair_corrupted_audio_settings(connection)
        count = connection.execute(text("SELECT COUNT(*) FROM audio_settings")).scalar_one()
    assert count == 0


def test_audio_route_serves_ai_core_separated_stem(tmp_path, monkeypatch):
    stem = tmp_path / "separated" / "vocals.wav"
    stem.parent.mkdir(parents=True)
    stem.write_bytes(b"RIFF-test")
    monkeypatch.setattr(songs_router.song_service, "resolve_output_dir", lambda song: tmp_path)

    response = songs_router.get_audio_track("vocals", object())
    assert Path(response.path) == stem


def test_temp_cleanup_preserves_production_stems(tmp_path, monkeypatch):
    song_dir = tmp_path / "song-a"
    stem = song_dir / "separated" / "vocals.wav"
    stem.parent.mkdir(parents=True)
    stem.write_bytes(b"voice")
    temporary = song_dir / "tmp" / "scratch.bin"
    temporary.parent.mkdir(parents=True)
    temporary.write_bytes(b"1234")

    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", tmp_path)
    freed = cache_service.clear_temp_files()

    assert freed == 4
    assert stem.is_file()
    assert not temporary.exists()
