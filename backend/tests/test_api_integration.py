from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from app.main import app
from app.services import app_settings_service
from database import Base, get_db


@pytest.fixture
def api_client(monkeypatch, tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)

    def override_db():
        database = session_factory()
        try:
            yield database
        finally:
            database.close()

    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(
        app_settings_service, "UI_PREFERENCES_FILE", tmp_path / "ui-preferences.json"
    )
    monkeypatch.setattr(
        app_settings_service, "INSTALL_PREFERENCES_FILE", tmp_path / "install-preferences.json"
    )
    app.dependency_overrides[get_db] = override_db
    try:
        yield TestClient(app), session_factory
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_health_about_and_settings_contract(api_client):
    client, _sessions = api_client

    assert client.get("/").json() == {"name": "A&D Voice Backend", "docs": "/docs"}
    about = client.get("/about")
    assert about.status_code == 200
    assert about.json()["name"] == "A&D Voice"

    settings = client.get("/settings")
    assert settings.status_code == 200
    assert settings.json()["language"] == "uk"
    updated = client.patch("/settings", json={"language": "en", "theme": "violet"})
    assert updated.status_code == 200
    assert updated.json() | {"language": "en", "theme": "violet"} == updated.json()
    assert client.patch("/settings", json={"thread_count": 0}).status_code == 422
    assert client.patch("/settings", json={"compute_mode": "quantum"}).status_code == 422


def test_ui_preferences_validate_namespace_and_persist(api_client):
    client, _sessions = api_client

    assert client.get("/preferences").json() == {}
    response = client.patch("/preferences/karaoke", json={"speed": 1.25})
    assert response.status_code == 200
    assert response.json() == {"speed": 1.25}
    assert client.get("/preferences").json() == {"karaoke": {"speed": 1.25}}
    assert client.patch("/preferences/unknown", json={"x": 1}).status_code == 422
    assert client.patch("/preferences/radio", json={"x": "a" * 33_000}).status_code == 422


def test_history_joins_songs_recordings_and_analysis(api_client):
    client, sessions = api_client
    with sessions() as database:
        song = models.Song(
            id="song",
            title="Song",
            original_filename="song.wav",
            source_path="C:/song.wav",
            slug="song",
            status=models.SongStatus.DONE,
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        recording = models.Recording(
            id="recording",
            song_id="song",
            filename="voice.wav",
            path="C:/voice.wav",
            duration_sec=12.5,
            created_at=datetime(2026, 1, 2, tzinfo=UTC),
        )
        analysis = models.AnalysisResult(id="analysis", recording_id="recording")
        database.add_all([song, recording, analysis])
        database.commit()

    response = client.get("/history")
    assert response.status_code == 200
    items = response.json()
    assert [item["kind"] for item in items] == ["recording", "processing"]
    assert items[0]["status"] == "analyzed"
    assert items[0]["duration_seconds"] == 12.5


def test_missing_resources_have_stable_404_contract(api_client):
    client, _sessions = api_client

    response = client.get("/songs/missing")
    assert response.status_code == 404
    assert response.json()["detail"] == "Песня не найдена"
    assert client.get("/recording/missing").status_code == 404
