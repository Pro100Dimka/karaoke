from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import karaoke_timeline as timeline
from AI import midi
from AI.errors import InvalidArtifactError
from AI.models import Syllable, VocalNote, Word


def test_midi_helpers_clamp_and_sort_events():
    tempo = 500_000
    assert midi._ticks(-1, tempo) == 0
    track = []
    midi._append_bend_range(track, 99)
    assert track[2].value == 24
    messages = [SimpleNamespace(time=0, name="late"), SimpleNamespace(time=0, name="early")]
    midi._append_absolute_events(track := [], [(10, 1, messages[0]), (2, 0, messages[1])])
    assert [item.name for item in track] == ["early", "late"]
    assert [item.time for item in track] == [2, 8]


def test_write_and_validate_midi(tmp_path):
    target = tmp_path / "nested" / "voice.mid"
    words = [Word(0, 1, "hello", index=0)]
    syllables = [Syllable(0, 1, "hel", 0, 0)]
    notes = [
        VocalNote(
            0,
            1,
            60,
            velocity=100,
            cents=((0, 0), (0.1, 0), (0.2, 400), (0.2, 300), (1, -400)),
        )
    ]
    assert midi.write_midi(target, notes, words, syllables, bpm=500, bend_range=0) == target
    midi.validate_midi(target)
    assert target.stat().st_size > 0
    plain = tmp_path / "plain.mid"
    midi.write_midi(plain, notes, [], [], pitch_bend=False)
    midi.validate_midi(plain)
    with pytest.raises(InvalidArtifactError, match="without notes"):
        midi.write_midi(tmp_path / "none", [], [], [])


def test_validate_midi_wraps_bad_files(monkeypatch, tmp_path):
    bad = tmp_path / "bad.mid"
    bad.write_bytes(b"bad")
    with pytest.raises(InvalidArtifactError, match="Invalid MIDI"):
        midi.validate_midi(bad)
    empty = SimpleNamespace(tracks=[[]])
    monkeypatch.setattr(midi.mido, "MidiFile", lambda *_, **__: empty)
    with pytest.raises(InvalidArtifactError, match="lacks required"):
        midi.validate_midi(bad)
    negative = SimpleNamespace(tracks=[[SimpleNamespace(time=-1, type="x")], []])
    monkeypatch.setattr(midi.mido, "MidiFile", lambda *_, **__: negative)
    with pytest.raises(InvalidArtifactError, match="negative delta"):
        midi.validate_midi(bad)


def test_write_midi_cleans_temporary_on_save_failure(monkeypatch, tmp_path):
    broken = Mock()
    broken.tracks = []
    broken.save.side_effect = OSError("disk")
    monkeypatch.setattr(midi.mido, "MidiFile", Mock(return_value=broken))
    with pytest.raises(OSError, match="disk"):
        midi.write_midi(tmp_path / "voice.mid", [VocalNote(0, 1, 60)], [], [])
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ({"midi_note": "60.4"}, 60),
        ({"midi": 127}, 127),
        ({"midi": 128}, None),
        ({"midi": "x"}, None),
    ],
)
def test_timeline_note_normalizers(value, expected):
    assert timeline._midi(value) == expected


def test_positive_duration_handles_invalid_values():
    assert timeline._positive_duration({"start": 2, "end": 1}) == 0
    assert timeline._positive_duration({"start": "bad", "end": 1}) == 0


def test_display_notes_filter_invalid_events_without_merging_musical_notes():
    notes = [
        {"start": 0, "end": 0.1, "midi": 60, "syllable_index": 0},
        {"start": 0.1, "end": 0.2, "midi": 60, "syllable_index": 0},
        {"start": 0.2, "end": 1.2, "midi": 62, "syllable_index": 0},
        {"start": 1.2, "end": 1.3, "midi": 63, "syllable_index": 0},
        {"start": 2, "end": 3, "midi": 65, "syllable_index": "bad"},
        {"start": 3, "end": 3, "midi": 66},
        {"start": 3, "end": 4, "midi": "bad"},
    ]
    merged = timeline._merge_display_notes(notes)
    assert len(merged) == 5
    assert [(item["start"], item["end"], item["midi_note"]) for item in merged[:2]] == [
        (0, 0.1, 60),
        (0.1, 0.2, 60),
    ]
    assert all(item["display_source"] == "acoustic_game_note" for item in merged)
    assert timeline._merge_display_notes([]) == []
    leading_fragment = timeline._merge_display_notes(
        [
            {"start": 0, "end": 0.1, "midi": 60, "syllable_index": 1},
            {"start": 0.1, "end": 1.1, "midi": 61, "syllable_index": 1},
            {"start": 1.1, "end": 2.1, "midi": 70, "syllable_index": 1},
        ]
    )
    assert len(leading_fragment) == 3


def test_build_karaoke_song_map_links_authoritative_timing():
    words = [Word(0, 1, "hello", index=0), Word(2, 3, "world", index=1)]
    syllables = [
        Syllable(0, 0.5, "hel", 0, 0),
        Syllable(0.5, 1, "lo", 0, 1),
        Syllable(2, 3, "world", 1, 2),
    ]
    notes = [VocalNote(0.1, 0.9, 60, syllable_index=0, syllable_indices=(0, 1))]
    result = timeline.build_karaoke_song_map(
        lyrics_text="hello\nworld\nunused",
        words=words,
        syllables=syllables,
        game_notes=notes,
        duration=3,
        bpm=120,
        key="C",
        ai_build_id="build",
        note_decoder_version="decoder",
    )
    first_word = result["lines"][0]["words"][0]
    assert (first_word["start"], first_word["end"]) == (0, 1)
    assert [(item["start"], item["end"]) for item in first_word["syllables"]] == [
        (0, 0.5),
        (0.5, 1),
    ]
    assert [len(item["display_notes"]) for item in first_word["syllables"]] == [1, 1]
    assert first_word["syllables"][0]["display_notes"][0]["syllable_indices"] == (0, 1)
    assert first_word["timing_source"] == "word_alignment"
    assert first_word["syllables"][0]["timing_source"] == "syllable_alignment"
    assert result["lines"][1]["words"][0]["syllables"][0]["timing_source"] == "syllable_alignment"
    assert len(result["lines"]) == 2
    assert result["display_stats"] == {
        "game_note_count": 1,
        "display_note_count": 1,
        "syllable_count": 3,
    }


def test_build_song_map_skips_invalid_links_and_unlinked_words():
    result = timeline.build_karaoke_song_map(
        lyrics_text="a",
        words=[{"start": 0, "end": 1, "text": "a", "index": 0}],
        syllables=[{"start": 0, "end": 1, "text": "a", "word_index": "bad", "index": "bad"}],
        game_notes=[{"start": 0, "end": 1, "midi": 60, "syllable_index": "bad"}],
        duration=1,
        bpm=100,
        key=None,
        ai_build_id="b",
        note_decoder_version="n",
    )
    assert result["lines"][0]["words"][0]["timing_source"] == "word_alignment"
    invalid_syllable = timeline.build_karaoke_song_map(
        lyrics_text="a",
        words=[{"start": 0, "end": 1, "text": "a", "index": 0}],
        syllables=[{"start": 0, "end": 1, "text": "a", "word_index": 0, "index": "bad"}],
        game_notes=[],
        duration=1,
        bpm=100,
        key=None,
        ai_build_id="b",
        note_decoder_version="n",
    )
    assert (
        invalid_syllable["lines"][0]["words"][0]["syllables"][0]["timing_source"]
        == "syllable_alignment"
    )
