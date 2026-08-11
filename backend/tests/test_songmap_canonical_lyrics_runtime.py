from pathlib import Path


def test_songmap_uses_published_canonical_lyrics_not_branch_local_text():
    source = (Path(__file__).parents[1] / "AI" / "pipeline.py").read_text(encoding="utf-8")
    assert 'canonical_lyrics_text = (' in source
    assert 'lyrics_text=canonical_lyrics_text' in source
    assert 'lyrics_text=text,\n                    words=words' not in source
