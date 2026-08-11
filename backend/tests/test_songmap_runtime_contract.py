from __future__ import annotations

from AI.karaoke_timeline import build_karaoke_song_map
from AI.models import Syllable, VocalNote, Word
from app.services import ai_bridge
from app.utils.json_files import write_json


def test_song_map_is_self_contained_runtime_contract(tmp_path):
    words = [
        Word(start=1.0, end=1.8, text="мама", confidence=0.9, index=0),
        Word(start=2.0, end=2.4, text="я", confidence=0.9, index=1),
    ]
    syllables = [
        Syllable(start=1.0, end=1.35, text="ма", word_index=0, index=0),
        Syllable(start=1.35, end=1.8, text="ма", word_index=0, index=1),
        Syllable(start=2.0, end=2.4, text="я", word_index=1, index=2),
    ]
    notes = [
        VocalNote(start=0.98, end=1.30, midi_note=60, word_index=0, syllable_index=0),
        VocalNote(start=1.30, end=1.55, midi_note=60, word_index=0, syllable_index=1),
        VocalNote(start=1.55, end=1.82, midi_note=62, word_index=0, syllable_index=1),
        VocalNote(start=2.02, end=2.38, midi_note=64, word_index=1, syllable_index=2),
    ]
    song_map = build_karaoke_song_map(
        lyrics_text="мама\nя",
        words=words,
        syllables=syllables,
        game_notes=notes,
        duration=3.0,
        bpm=120,
        key="C",
        ai_build_id="test",
        note_decoder_version="test",
    )
    write_json(tmp_path / "songMap.json", song_map)

    timeline = ai_bridge.get_karaoke_timeline(tmp_path)
    from app.utils.json_files import read_json
    assert timeline == read_json(tmp_path / "songMap.json")
    assert len(timeline["lines"]) == 2
    assert timeline["lines"][0]["words"][0]["syllables"][0]["timing_source"] == "display_notes"
    assert ai_bridge.get_karaoke_lyrics(tmp_path) == timeline["lines"]
    assert len(ai_bridge.get_game_notes(tmp_path)) == len(song_map["notes"])
    assert len(ai_bridge.get_syllables(tmp_path)) == len(song_map["syllables"])


def test_display_notes_remove_visual_micro_fragment_without_touching_game_notes():
    words = [Word(start=1.0, end=2.0, text="мама", index=0)]
    syllables = [Syllable(start=1.0, end=2.0, text="ма", word_index=0, index=0)]
    notes = [
        VocalNote(start=1.0, end=1.40, midi_note=60, word_index=0, syllable_index=0),
        VocalNote(start=1.40, end=1.41, midi_note=67, word_index=0, syllable_index=0),
        VocalNote(start=1.41, end=2.0, midi_note=60, word_index=0, syllable_index=0),
    ]
    song_map = build_karaoke_song_map(
        lyrics_text="мама",
        words=words,
        syllables=syllables,
        game_notes=notes,
        duration=2.5,
        bpm=100,
        key="C",
        ai_build_id="test",
        note_decoder_version="test",
    )
    assert len(song_map["notes"]) == 3
    assert len(song_map["display_notes"]) < 3
    assert song_map["display_notes"][0]["start"] == 1.0
    assert song_map["display_notes"][-1]["end"] == 2.0


def test_reference_notes_prefer_public_acoustic_artifact_over_cache(tmp_path):
    write_json(tmp_path / "acousticNotes.json", {"notes": [{"start": 1, "end": 2, "midi_note": 50}]})
    cache = tmp_path / ".ai-cache"
    cache.mkdir()
    write_json(cache / "vocal-notes.json", {"notes": [{"start": 1, "end": 2, "midi_note": 70}]})
    assert ai_bridge.get_reference_notes(tmp_path)[0]["midi"] == 50
