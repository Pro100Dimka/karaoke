import json
from types import SimpleNamespace
from unittest.mock import Mock

from app.services import metadata_enrichment_service as metadata
from tests._shared import patch_attrs


def test_itunes_lookup_returns_the_first_catalog_genre(monkeypatch):
    payload = {"results": [{"primaryGenreName": "Rock"}, {"primaryGenreName": "Pop"}]}
    request = Mock(return_value=json.dumps(payload).encode())
    monkeypatch.setattr(metadata, "_request", request)

    assert metadata._itunes_genre("Song", "Artist") == "Rock"
    assert "entity=song" in request.call_args.args[0]


def test_youtube_lookup_uses_keyless_embeddable_result(monkeypatch):
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    monkeypatch.setattr(metadata, "_request", Mock(return_value=b'ignored {"videoId":"DAaLa3vF8sU"} ignored'))
    monkeypatch.setattr(metadata, "_youtube_oembed", Mock(return_value={
        "title": "Artist - 8th Color (Official Music Video)",
        "author_name": "Artist",
    }))
    monkeypatch.setattr(metadata, "_youtube_has_motion", Mock(return_value=True))

    assert metadata._youtube_video_id("8th Color", "Artist") == "DAaLa3vF8sU"


def test_youtube_quality_rejects_static_and_low_quality_candidates(monkeypatch):
    monkeypatch.setattr(metadata, "_youtube_oembed", Mock(return_value={
        "title": "Artist - Song (Official Music Video)",
        "author_name": "Artist",
    }))
    monkeypatch.setattr(metadata, "_youtube_has_motion", Mock(return_value=False))
    assert metadata._youtube_video_is_acceptable("DAaLa3vF8sU", "Song", "Artist") is False

    monkeypatch.setattr(metadata, "_youtube_has_motion", Mock(return_value=True))
    metadata._youtube_oembed.return_value["title"] = "Artist - Song (Official Audio)"
    assert metadata._youtube_video_is_acceptable("DAaLa3vF8sU", "Song", "Artist") is False


def test_enrichment_persists_missing_metadata(monkeypatch):
    song = SimpleNamespace(
        id="song",
        title="Title",
        artist="Artist",
        genre=None,
        video_url=None,
    )
    database = Mock()
    patch_attrs(
        monkeypatch,
        metadata,
        SessionLocal=Mock(return_value=database),
        _itunes_genre=Mock(return_value="Rock"),
        _youtube_video_id=Mock(return_value="DAaLa3vF8sU"),
        commit=Mock(),
    )
    monkeypatch.setattr(metadata.repositories, "get_song", Mock(return_value=song))
    invalidate = Mock()
    monkeypatch.setattr(metadata.revision_cache, "invalidate", invalidate)
    monkeypatch.setattr(metadata, "_active", {"song"})

    metadata.enrich_song("song")

    assert song.genre == "Rock"
    assert song.video_url == "https://www.youtube.com/watch?v=DAaLa3vF8sU"
    metadata.commit.assert_called_once_with(database)
    invalidate.assert_called_once_with(song)
    database.close.assert_called_once_with()
    assert "song" not in metadata._active
