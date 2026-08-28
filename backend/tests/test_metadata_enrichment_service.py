import json
from pathlib import Path
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


def test_youtube_quality_rejects_live_fan_and_ai_clips():
    for title in (
        "Artist - Song (Live in Concert)",
        "Artist - Song | Фан-клип с оригинальным сюжетом",
        "Artist - Song (Нейросеть AI Generated Music Video)",
    ):
        assert metadata._candidate_score(title, "Artist", "Song", "Artist") is None


def test_official_video_scores_above_an_unverified_clip():
    official = metadata._candidate_score(
        "Artist - Song (Official Video)", "Artist", "Song", "Artist"
    )
    generic = metadata._candidate_score(
        "Artist - Song (Клип 2024)", "Artist", "Song", "Artist"
    )
    assert official is not None and generic is not None and official > generic


def test_video_normalization_rejects_a_clip_with_wrong_duration(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    destination = tmp_path / "clip.mp4"
    source.write_bytes(b"video")
    monkeypatch.setattr(metadata, "_video_info", Mock(return_value=(1920, 1080, 206.0)))
    monkeypatch.setattr(metadata, "_video_has_motion", Mock(return_value=True))

    assert metadata._normalize_video(
        source,
        destination,
        expected_duration=193.0,
    ) is False

def test_youtube_download_has_a_format_fallback_and_quiet_logger(monkeypatch, tmp_path):
    captured = {}

    class FakeYoutubeDL:
        def __init__(self, options):
            captured.update(options)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def download(self, _urls):
            return 1

    monkeypatch.setattr(metadata, "YoutubeDL", FakeYoutubeDL)

    assert metadata._download_youtube_video("DAaLa3vF8sU", tmp_path) is False
    assert captured["format"].endswith("bestvideo/best")
    assert isinstance(captured["logger"], metadata._YtDlpLogger)


def test_training_media_creates_cover_and_validated_local_clip(monkeypatch, tmp_path):
    patch_attrs(
        monkeypatch,
        metadata,
        _youtube_video_id=Mock(return_value="DAaLa3vF8sU"),
        _download_square_cover=Mock(return_value=True),
        _download_youtube_video=Mock(return_value=True),
    )

    result = metadata.prepare_training_media(
        "Song",
        "Artist",
        tmp_path,
        cover_url="https://example.test/cover.jpg",
    )

    assert result == {
        "cover_status": "ready",
        "video_status": "ready",
        "video_id": "DAaLa3vF8sU",
        "warnings": [],
    }
    metadata._download_square_cover.assert_called_once_with(
        "https://example.test/cover.jpg", tmp_path
    )
    metadata._download_youtube_video.assert_called_once_with(
        "DAaLa3vF8sU",
        tmp_path,
        expected_duration=None,
    )


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
        _download_youtube_video=Mock(return_value=True),
        commit=Mock(),
    )
    monkeypatch.setattr(metadata.song_service, "resolve_output_dir", Mock(return_value=Path("output")))
    monkeypatch.setattr(metadata.repositories, "get_song", Mock(return_value=song))
    invalidate = Mock()
    monkeypatch.setattr(metadata.revision_cache, "invalidate", invalidate)
    monkeypatch.setattr(metadata, "_active", {"song"})

    metadata.enrich_song("song")

    assert song.genre == "Rock"
    assert song.video_url == metadata.LOCAL_VIDEO_URL
    metadata.commit.assert_called_once_with(database)
    invalidate.assert_called_once_with(song)
    database.close.assert_called_once_with()
    assert "song" not in metadata._active
