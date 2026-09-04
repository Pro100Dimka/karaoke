import time

from sqlalchemy import create_engine, insert
from sqlalchemy.orm import Session

import models
from app.services import song_service
from database import Base


def test_lists_five_thousand_song_library_within_interactive_budget():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.execute(
            insert(models.Song),
            [
                {
                    "id": f"song-{index:05d}",
                    "title": f"Song {index}",
                    "original_filename": f"song-{index}.wav",
                    "source_path": f"C:/library/song-{index}.wav",
                    "slug": f"song-{index}",
                    "status": models.SongStatus.DONE,
                }
                for index in range(5000)
            ],
        )
        db.commit()
        started = time.perf_counter()
        songs = song_service.list_songs(db)
        elapsed = time.perf_counter() - started
    engine.dispose()

    assert len(songs) == 5000
    assert elapsed < 5
