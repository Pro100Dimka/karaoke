
import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import URLError

import pytest

from AI import lyrics_sources as lyrics
from tests._shared import patch_attrs, patch_many


class Response:
    def __init__(self, payload, charset=None):
        self.payload = payload if isinstance(payload, bytes) else payload.encode()
        self.headers = SimpleNamespace(get_content_charset=lambda: charset)

    def __enter__(self): return self

    def __exit__(self, *_): return False

    def read(self, size=None): return self.payload if size is None else self.payload[:size]


def test_html_parser_extracts_semantic_lyrics_and_skips_chords():
    parser = lyrics._LyricsHTMLParser()
    parser.feed(
        '<div itemprop="lyrics">one<br><span class="b-accord__symbol">C</span>'
        '<span class="single-line">two</span></div>'
        '<td class="lyrics-cell"><span class="pline">three</span></td>'
    )
    assert (parser.text().splitlines() == ['one', 'two', 'three']) and (lyrics._LyricsHTMLParser._attrs([('x', None)]) == {'x': ''})
    lyrics._LyricsHTMLParser().handle_endtag("div")


def test_clean_and_parse_lrc_variants():
    raw = "\ufeff[ar:artist]\n[00:00.00]Hello world\n[00:03:00]Again now\n[99:00]"
    assert (lyrics._clean(raw) == 'Hello world\nAgain now') and (lyrics._parse_lrc(raw, 4) == ((0.0, pytest.approx(2.985), 'Hello world'), (3.0, pytest.approx(3.995), 'Again now')))
    single = lyrics._parse_lrc("[00:01]one two", 5)
    assert single[0][0] == 1 and single[0][1] < 5
    inferred = lyrics._parse_lrc("[00:01]one two three")
    assert (inferred[0][1] > 1) and (lyrics._parse_lrc('plain text') == ())


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
    assert (not lyrics._local_file(source).text) and (not lyrics._local_file(tmp_path / 'absent.mp3').text)


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
            if key == "LYRICS": return "one two three four"
            if key == "lyrics": raise RuntimeError("broken tag")
            return None

    monkeypatch.setitem(
        sys.modules,
        "mutagen",
        SimpleNamespace(File=lambda _: SimpleNamespace(tags=Tags())),
    )
    assert lyrics._embedded(tmp_path / "song.mp3") == "one two three four"


def test_names_signatures_similarity_and_search_guards():
    assert (lyrics._normalize_name(' Song (Official Video) ') == 'song') and (lyrics._track_signature('Artist - Song (HD)') == ('Artist', 'Song')) and (lyrics._track_signature('Song') == ('', 'Song')) and (lyrics._similarity('Song', 'song') == 1) and (lyrics._search_tokens_match('artist great song', 'Artist — Great Song lyrics')) and (lyrics._search_tokens_match('great song', 'Great song')) and (not lyrics._search_tokens_match('', 'anything')) and (not lyrics._search_tokens_match('different song', 'other song'))
    safe = "https://genius.com/artist-song"
    wrapped = "https://duckduckgo.com/l/?uddg=" + lyrics.urllib.parse.quote(safe)
    assert (lyrics._safe_result_url(wrapped) == safe) and (lyrics._safe_result_url('http://genius.com/x') is None) and (lyrics._safe_result_url('https://example.com/x') is None)


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
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(json.dumps(bad)))
    assert not lyrics._online("Great Artist - Great Song", 100).text

    records = [
        lrclib_record(trackName="Wrong", artistName="Great Artist"),
        lrclib_record(artistName="Wrong"),
        lrclib_record(duration=140),
        lrclib_record(),
    ]
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(json.dumps(records)))
    result = lyrics._online("Great Artist - Great Song", 100)
    assert result.source == "LRCLIB" and result.segments and result.text.startswith("one")


def test_online_title_only_plain_fallback_and_non_list(monkeypatch):
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", lambda *_args, **_kwargs: Response("{}"))
    assert not lyrics._online("Great Song", None).text
    record = lrclib_record(syncedLyrics="", artistName="", trackName="Great Song")
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(json.dumps([record])))
    result = lyrics._online("Great Song", None)
    assert result.source == "LRCLIB" and not result.segments
    mismatch = lrclib_record(trackName="Other", artistName="Someone")
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(json.dumps([mismatch])))
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
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(special.encode('cp1251'), 'windows-1251'))
    assert len(lyrics._fetch_web_lyrics("https://tekstipesen.com/x").split()) == 35
    monkeypatch.setattr(lyrics.urllib.request, "urlopen", Mock(side_effect=OSError))
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(b"<meta charset='bad-codec'>\x98"))
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""
    patch_attrs(monkeypatch, lyrics, _LyricsHTMLParser=lambda: SimpleNamespace(feed=Mock(side_effect=ValueError)))
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response('plain undecorated page'))
    assert lyrics._fetch_web_lyrics("https://genius.com/x") == ""


def test_fetch_mychords_lyrics_drops_chord_header(monkeypatch):
    body = (
        '<meta charset="utf-8"><div itemprop="lyrics">'
        'Песня на: E G A D<br>'
        + 'строка песни<br>' * 35
        + '</div>'
    )
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(body, 'utf-8'))
    value = lyrics._fetch_web_lyrics(
        "https://mychords.net/ru/nervi/22635-nervy-moya-ledi.html"
    )
    assert ('Песня на:' not in value) and (len(value.splitlines()) == 35)


def test_web_online_success_and_failure(monkeypatch):
    patch_attrs(monkeypatch, lyrics, _web_search=lambda _: [('https://genius.com/x', 'Song')], _fetch_web_lyrics=lambda _: 'word ' * 30)
    assert (lyrics._web_online('Song').source == 'web:genius.com') and (not lyrics._web_online(None).text)
    monkeypatch.setattr(lyrics, "_fetch_web_lyrics", lambda _: "")
    assert not lyrics._web_online("Song").text


def test_query_helpers_and_metadata_candidates(monkeypatch, tmp_path):
    assert (lyrics._plain_search_query('Artist - Song (2020 remaster)') == 'Artist Song') and (lyrics._strip_filename_copy_suffix('Song (2)') == 'Song')
    source = tmp_path / "Artist-Song(2).mp3"
    source.touch()
    assert lyrics._filename_search_identity(source) == ("Artist", "Song")

    audio = {"title": ["Song"], "artist": ["Artist Song (2020) Single"]}
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: audio))
    assert [candidate.query for candidate in lyrics._metadata_search_plan(source, "Fallback")] == ["Artist Song"]

    monkeypatch.setitem(
        sys.modules, "mutagen", SimpleNamespace(File=Mock(side_effect=RuntimeError))
    )
    assert [candidate.query for candidate in lyrics._metadata_search_plan(tmp_path / "source.wav", "Artist - Song")] == [
        "Artist Song"
    ]
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: {}))
    assert ([candidate.query for candidate in lyrics._metadata_search_plan(source, None)] == ['Artist Song']) and ([candidate.query for candidate in lyrics._metadata_search_plan(tmp_path / 'Title.mp3', 'Fallback')] == ['Fallback', 'Title'])
    blank = {"title": [" "]}
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: blank))
    assert [candidate.query for candidate in lyrics._metadata_search_plan(source, None)] == ["Artist Song"]

    noisy, noisy_source = {'title': ['Нервы Моя Леди'], 'artist': ['Нервы Всё, Что Вокруг'], 'album': ['Всё, Что Вокруг']}, tmp_path / 'Нервы-Моя Леди.mp3'
    noisy_source.touch()
    monkeypatch.setitem(sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: noisy))
    assert [candidate.query for candidate in lyrics._metadata_search_plan(noisy_source, None)] == [
        "Нервы Моя Леди",
        "Моя Леди",
    ]

    noisy_without_album = {
        "title": ["Нервы Моя Леди"],
        "artist": ["Нервы Всё, Что Вокруг"],
    }
    monkeypatch.setitem(
        sys.modules, "mutagen", SimpleNamespace(File=lambda *_a, **_k: noisy_without_album)
    )
    assert [candidate.query for candidate in lyrics._metadata_search_plan(
        tmp_path / "source.wav", "Нервы - Моя Леди"
    )] == ["Нервы Моя Леди", "Моя Леди"]

    plan = lyrics._metadata_search_plan(tmp_path / "source.wav", "Нервы - Моя Леди")
    assert (plan[0] == lyrics.LyricsSearchCandidate(query='Нервы Моя Леди', artist='Нервы', track='Моя Леди')) and (plan[1] == lyrics.LyricsSearchCandidate(query='Моя Леди', track='Моя Леди'))


def test_search_title_matching_accepts_exact_tokens_with_site_noise():
    assert lyrics._search_tokens_match(
        'Нервы Моя Леди', 'Текст песни Нервы - Моя леди перевод, слова и видео'
    )
    assert not lyrics._search_tokens_match('Нервы Моя Леди', 'Стас Пьеха - Моя прекрасная леди')


def test_web_search_keeps_alternative_sources_after_mychords_results(monkeypatch):
    monkeypatch.setattr(
        lyrics,
        '_duckduckgo_search',
        lambda query, _title: [('https://mychords.net/ru/a.html', 'Artist - Song')]
        if query.startswith('site:')
        else [('https://genius.com/artist-song-lyrics', 'Artist - Song Lyrics')],
    )
    assert [url for url, _title in lyrics._web_search('Artist Song')] == [
        'https://genius.com/artist-song-lyrics',
        'https://mychords.net/ru/a.html',
    ]


def test_online_structured_candidate_preserves_artist_and_track(monkeypatch):
    seen = {}

    def fake_urlopen(request, **_kwargs):
        seen["url"] = request.full_url
        return Response("[]")

    monkeypatch.setattr(lyrics.urllib.request, "urlopen", fake_urlopen)
    candidate = lyrics.LyricsSearchCandidate(
        query="Нервы Моя Леди", artist="Нервы", track="Моя Леди"
    )
    assert not lyrics._online(candidate, None).text
    parsed = lyrics.urllib.parse.urlparse(seen["url"])
    params = lyrics.urllib.parse.parse_qs(parsed.query)
    assert (params == {'track_name': ['Моя Леди'], 'artist_name': ['Нервы']}) and ('q' not in params)


def test_title_fallback_never_drops_known_artist(monkeypatch, tmp_path):
    patch_attrs(monkeypatch, lyrics, _local_file=lambda *_: lyrics.LyricsDiscovery(), _embedded=lambda _: '', _metadata_search_plan=lambda *_: [lyrics.LyricsSearchCandidate('Нервы Моя Леди', 'Нервы', 'Моя Леди'), lyrics.LyricsSearchCandidate('Моя Леди', 'Нервы', 'Моя Леди')])
    seen = []

    def fake_online(candidate, _duration):
        seen.append((candidate.query, candidate.artist, candidate.track))
        return lyrics.LyricsDiscovery()

    patch_attrs(monkeypatch, lyrics, _online=fake_online, _web_online=lambda *_: lyrics.LyricsDiscovery())
    lyrics.discover_lyrics(tmp_path / "song.mp3")
    assert seen == [
        ("Нервы Моя Леди", "Нервы", "Моя Леди"),
        ("Моя Леди", "Нервы", "Моя Леди"),
    ]


def test_lrclib_does_not_log_unrelated_artist(monkeypatch, capsys):
    monkeypatch.setenv("KARAOKE_LYRICS_VERBOSE", "1")
    unrelated = lrclib_record(
        artistName="Stas Piekha",
        trackName="Моя прекрасная леди",
        plainLyrics="слово " * 30,
    )
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_a, **_k: Response(json.dumps([unrelated], ensure_ascii=False)))
    candidate = lyrics.LyricsSearchCandidate(
        query="Моя Леди", artist="Нервы", track="Моя Леди"
    )
    assert not lyrics._online(candidate, None).text
    output = capsys.readouterr().out
    assert "Stas Piekha" not in output


def test_discover_lyrics_query_order(monkeypatch, tmp_path):
    patch_attrs(monkeypatch, lyrics, _local_file=lambda *_: lyrics.LyricsDiscovery(), _embedded=lambda _: '', _metadata_search_plan=lambda *_: [lyrics.LyricsSearchCandidate('first', 'Artist', 'First'), lyrics.LyricsSearchCandidate('second', 'Artist', 'Second')], _online=lambda candidate, _duration: lyrics.LyricsDiscovery('found', 'LRCLIB') if candidate.query == 'second' else lyrics.LyricsDiscovery(), _web_online=lambda _: lyrics.LyricsDiscovery())
    result = lyrics.discover_lyrics(tmp_path / "song.mp3")
    assert result.text == "found" and result.query == "second"
    patch_attrs(monkeypatch, lyrics, _online=lambda *_: lyrics.LyricsDiscovery(), _web_online=lambda query: lyrics.LyricsDiscovery('web', 'web:test') if getattr(query, 'query', query) == 'first' else lyrics.LyricsDiscovery())
    assert lyrics.discover_lyrics(tmp_path / "song.mp3").query == "first"
    monkeypatch.setattr(lyrics, "_web_online", lambda _: lyrics.LyricsDiscovery())
    assert not lyrics.discover_lyrics(tmp_path / "song.mp3").text


def test_lyrics_logging_is_compact_by_default_and_verbose_on_demand(monkeypatch, tmp_path):
    patch_attrs(monkeypatch, lyrics, _local_file=lambda *_: lyrics.LyricsDiscovery(), _embedded=lambda _: '', _metadata_search_plan=lambda *_: [lyrics.LyricsSearchCandidate('first', 'Artist', 'First'), lyrics.LyricsSearchCandidate('second', 'Artist', 'Second')], _online=lambda candidate, _duration: lyrics.LyricsDiscovery('found', 'LRCLIB') if candidate.query == 'second' else lyrics.LyricsDiscovery(), _web_online=lambda _: lyrics.LyricsDiscovery())
    concise, verbose = [], []
    patch_attrs(monkeypatch, lyrics, _lyrics_log=concise.append, _lyrics_debug=verbose.append)
    result = lyrics.discover_lyrics(tmp_path / "song.mp3")
    assert (result.text, concise, verbose) == ('found', ["[lyrics] exact search plan (2 queries): ['first', 'second']", '[lyrics] FOUND via LRCLIB: second'], ['[lyrics] SEARCH #1 BEGIN: first', '[lyrics] SEARCH #1 LRCLIB NOT FOUND: first', '[lyrics] SEARCH #1 END NOT FOUND: first', '[lyrics] SEARCH #2 BEGIN: second'])


def test_discover_lyrics_prefers_sidecar_then_embedded(monkeypatch, tmp_path):
    source = tmp_path / "song.mp3"
    patch_attrs(monkeypatch, lyrics, _local_file=lambda path, duration: lyrics.LyricsDiscovery(f'{path.name}:{duration}', 'sidecar'), _embedded=Mock())
    assert lyrics.discover_lyrics(source, duration_sec=3).source == "sidecar"
    lyrics._embedded.assert_not_called()
    patch_attrs(monkeypatch, lyrics, _local_file=lambda *_: lyrics.LyricsDiscovery(), _embedded=lambda _: 'one two three', _metadata_search_plan=Mock())
    assert lyrics.discover_lyrics(source).source == "metadata"
    lyrics._metadata_search_plan.assert_not_called()


def test_mychords_direct_search_finds_song_without_external_search(monkeypatch):
    search_page, result_page, lyrics_page = '\n    <html><body>\n      <form action="/ru/search" method="get">\n        <input type="text" name="query" placeholder="Найти песню или исполнителя">\n        <input type="hidden" name="lang" value="ru">\n      </form>\n    </body></html>\n    ', '\n    <html><body>\n      <a href="/ru/nervi/22635-nervy-moya-ledi.html">Нервы - Моя леди</a>\n      <a href="/ru/other/1-other.html">Другая песня</a>\n    </body></html>\n    ', '\n    <html><body><div itemprop="lyrics">\n      Первая строка песни<br>Вторая строка песни<br>Третья строка песни<br>\n      Четвертая строка песни<br>Пятая строка песни<br>Шестая строка песни<br>\n      Седьмая строка песни<br>Восьмая строка песни<br>Девятая строка песни<br>\n      Десятая строка песни<br>Одиннадцатая строка песни<br>Двенадцатая строка песни\n    </div></body></html>\n    '

    def fake_urlopen(request, timeout=8.0):
        url = request.full_url
        if url == "https://mychords.net/ru/search": return Response(search_page, "utf-8")
        if url.startswith("https://mychords.net/ru/search?"):
            assert "query=" in url and "%D0%9D%D0%B5%D1%80%D0%B2%D1%8B" in url
            return Response(result_page, "utf-8")
        if url == "https://mychords.net/ru/nervi/22635-nervy-moya-ledi.html": return Response(lyrics_page, "utf-8")
        raise AssertionError(url)

    patch_many(monkeypatch, (lyrics.urllib.request, "urlopen", fake_urlopen), (lyrics, "_web_search", lambda _title: pytest.fail("DDG fallback used")))
    result = lyrics._web_online("Нервы Моя Леди")
    assert (result.source == 'web:mychords.net') and ('Первая строка' in result.text)


def test_web_structured_candidate_keeps_artist_filter(monkeypatch):
    patch_attrs(monkeypatch, lyrics, _mychords_search=lambda _query: [('https://mychords.net/ru/stas/1.html', 'Stas Piekha - Моя прекрасная леди'), ('https://mychords.net/ru/nervi/2.html', 'Нервы - Моя Леди')], _fetch_web_lyrics=lambda url: 'слово ' * 40 if 'nervi' in url else 'wrong ' * 40)
    candidate = lyrics.LyricsSearchCandidate("Моя Леди", "Нервы", "Моя Леди")
    result = lyrics._web_online(candidate)
    assert (result.source == 'web:mychords.net') and (result.text.startswith('слово'))


def test_web_online_falls_through_when_mychords_candidate_cannot_be_fetched(monkeypatch):
    patch_attrs(
        monkeypatch,
        lyrics,
        _mychords_catalog_search=lambda _artist, _track: [('https://mychords.net/ru/nervi/1.html', 'Нервы - Моя Леди')],
        _mychords_search=lambda _query: [],
        _web_search=lambda _query: [('https://genius.com/nervy-moya-ledi', 'Нервы - Моя Леди Lyrics')],
        _fetch_web_lyrics=lambda url: '' if 'mychords.net' in url else 'слово ' * 40,
    )
    candidate = lyrics.LyricsSearchCandidate('Нервы Моя Леди', 'Нервы', 'Моя Леди')
    result = lyrics._web_online(candidate)
    assert result.source == 'web:genius.com'


def test_lyricshare_parser(monkeypatch):
    body = '<div id="lyricSheet"><p class="verse">' + '<span class="line">строка песни</span>' * 35 + '</p></div>'
    patch_attrs(monkeypatch, lyrics.urllib.request, urlopen=lambda *_args, **_kwargs: Response(body, 'utf-8'))
    assert len(lyrics._fetch_web_lyrics('https://lyricshare.net/ru/nervyi/my-lady.html').split()) == 70


def test_mychords_artist_catalog_finds_exact_song_on_paginated_artist_page(monkeypatch):
    letter_page, artist_page, page2, page3, song_page, seen = '\n    <html><body>\n      <a href="/ru/nervi/">Нервы</a>\n      <a href="/ru/neizvesten/">неизвестен</a>\n    </body></html>\n    ', '\n    <html><body>\n      <a href="/ru/nervi/111-nervy-8-marta.html">Нервы - 8 марта</a>\n      <a href="/ru/nervi/page/2/">2</a>\n      <a href="/ru/nervi/page/3/">3</a>\n      <a href="/ru/nervi/page/7/">7</a>\n    </body></html>\n    ', '\n    <html><body>\n      <a href="/ru/nervi/222-nervy-drugaya.html">Нервы - Другая</a>\n    </body></html>\n    ', '\n    <html><body>\n      <a href="/ru/nervi/22635-nervy-moya-ledi.html">Нервы - Моя леди (2 варианта)</a>\n    </body></html>\n    ', '<html><body><div itemprop="lyrics">' + 'слово<br>' * 40 + '</div></body></html>', []

    def fake_urlopen(request, timeout=8.0):
        url = request.full_url
        seen.append(url)
        if url == 'https://mychords.net/ru/letter/%D0%9D/': return Response(letter_page, 'utf-8')
        if url == 'https://mychords.net/ru/nervi/': return Response(artist_page, 'utf-8')
        if url == 'https://mychords.net/ru/nervi/page/2/': return Response(page2, 'utf-8')
        if url == 'https://mychords.net/ru/nervi/page/3/': return Response(page3, 'utf-8')
        if url == 'https://mychords.net/ru/nervi/22635-nervy-moya-ledi.html': return Response(song_page, 'utf-8')
        raise AssertionError(url)

    monkeypatch.setattr(lyrics.urllib.request, 'urlopen', fake_urlopen)
    patch_attrs(monkeypatch, lyrics, _mychords_search=lambda _query: pytest.fail('generic MyChords search used'), _web_search=lambda _query: pytest.fail('external search used'))
    candidate = lyrics.LyricsSearchCandidate('Нервы Моя Леди', 'Нервы', 'Моя Леди')
    result = lyrics._web_online(candidate)
    assert (result.source == 'web:mychords.net') and (len(result.text.split()) == 40) and ('https://mychords.net/ru/nervi/page/3/' in seen) and (all('/page/4/' not in url for url in seen))


def test_mychords_catalog_does_not_accept_other_artist_or_similar_title(monkeypatch):
    letter_page, artist_page, page2 = '<a href="/ru/nervi/">Нервы</a>', '\n      <a href="/ru/nervi/1.html">Нервы - Моя прекрасная леди</a>\n      <a href="/ru/nervi/page/2/">2</a>\n    ', '<a href="/ru/nervi/2.html">Нервы - Моя Леди</a>'

    def fake_urlopen(request, timeout=8.0):
        url = request.full_url
        if '/letter/' in url: return Response(letter_page, 'utf-8')
        if url.endswith('/ru/nervi/'): return Response(artist_page, 'utf-8')
        if url.endswith('/ru/nervi/page/2/'): return Response(page2, 'utf-8')
        raise AssertionError(url)

    monkeypatch.setattr(lyrics.urllib.request, 'urlopen', fake_urlopen)
    results = lyrics._mychords_catalog_search('Нервы', 'Моя Леди')
    assert results == [('https://mychords.net/ru/nervi/2.html', 'Нервы - Моя Леди')]
