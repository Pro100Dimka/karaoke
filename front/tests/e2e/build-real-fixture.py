"""Build a tiny, valid processed-song package for real-backend Playwright tests."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import soundfile as sf

import config
import models
from app.services import song_package_service
from tests._shared import make_song


def main() -> None:
    destination = Path(sys.argv[1]).resolve()
    output = config.SONG_OUTPUT_DIR / "fixture-source"
    output.mkdir(parents=True, exist_ok=True)
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    silence = np.zeros(8_000, dtype=np.float32)
    sf.write(output / "instrumental.flac", silence, 8_000, format="FLAC")
    sf.write(output / "vocals.flac", silence, 8_000, format="FLAC")
    (output / "lyricsSync.json").write_text(
        json.dumps(
            {
                "bpm": 120,
                "key": "C",
                "words": [
                    {
                        "text": "la",
                        "start": 0.0,
                        "end": 0.8,
                        "notes": [{"note": 60, "start": 0.0, "end": 0.8}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    song = make_song(
        id="real-e2e-song",
        title="Real backend E2E",
        artist="A&D Voice",
        source_path=str(output / "instrumental.flac"),
        output_dir=str(output),
        status=models.SongStatus.DONE,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    package = song_package_service.build_package(song)
    destination.parent.mkdir(parents=True, exist_ok=True)
    package.replace(destination)


if __name__ == "__main__":
    main()
