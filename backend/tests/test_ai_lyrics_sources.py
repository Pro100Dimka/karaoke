from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import URLError

import pytest

from AI import lyrics_sources as lyrics


class Response:
    def __init__(self, payload, charset=None):
        self.payload = payload if isinstance(payload, bytes) else payload.encode()
        self.headers = SimpleNamespace(get_content_charset=lambda: charset)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=None):
        return self.payload if size is None else self.payload[:size]


def test_html_parser_extracts_semantic_lyrics_and_skips_chords():
    parser = lyrics._LyricsHTMLParser()
    parser.feed(
        '<div itemprop="lyrics">one<br><span class="b-accord__symbol">C</span>'
        '<span class="single-line">two</span></div>'
        '<td class="lyrics-cell"><span class="pline">three</span></td>'
    )
    assert parser.text().splitlines() == ["one", "two", "three"]
    assert lyrics._LyricsHTMLParser._attrs([("x", None)]) == {"x": ""}
    lyrics._LyricsHTMLParser().handle_endtag("div")


def test_clean_and_parse_lrc_variants():
    raw = "\ufeff[ar:artist]\n[00:00.00]Hello world\n[00:03:00]Again now\n[99:00]"
    assert lyrics._clean(raw) == "Hello world\nAgain now"
    assert lyrics._parse_lrc(raw, 4) == (
        (0.0, pytest.approx(2.985), "Hello world"),
        (3.0, pytest.approx(3.995), "Again now"),
    )
    single = lyrics._parse_lrc("[00:01]one two", 5)
    assert single[0][0] == 1 and single[0][1] < 5
    inferred = lyrics._parse_lrc("[00:01]one two three")
    assert inferred[0][1] > 1
    assert lyrics._parse_lrc("plain text") == ()


def test_local_sidecars(monkeypatch, tmp_path):
    source = tmp_path / "song.mp3"
    source.touch()
    (tmp_path / "song.lrc").write_text("[00:01]one two three", encoding="utf-8")
    result = lyrics._local_file(source)
    assert result.source == "sidecar" and result.segments
    (tmp_path / "song.lrc").write_bytes(b"\xff")
    (tmp_path / "song.txt").write_text("too short", encoding="utf-8")
    assert not lyrics._local_file(source).text
    monkeypatch.setattr(type(tmp_path / "song.lrc"), "read_text", Mock(side_effect=OSError))
    assert not lyrics._local_file(source).text
    assert not lyrics._local_file(tmp_path / "absent.mp3").text


@pytest.mark.parametrize("tags_kind", ["id3", "mapping", "missing", "error"])
def test_embedded_lyrics(monkeypatch, tmp_path, tags_kind):
    source = tmp_path / "song.mp3"
    source.touch()
    if tags_kind == "error":
        module = SimpleNamespace(File=Mock(side_effect=RuntimeError))
    elif tags_kind == "missing":
        module = SimpleNamespace(File=lambda _: SimpleNamespace(tags=None))
    elif tags_kind == "id3":
        tags = SimpleNamespace(
            getall=lambda _: [SimpleNamespace(text="one two three four")],
            get=lambda _key: None,
        )
        module = SimpleNamespace(File=lambda _: SimpleNamespace(tags=tags))
    else:

        class Tags(dict):
            getall = None

        tags = Tags(LYRICS=["one two three", "one two three four five"])
        module = SimpleNamespace(File=lambda _: SimpleNamespace(tags=tags))
    monkeypatch.setitem(sys.modules, "mutagen", module)
    value = lyrics._embedded(source)
    assert bool(value) is (tags_kind in {"id3", "mapping"})


def test_embedded_scalar_and_broken_tag_access(monkeypatch, tmp_path):
    class Tags:
        getall = None

        def get(self, key):
            if key == "LYRICS":
                return "one two three four"
            if key == "lyrics":
                raise RuntimeError("broken tag")
            return None

    monkeypatch.setitem(
        sys.modules,
        "mutagen",
        SimpleNamespace(File=lambda _: SimpleNamespace(tags=Tags())),
    )
    assert lyrics._embedded(tmp_path / "song.mp3") == "one two three four"


def test_names_signatures_similarity_and_search_guards():
    assert lyrics._normalize_name(" Song (Official Video) ") == "song"
    assert lyrics._track_signature("Artist - Song (HD)") == ("Artist", "Song")
    assert lyrics._track_signature("Song") == ("", "Song")
    assert lyrics._similarity("Song", "song") == 1
    assert lyrics._search_tokens_match("artist great song", "Artist — Great Song lyrics")
    assert lyrics._search_tokens_match("great song", "Great song")
    assert not lyrics._search_tokens_match("", "anything")
    assert not lyrics._search_tokens_match("different song", "other song")
    safe = "https://genius.com/artist-song"
    wrapped = "https://duckduckgo.com/l/?uddg=" + lyrics.urllib.parse.quote(safe)
    assert lyrics._safe_result_url(wrapped) == safe
    assert lyrics._safe_result_url("http://genius.com/x") is None
    assert lyrics._safe_result_url("https://example.com/x") is None


def lrclib_record(**changes):
    record = {
        "trackName": "Great Song",
        "artistName": "Great Artist",
        "duration": 100,
        "plainLyrics": " ".join(["word"] * 20),
        "syncedLyrics": "[00:01]one two three\n[00:04]four five six",
    }
    record.update(changes)
    return record


def test_online_disabled_invalid_and_request_failure(monkeypatch):
    monkeypatch.setenv("KARAOKE_ONLINE_LYRICS", "off")
    assert not lyrics._online("Artist - Song", 1).text
    monkeypatch.setenv("KARAOKE_ONLINE_LYRICS", "1")
    assert not lyrics._online("", 1).text
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", Mock(side_effect=URLError("offline")))
    assert not lyrics._online("Artist - Song", 1).text


def test_online_rejects_bad_payloads_and_selects_best(monkeypatch):
    bad = [None, {"instrumental": True}, {"plainLyrics": "short"}]
    monkeypatch.setattr(
        lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response(json.dumps(bad))
    )
    assert not lyrics._online("Great Artist - Great Song", 100).text

    records = [
        lrclib_record(trackName="Wrong", artistName="Great Artist"),
        lrclib_record(artistName="Wrong"),
        lrclib_record(duration=140),
        lrclib_record(),
    ]
    monkeypatch.setattr(
        lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response(json.dumps(records))
    )
    result = lyrics._online("Great Artist - Great Song", 100)
    assert result.source == "LRCLIB" and result.segments and result.text.startswith("one")


def test_online_title_only_plain_fallback_and_non_list(monkeypatch):
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response("{}"))
    assert not lyrics._online("Great Song", None).text
    record = lrclib_record(syncedLyrics="", artistName="", trackName="Great Song")
    monkeypatch.setattr(
        lyrics.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response(json.dumps([record])),
    )
    result = lyrics._online("Great Song", None)
    assert result.source == "LRCLIB" and not result.segments
    mismatch = lrclib_record(trackName="Other", artistName="Someone")
    monkeypatch.setattr(
        lyrics.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response(json.dumps([mismatch])),
    )
    assert not lyrics._online("Great Song", None).text


def test_web_search_parses_only_safe_matching_results(monkeypatch):
    page = (
        '<a class="result__a" href="https://genius.com/x"><b>Great</b> Song</a>'
        '<a class="result__a" href="http://genius.com/y">Great Song</a>'
    )
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response(page))
    assert lyrics._web_search("Great Song") == [("https://genius.com/x", "Great Song")]
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", Mock(side_effect=OSError))
    assert lyrics._web_search("Great Song") == []


def test_fetch_web_lyrics_semantic_special_encoding_and_failures(monkeypatch):
    body = '<meta charset="utf-8"><div itemprop="lyrics">' + "word " * 35 + "</div>"
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response(body))
    assert len(lyrics._fetch_web_lyrics("https://genius.com/x").split()) == 35

    special = '<div class="cls">ad</div><br><div>' + "слово<br>" * 35 + "</div>"
    monkeypatch.setattr(
        lyrics.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response(special.encode("cp1251"), "windows-1251"),
    )
    assert len(lyrics._fetch_web_lyrics("https://tekstipesen.com/x").split()) == 35
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", Mock(side_effect=OSError))
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""
    monkeypatch.setattr(
        lyrics.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response(b"<meta charset='bad-codec'>\x98"),
    )
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""
    monkeypatch.setattr(
        lyrics, "_LyricsHTMLParser", lambda: SimpleNamespace(feed=Mock(side_effect=ValueError))
    )
    monkeypatch.setattr(
        lyrics.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: Response("plain undecorated page"),
    )
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""


def test_web_online_success_and_failure(monkeypatch):
    monkeypatch.setattr(lyrics, "_web_search", lambda _: [("https://genius.com/x", "Song")])
    monkeypatch.setattr(lyrics, "_fetch_web_lyrics", lambda _: "word " * 30)
    assert lyrics._web_online("Song").source == "web:genius.com"
    assert not lyrics._web_online(None).text
    monkeypatch.setattr(lyrics, "_fetch_web_lyrics", lambda _: "")
    assert not lyrics._web_online("Song").text


def test_query_helpers_and_metadata_candidates(monkeypatch, tmp_path):
    assert lyrics._plain_search_query("Artist - Song (2020 remaster)") == "Artist Song"
    assert lyrics._strip_filename_copy_suffix("Song (2)") == "Song"
    source = tmp_path / "Artist-Song(2).mp3"
    source.touch()
    assert lyrics._filename_search_identity(source) == ("Artist", "Song")

    audio = {"title": ["Song"], "artist": ["Artist Song (2020) Single"]}
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: audio))
    assert lyrics._metadata_search_candidates(source, "Fallback") == ["Artist Song"]
    monkeypatch.setitem(
        sys.modules, "mutagen", SimpleNamespace(File=Mock(side_effect=RuntimeError))
    )
    assert lyrics._metadata_search_candidates(tmp_path / "source.wav", "Artist - Song") == [
        "Artist Song"
    ]
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: {}))
    assert lyrics._metadata_search_candidates(source, None) == ["Artist Song"]
    assert lyrics._metadata_search_candidates(tmp_path / "Title.mp3", "Fallback") == [
        "Fallback",
        "Title",
    ]
    blank = {"title": [" "]}
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: blank))
    assert lyrics._metadata_search_candidates(source, None) == ["Artist Song"]


def test_discover_lyrics_query_order(monkeypatch, tmp_path):
    monkeypatch.setattr(lyrics, "_local_file", lambda *_: lyrics.LyricsDiscovery())
    monkeypatch.setattr(lyrics, "_embedded", lambda _: "")
    monkeypatch.setattr(lyrics, "_metadata_search_candidates", lambda *_: ["first", "second"])
    monkeypatch.setattr(
        lyrics,
        "_online",
        lambda query, _duration: (
            lyrics.LyricsDiscovery("found", "LRCLIB")
            if query == "second"
            else lyrics.LyricsDiscovery()
        ),
    )
    monkeypatch.setattr(lyrics, "_web_online", lambda _: lyrics.LyricsDiscovery())
    result = lyrics.discover_lyrics(tmp_path / "song.mp3")
    assert result.text == "found" and result.query == "second"
    monkeypatch.setattr(lyrics, "_online", lambda *_: lyrics.LyricsDiscovery())
    monkeypatch.setattr(
        lyrics,
        "_web_online",
        lambda query: (
            lyrics.LyricsDiscovery("web", "web:test")
            if query == "first"
            else lyrics.LyricsDiscovery()
        ),
    )
    assert lyrics.discover_lyrics(tmp_path / "song.mp3").query == "first"
    monkeypatch.setattr(lyrics, "_web_online", lambda _: lyrics.LyricsDiscovery())
    assert not lyrics.discover_lyrics(tmp_path / "song.mp3").text


def test_discover_lyrics_prefers_sidecar_then_embedded(monkeypatch, tmp_path):
    source = tmp_path / "song.mp3"
    monkeypatch.setattr(
        lyrics,
        "_local_file",
        lambda path, duration: lyrics.LyricsDiscovery(f"{path.name}:{duration}", "sidecar"),
    )
    monkeypatch.setattr(lyrics, "_embedded", Mock())
    assert lyrics.discover_lyrics(source, duration_sec=3).source == "sidecar"
    lyrics._embedded.assert_not_called()
    monkeypatch.setattr(lyrics, "_local_file", lambda *_: lyrics.LyricsDiscovery())
    monkeypatch.setattr(lyrics, "_embedded", lambda _: "one two three")
    monkeypatch.setattr(lyrics, "_metadata_search_candidates", Mock())
    assert lyrics.discover_lyrics(source).source == "metadata"
    lyrics._metadata_search_candidates.assert_not_called()
