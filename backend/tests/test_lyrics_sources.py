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

    def read(self, *_args):
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
    monkeypatch.setattr(
        lyrics_sources.urllib.request, "urlopen", lambda *_a, **_k: _Response(payload)
    )

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
    monkeypatch.setattr(
        lyrics_sources.urllib.request, "urlopen", lambda *_a, **_k: _Response(payload)
    )

    found = lyrics_sources.discover_lyrics(
        source,
        title="4 Апреля - Новая весна",
        duration_sec=230.8,
    )

    assert not found.text
    assert found.source is None


def test_online_lyrics_accept_filename_without_spaces_around_dash(tmp_path: Path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"not-an-audio-file")
    payload = [
        {
            "trackName": "31-я весна",
            "artistName": "TRITIA",
            "duration": 145,
            "instrumental": False,
            "plainLyrics": "Большой широкий город магистрали и дома\n" * 8,
        }
    ]
    captured_url = ""

    def fake_urlopen(request, **_kwargs):
        nonlocal captured_url
        captured_url = request.full_url
        return _Response(payload)

    monkeypatch.setattr(lyrics_sources.urllib.request, "urlopen", fake_urlopen)

    found = lyrics_sources.discover_lyrics(
        source,
        title="TRITIA-31-я весна",
        duration_sec=145.1,
    )

    assert found.source == "LRCLIB"
    assert "q=" in captured_url


def test_track_signature_accepts_one_sided_ascii_dash():
    artist, title = lyrics_sources._track_signature("4 Апреля -Падаем вниз")

    assert artist == "4 Апреля"
    assert title == "Падаем вниз"


def test_clean_removes_section_labels_but_keeps_lyrics():
    value = lyrics_sources._clean("Куплет 1:\nПервая строка песни\nПрипев:\nВторая строка песни")

    assert value == "Первая строка песни\nВторая строка песни"


def test_web_search_is_used_before_asr_when_lrclib_has_no_record(tmp_path: Path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"not-an-audio-file")
    search_page = b"""<a class="result__a" href="https://muztext.com/lyrics/example-song">
        Example Artist - Example Song lyrics</a>"""
    lyrics_page = (
        '<table><tr><td class="lyrics-cell">First verified lyric line</td></tr>'
        + '<tr><td class="lyrics-cell">Second verified lyric line with enough words</td></tr>' * 6
        + "</table>"
    ).encode()

    def fake_urlopen(request, **_kwargs):
        url = request.full_url
        if "lrclib.net" in url:
            return _Response([])
        if "duckduckgo.com" in url:
            return _ByteResponse(search_page)
        return _ByteResponse(lyrics_page)

    monkeypatch.setattr(lyrics_sources.urllib.request, "urlopen", fake_urlopen)

    found = lyrics_sources.discover_lyrics(
        source,
        title="Example Artist - Example Song",
        duration_sec=180,
    )

    assert found.source == "web:muztext.com"
    assert "First verified lyric line" in found.text


class _ByteResponse(_Response):
    def read(self, *_args):
        return self.payload
