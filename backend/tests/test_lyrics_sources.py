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


def test_search_tokens_rejects_unrelated_english_song():
    from AI.lyrics_sources import _search_tokens_match

    assert not _search_tokens_match(
        "TRITIA 31 я весна",
        "Sho Shallow - Jugg & Finesse lyrics",
    )


def test_search_tokens_accepts_matching_tritia_result():
    from AI.lyrics_sources import _search_tokens_match

    assert _search_tokens_match(
        "TRITIA 31 я весна",
        "TRITIA - 31-я весна текст песни lyrics",
    )


def test_filename_candidates_include_title_only_for_no_metadata(monkeypatch, tmp_path):
    from AI.lyrics_sources import _metadata_search_candidates

    source = tmp_path / "TRITIA-31-я весна(2).mp3"
    source.write_bytes(b"not-a-real-mp3")
    queries = _metadata_search_candidates(source, "TRITIA 31-я весна")
    assert queries[0] == "TRITIA 31 я весна"
    assert "31 я весна" in queries


def test_track_signature_splits_artist_before_numeric_title():
    from AI.lyrics_sources import _track_signature

    artist, title = _track_signature("TRITIA-31-я весна(2)")
    assert artist == "TRITIA"
    assert title == "31-я весна"


def test_discover_logs_exact_queries_before_lookup(monkeypatch, tmp_path):
    import AI.lyrics_sources as lyrics_sources

    source = tmp_path / "TRITIA-31-я весна(2).mp3"
    source.write_bytes(b"not-real-audio-for-parser-test")

    monkeypatch.setattr(
        lyrics_sources,
        "_metadata_search_candidates",
        lambda source, title: ["TRITIA 31 я весна", "31 я весна"],
    )
    monkeypatch.setattr(
        lyrics_sources,
        "_online",
        lambda query, duration: lyrics_sources.LyricsDiscovery(),
    )
    monkeypatch.setattr(
        lyrics_sources,
        "_web_online",
        lambda query: lyrics_sources.LyricsDiscovery(),
    )

    messages = []
    monkeypatch.setattr(lyrics_sources, "_lyrics_debug", messages.append)

    result = lyrics_sources.discover_lyrics(source)
    assert not result.text
    assert messages.index("[lyrics] SEARCH #1 BEGIN: TRITIA 31 я весна") < messages.index(
        "[lyrics] SEARCH #1 LRCLIB NOT FOUND: TRITIA 31 я весна"
    )
    assert "[lyrics] SEARCH #2 BEGIN: 31 я весна" in messages
    assert messages[-1] == "[lyrics] ALL SEARCH QUERIES FAILED -> ASR"


def test_temp_source_name_never_enters_search_plan(tmp_path):
    import AI.lyrics_sources as lyrics_sources

    source = tmp_path / "source.mp3"
    source.write_bytes(b"fake")

    assert lyrics_sources._metadata_search_candidates(
        source, "TRITIA - 31-я весна"
    ) == ["TRITIA 31 я весна", "31 я весна"]


def test_real_filename_can_supply_title_only_when_fallback_is_flat(tmp_path):
    import AI.lyrics_sources as lyrics_sources

    source = tmp_path / "TRITIA-31-я весна(2).mp3"
    source.write_bytes(b"fake")

    assert lyrics_sources._metadata_search_candidates(
        source, "TRITIA 31-я весна"
    ) == ["TRITIA 31 я весна", "31 я весна"]


def test_lrclib_synced_text_is_canonical_when_plain_text_has_extra_outro(tmp_path: Path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"not-an-audio-file")
    payload = [{
        "trackName": "31-я весна",
        "artistName": "TRITIA",
        "duration": 145,
        "instrumental": False,
        "plainLyrics": "первая строка песни\nвторая строка песни\nлишний повтор которого нет в аудио " * 5,
        "syncedLyrics": "[00:05.60] первая строка песни\n[00:10.39] вторая строка песни",
    }]
    monkeypatch.setattr(lyrics_sources.urllib.request, "urlopen", lambda *_a, **_k: _Response(payload))

    found = lyrics_sources.discover_lyrics(source, title="TRITIA - 31-я весна", duration_sec=145.1)

    assert found.text == "первая строка песни\nвторая строка песни"
    assert len(found.segments) == 2
    assert "лишний повтор" not in found.text
