from __future__ import annotations

import json
from pathlib import Path

from AI import lyrics_sources


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload, ensure_ascii=False).encode()


def test_online_lyrics_require_metadata_match_and_keep_synced_lines(tmp_path: Path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"not-an-audio-file")
    payload = [
        {
            "trackName": "Новая весна",
            "artistName": "4 Апреля",
            "duration": 230,
            "instrumental": False,
            "plainLyrics": "День застыл строкой\nВ новой песне мой апрель\n" * 8,
            "syncedLyrics": "[00:10.00] День застыл строкой\n[00:14.00] В новой песне мой апрель",
        }
    ]
    monkeypatch.setattr(lyrics_sources.urllib.request, "urlopen", lambda *_a, **_k: _Response(payload))

    found = lyrics_sources.discover_lyrics(
        source,
        title="4 Апреля - Новая весна [Новая Весна 2008]",
        duration_sec=230.8,
    )

    assert found.source == "LRCLIB"
    assert len(found.segments) == 2
    assert found.segments[0] == (10.0, 13.98, "День застыл строкой")


def test_online_lyrics_reject_wrong_track(tmp_path: Path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"not-an-audio-file")
    payload = [
        {
            "trackName": "Совсем другая песня",
            "artistName": "Другой артист",
            "duration": 230,
            "plainLyrics": "неверный текст " * 20,
        }
    ]
    monkeypatch.setattr(lyrics_sources.urllib.request, "urlopen", lambda *_a, **_k: _Response(payload))

    found = lyrics_sources.discover_lyrics(
        source,
        title="4 Апреля - Новая весна",
        duration_sec=230.8,
    )

    assert not found.text
    assert found.source is None
