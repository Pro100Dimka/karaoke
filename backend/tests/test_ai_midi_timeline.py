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


def test_extend_micro_duration_spans_borrows_only_from_existing_gaps():
    # CTC marks the frame a word becomes recognizable, not how long it's
    # sung; short/quiet words ("a", "я") can end up a few tens of
    # milliseconds wide -- imperceptible, and read as the highlight
    # stalling on the previous word until the next one arrives.
    items = [
        {"start": 0.0, "end": 0.02, "text": "А"},  # 20ms: stretched to the floor
        {"start": 0.03, "end": 0.05, "text": "я"},  # 20ms but only 5ms of room before "left"
        {"start": 0.06, "end": 0.5, "text": "left"},  # already long enough: untouched
    ]
    timeline._extend_micro_duration_spans(items, total_duration=10.0)
    assert items[0]["end"] == pytest.approx(0.03)  # capped at the next item's start
    assert items[1]["end"] == pytest.approx(0.06)  # same cap, not the full 100ms floor
    assert items[2]["end"] == 0.5

    last_only = [{"start": 9.95, "end": 9.96, "text": "last"}]
    timeline._extend_micro_duration_spans(last_only, total_duration=10.0)
    assert last_only[0]["end"] == pytest.approx(10.0)  # capped at the song's own end

    malformed = [{"start": "bad", "end": 1}]
    timeline._extend_micro_duration_spans(malformed, total_duration=10.0)  # must not raise
    assert malformed[0]["end"] == 1


def test_build_karaoke_song_map_stretches_micro_duration_words_and_syllables():
    words = [
        Word(0.0, 0.02, "А", index=0),
        Word(0.2, 1.0, "world", index=1),
    ]
    syllables = [
        Syllable(0.0, 0.02, "А", 0, 0),
        Syllable(0.2, 0.6, "wor", 1, 1),
        Syllable(0.6, 1.0, "ld", 1, 2),
    ]
    result = timeline.build_karaoke_song_map(
        lyrics_text="А\nworld",
        words=words,
        syllables=syllables,
        game_notes=[],
        duration=5,
        bpm=120,
        key="C",
        ai_build_id="build",
        note_decoder_version="decoder",
    )
    first_word = result["lines"][0]["words"][0]
    # Stretched to the 0.1s floor: the gap before the next word (0.2s) is
    # wide enough to hold it without touching anything else.
    assert first_word["end"] == pytest.approx(0.1)
    assert first_word["syllables"][0]["end"] == pytest.approx(0.1)
    # A word already long enough is left completely untouched.
    assert result["lines"][1]["words"][0]["end"] == 1.0


def test_build_karaoke_song_map_rebalances_a_compressed_line_against_its_neighbor():
    # "Я не хочу курить после любви" (6 words) was squeezed into well under a
    # second while the very next line "Я хочу наслаждаться тобой" (4 words,
    # touching it with zero gap) kept several normal-paced seconds -- the
    # highlight jumped to line two before the singer had finished line one.
    words = [
        Word(3.89, 3.99, "Я", index=0),
        Word(3.99, 4.09, "не", index=1),
        Word(4.09, 4.25, "хочу", index=2),
        Word(4.25, 4.47, "курить", index=3),
        Word(4.47, 4.61, "после", index=4),
        Word(4.61, 4.83, "любви", index=5),
        Word(4.83, 5.5, "Я", index=6),
        Word(5.5, 6.2, "хочу", index=7),
        Word(6.2, 7.0, "наслаждаться", index=8),
        Word(7.0, 7.75, "тобой", index=9),
    ]
    result = timeline.build_karaoke_song_map(
        lyrics_text="Я не хочу курить после любви\nЯ хочу наслаждаться тобой",
        words=words,
        syllables=[],
        game_notes=[],
        duration=10,
        bpm=120,
        key="C",
        ai_build_id="build",
        note_decoder_version="decoder",
    )
    first_line, second_line = result["lines"]
    assert first_line["start"] == pytest.approx(3.89)
    assert second_line["end"] == pytest.approx(7.75)
    # The shared boundary moved well past the original 4.83s squeeze point,
    # giving line one a fairer share of the two lines' combined envelope.
    assert first_line["end"] == pytest.approx(second_line["start"])
    assert first_line["end"] > 5.5
    assert first_line["words"][-1]["end"] == pytest.approx(first_line["end"])
    assert second_line["words"][0]["start"] == pytest.approx(second_line["start"])
    # Each line's own words stay monotonic and inside its new envelope.
    for line in (first_line, second_line):
        ordered = line["words"]
        assert ordered[0]["start"] == pytest.approx(line["start"])
        assert all(
            left["end"] <= right["start"] + 1e-9
            for left, right in zip(ordered, ordered[1:], strict=False)
        )


def test_rebalance_leaves_a_real_gap_and_a_reasonable_split_untouched():
    lines = [
        {
            "start": 0.0,
            "end": 1.0,
            "words": [{"start": 0.0, "end": 1.0, "text": "left", "syllables": []}]
        },
        {
            "start": 2.0,  # a genuine musical pause before the next line
            "end": 3.0,
            "words": [{"start": 2.0, "end": 3.0, "text": "right", "syllables": []}]
        }
    ]
    timeline._rebalance_compressed_line_boundaries(lines)
    assert lines[0]["end"] == 1.0 and lines[1]["start"] == 2.0

    touching_but_fair = [
        {
            "start": 0.0,
            "end": 1.0,
            "words": [{"start": 0.0, "end": 1.0, "text": "left", "syllables": []}]
        },
        {
            "start": 1.0,
            "end": 2.0,
            "words": [{"start": 1.0, "end": 2.0, "text": "right", "syllables": []}]
        }
    ]
    timeline._rebalance_compressed_line_boundaries(touching_but_fair)
    assert touching_but_fair[0]["end"] == 1.0


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
