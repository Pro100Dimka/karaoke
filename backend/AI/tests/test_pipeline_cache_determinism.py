from pathlib import Path

import run_all


def test_raw_reference_cache_is_not_final_reference(tmp_path, monkeypatch):
    paths = run_all.PipelinePaths.create(tmp_path)
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"audio")
    raw = [{"start": 0.0, "end": 1.0, "duration": 1.0, "note": "C4"}]
    calls = []

    def extract(*args, **kwargs):
        calls.append(1)
        return raw

    monkeypatch.setattr(run_all, "extract_game_reference", extract)
    first = run_all._build_reference(vocals, [], paths, None)
    paths.file("reference.json").write_text("[]", encoding="utf-8")
    second = run_all._build_reference(vocals, [], paths, None)

    assert first == second == raw
    assert len(calls) == 1
    assert paths.file("referenceRaw.json").exists()


def test_lyrics_sync_rebuilds_after_manual_text_edit(tmp_path, monkeypatch):
    paths = run_all.PipelinePaths.create(tmp_path)
    vocals = tmp_path / "vocals.wav"
    lyrics = tmp_path / "lyrics.txt"
    vocals.write_bytes(b"voice")
    lyrics.write_text("первая строка", encoding="utf-8")
    calls = []

    def sync(*args, **kwargs):
        calls.append(lyrics.read_text(encoding="utf-8"))
        return [{"text": calls[-1], "start": 0.0, "end": 1.0}]

    monkeypatch.setattr(run_all, "sync_existing_lyrics_with_whisper", sync)
    run_all._ensure_lyrics_sync(vocals, lyrics, paths, "medium", "ru")
    run_all._ensure_lyrics_sync(vocals, lyrics, paths, "medium", "ru")
    lyrics.write_text("исправленная строка", encoding="utf-8")
    result = run_all._ensure_lyrics_sync(vocals, lyrics, paths, "medium", "ru")

    assert calls == ["первая строка", "исправленная строка"]
    assert result[0]["text"] == "исправленная строка"
