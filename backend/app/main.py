from app import config
from app.database.database import SessionLocal, init_db
from app.database.models import Song


def test_config():
    print("=== CONFIG ===")
    print("BASE_DIR:", config.BASE_DIR)
    print("AI_DIR:", config.AI_DIR)
    print("FULL_SONGS_DIR:", config.FULL_SONGS_DIR)
    print("SONG_OUTPUT_DIR:", config.SONG_OUTPUT_DIR)
    print("DB_PATH:", config.DB_PATH)
    print()


def test_database():
    print("=== DATABASE ===")
    init_db()
    print("SQLite успешно инициализирован.")
    print()


def test_models():
    print("=== MODELS ===")

    db = SessionLocal()

    song = Song(
        title="Test Song",
        original_filename="test.mp3",
        source_path="full_songs/test.mp3",
        slug="test-song",
    )

    db.add(song)
    db.commit()
    db.refresh(song)

    print("Song ID:", song.id)
    print("Title:", song.title)
    print("Status:", song.status)

    db.close()
    print()


if __name__ == "__main__":
    test_config()
    test_database()
    test_models()