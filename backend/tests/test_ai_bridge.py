from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from AI.models import PitchFrame
from app.services import ai_bridge as bridge


def dump(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def word(text: str, start: float, end: float, **extra):
    return {"text": text, "word": text, "start": start, "end": end, **extra}


def test_service_entrypoints_and_pitch_conversion(monkeypatch, tmp_path):
    service = Mock()
    service.process_song.return_value = "result"
    service.analyze_pitch.return_value = [
        PitchFrame(0.1, 440, 0.9, True, 0.2),
        PitchFrame(0.2, 0, 0.1, False, 0),
    ]
    monkeypatch.setattr(bridge, "get_ai_service", lambda: service)
    ensured = Mock()
    monkeypatch.setattr(bridge, "ensure_legacy_artifacts", ensured)
    assert bridge.get_service() is service
    assert bridge.process_song("a.wav", tmp_path, language="uk", title="T") == "result"
    ensured.assert_called_once_with(tmp_path, title="T")
    assert bridge.get_run_all_pipeline()("a.wav", tmp_path, "ignored", "en") == "result"
    frames = bridge.analyze_vocal("take.wav")
    assert frames[0]["midi"] == frames[0]["note"] == 69
    assert frames[1]["midi"] is None
    assert bridge.get_analyze_vocal() is bridge.analyze_vocal
    assert bridge.get_reconcile_lyric_words() is bridge.reconcile_lyric_words


@pytest.mark.parametrize("value,default,expected", [("2", -1, 2), (None, 7, 7), ("x", 3, 3)])
def test_int_or_default(value, default, expected):
    assert bridge._int_or_default(value, default) == expected


def test_normalize_and_reconcile_words():
    assert bridge._normalize_line_words({"text": " ", "start": -2, "end": -1}) == {
        "text": "",
        "start": 0,
        "end": 0,
        "words": [],
    }
    corrected = bridge._normalize_line_words(
        {
            "text": "New words",
            "start": 1,
            "end": 3,
            "words": [
                {"word": "Old", "start": 0, "end": 2},
                {"text": "labels", "start": 2, "end": 9},
                None,
            ],
        }
    )
    assert [item["word"] for item in corrected["words"]] == ["New", "words"]
    assert corrected["words"][0]["start"] == 1
    assert corrected["words"][1]["end"] == 3
    rebuilt = bridge._normalize_line_words(
        {"text": "one longer three", "start": 0, "end": 9, "words": []}
    )
    assert [item["word"] for item in rebuilt["words"]] == ["one", "longer", "three"]
    assert rebuilt["words"][-1]["end"] == 9
    assert bridge._normalize_line_words({"text": "", "words": [{"word": " "}]})["words"] == []
    lines = bridge.reconcile_lyric_words(
        [{"text": "late", "start": 2, "end": 3}, "bad", {"text": "early", "start": 1, "end": 2}]
    )
    assert [line["text"] for line in lines] == ["early", "late"]


def test_source_boundaries_and_word_grouping():
    words = [word(token, i, i + 0.4) for i, token in enumerate(["one", "two", "three", "four"])]
    assert bridge._source_line_boundaries("single line", words) == []
    assert bridge._source_line_boundaries("one two\nthree four", words) == [2]
    lines = bridge._group_words_into_lines(words, "one two\nthree four")
    assert [line["text"] for line in lines] == ["one two", "three four"]
    assert bridge._group_words_into_lines([]) == []
    fallback = bridge._group_words_into_lines(
        [
            word("Hello", 0, 0.2),
            None,
            word("world!", 0.3, 0.6),
            word("later", 2, 2.2),
            word("1", 2.3, 2.4),
            word("2", 2.5, 2.6),
            word("3", 2.7, 2.8),
            word("4", 2.9, 3),
            word("5", 3.1, 3.2),
            word("6", 3.3, 3.4),
            word("7", 3.5, 3.6),
            word("8", 3.7, 3.8),
            word("long", 10, 10.1),
        ]
    )
    assert fallback[0]["text"] == "Hello world!"
    assert len(fallback) >= 3
    long_text = (
        "\n"
        + "one two three four five six. seven eight nine ten eleven twelve"
        + "\na b c d e, f g h i j, k l m n o"
    )
    assert (
        len(
            bridge._source_line_boundaries(
                long_text, [{"word": token} for token in bridge.tokenize(long_text)]
            )
        )
        >= 2
    )
    assert bridge._group_words_into_lines([None, {"text": " "}]) == []


@pytest.mark.parametrize(
    "opcodes,expected",
    [
        ([("x", 0, 0, 0, 0), ("x", 0, 1, 0, 2)], 2),
        ([("x", 1, 1, 0, 2)], 2),
        ([("x", 0, 0, 0, 0)], 2),
    ],
)
def test_source_boundary_opcode_edges(monkeypatch, opcodes, expected):
    matcher = Mock()
    matcher.get_opcodes.return_value = opcodes
    monkeypatch.setattr(bridge, "SequenceMatcher", lambda *_, **__: matcher)
    assert bridge._source_line_boundaries("a\nb", [{"word": "a"}, {"word": "b"}]) == [expected]


def test_snap_lines_to_regions_and_vocals(monkeypatch, tmp_path):
    lines = [
        {"text": "a", "start": 1, "end": 3, "words": [{"word": "a", "start": 1.5, "end": 2.5}]}
    ]
    assert bridge._snap_lines_to_regions([], [(0, 1)]) == []
    assert bridge._snap_lines_to_regions(lines, []) is lines
    snapped = bridge._snap_lines_to_regions(lines, [(5, 9)])
    assert snapped[0]["start"] == 5 and snapped[0]["end"] == 9
    assert snapped[0]["words"][0]["start"] == 6
    assert bridge._snap_lines_to_regions(lines, [(1, 1)]) == lines
    assert bridge._snap_lines_to_vocals(lines, tmp_path) is lines
    vocal = tmp_path / "separated" / "vocals.wav"
    vocal.parent.mkdir()
    vocal.touch()
    monkeypatch.setattr(bridge, "load_mono", lambda *_: ([0] * 100, 10))
    monkeypatch.setattr(bridge, "_vocal_activity_regions", lambda *_: [(2, 4)])
    assert bridge._snap_lines_to_vocals(lines, tmp_path)[0]["start"] == 2
    monkeypatch.setattr(bridge, "load_mono", Mock(side_effect=OSError))
    assert bridge._snap_lines_to_vocals(lines, tmp_path) is lines


def test_timing_helpers_and_repair(monkeypatch, tmp_path):
    assert bridge._line_timing_is_impossible({"start": 0, "end": 2, "words": []})
    assert not bridge._line_timing_is_impossible({"start": 0, "end": 1, "words": [{"word": "x"}]})
    regions = [(1, 2), (4, 6)]
    assert bridge._active_offset_to_time(regions, 3, -1) == 1
    assert bridge._active_offset_to_time(regions, 3, 1.5) == 4.5
    assert bridge._active_offset_to_time(regions, 3, 9) == 6
    assert bridge._active_offset_to_time([(0, 1)], 3, 2) == 1
    lines = [
        {"text": "a b", "start": 0, "end": 0.1, "words": [word("a", 0, 0.05), word("b", 0.05, 0.1)]}
    ]
    assert bridge._repair_impossible_alignment_chunks(lines, tmp_path) is lines
    vocal = tmp_path / "separated" / "vocals.flac"
    vocal.parent.mkdir()
    vocal.touch()
    monkeypatch.setattr(bridge, "load_mono", lambda *_: ([0] * 100, 10))
    monkeypatch.setattr(bridge, "_vocal_activity_regions", lambda *_: [])
    repaired = bridge._repair_impossible_alignment_chunks(lines, tmp_path)
    assert repaired[0]["end"] > repaired[0]["start"]
    monkeypatch.setattr(bridge, "load_mono", Mock(side_effect=ValueError))
    assert bridge._repair_impossible_alignment_chunks(lines, tmp_path) is lines


def test_repair_mixed_chunk_and_sparse_activity(monkeypatch, tmp_path):
    vocal = tmp_path / "separated" / "vocals.wav"
    vocal.parent.mkdir()
    vocal.touch()
    lines = [
        {"start": 0, "end": 1, "words": [word("valid", 0, 1)]},
        {"start": 1, "end": 1.03, "words": [word("a", 1, 1.03)]},
        {"start": 1.03, "end": 1.06, "words": [word("b", 1.03, 1.06)]},
        {"start": 1.1, "end": 3, "words": [word("next", 1.1, 3)]},
    ]
    monkeypatch.setattr(bridge, "load_mono", lambda *_: ([0] * 400, 100))
    monkeypatch.setattr(bridge, "_vocal_activity_regions", lambda *_: [(0, 0.01)])
    repaired = bridge._repair_impossible_alignment_chunks(lines, tmp_path)
    assert repaired[0] is lines[0]
    assert repaired[1]["words"][0]["end"] > repaired[1]["words"][0]["start"]
    separated = [
        {"start": 0, "end": 0.01, "words": [word("bad", 0, 0.01)]},
        {"start": 2, "end": 3, "words": [word("valid", 2, 3)]},
    ]
    assert bridge._repair_impossible_alignment_chunks(separated, tmp_path)[1] is separated[1]


def test_bound_durations_and_artifact_readers(tmp_path):
    bounded = bridge._bound_legacy_word_durations(
        [
            {"start": 0, "end": 10, "words": [{"word": "x", "start": 0, "end": 10}]},
            {"start": 2, "end": 3, "words": []},
        ]
    )
    assert bounded[0]["words"][0]["end"] == pytest.approx(0.7)
    assert bounded[1]["start"] == 2
    dump(
        tmp_path / "songMap.json",
        {
            "lines": [{"text": "ok"}, 1],
            "notes": [{"midi_note": 60}, 1],
            "syllables": [{"text": "la"}, 1],
        },
    )
    assert bridge.get_karaoke_lyrics(tmp_path) == [{"text": "ok"}]
    assert bridge.get_game_notes(tmp_path)[0]["pitch"] == 60
    assert bridge.get_syllables(tmp_path) == [{"text": "la"}]
    dump(tmp_path / "songMap.json", [])
    dump(
        tmp_path / "lyricsSync.json",
        {"text": "hi all", "words": [word("hi", 0, 1), word("all", 1, 2)]},
    )
    dump(tmp_path / "reference.json", {"notes": [{"midi": 62}]})
    dump(tmp_path / "syllables.json", {"syllables": [{"text": "hi"}]})
    assert bridge.get_karaoke_lyrics(tmp_path)[0]["text"] == "hi all"
    assert bridge.get_game_notes(tmp_path)[0]["midi"] == 62
    assert bridge.get_syllables(tmp_path) == [{"text": "hi"}]
    dump(tmp_path / "lyricsSync.json", [])
    assert bridge.get_karaoke_lyrics(tmp_path) == []
    dump(tmp_path / "lyricsSync.json", {"words": "bad"})
    assert bridge.get_karaoke_lyrics(tmp_path) == []
    dump(tmp_path / "reference.json", {"notes": "bad"})
    assert bridge.get_game_notes(tmp_path) == []


def test_timeline_prefers_song_map_and_builds_legacy(monkeypatch, tmp_path):
    ready = {"lines": [], "display_notes": [], "overlap": True}
    dump(tmp_path / "songMap.json", ready)
    normalize = Mock()
    monkeypatch.setattr("app.services.song_editor_service.normalize_editor_timeline", normalize)
    assert bridge.get_karaoke_timeline(tmp_path) == ready
    normalize.assert_called_once()
    monkeypatch.setattr(
        bridge,
        "get_karaoke_lyrics",
        lambda _: [
            {
                "text": "la x",
                "start": 0,
                "end": 3,
                "words": [
                    {"word": "la", "index": 0, "start": 0, "end": 1},
                    {"word": "x", "index": 1, "start": 2, "end": 3},
                ],
            }
        ],
    )
    monkeypatch.setattr(
        bridge,
        "get_syllables",
        lambda _: [
            {"index": 5, "word_index": 0, "start": 0.2, "end": 0.8},
            {"index": 6, "word_index": 0, "start": 0.8, "end": 1},
            {"index": 9, "word_index": -1},
        ],
    )
    monkeypatch.setattr(
        bridge,
        "get_game_notes",
        lambda _: [
            {"syllable_index": 5, "syllable_indices": [5, 6], "start": 0.3, "end": 0.7},
            {"syllable_index": -1, "start": 9, "end": 10},
        ],
    )
    dump(tmp_path / "songMap.json", {"duration": "bad"})
    timeline = bridge._build_legacy_karaoke_timeline(tmp_path)
    first, second = timeline["lines"][0]["words"]
    assert (first["start"], first["end"]) == (0, 1)
    assert (first["syllables"][0]["start"], first["syllables"][0]["end"]) == (0.2, 0.8)
    assert first["syllables"][0]["timing_source"] == "syllable_alignment"
    assert first["syllables"][0]["notes"]
    assert first["syllables"][1]["notes"]
    assert first["syllables"][1]["timing_source"] == "syllable_alignment"
    assert second["timing_source"] == "word_alignment"
    assert timeline["duration"] == 10
    dump(tmp_path / "songMap.json", {})
    monkeypatch.setattr(bridge, "_build_legacy_karaoke_timeline", lambda _: {"legacy": True})
    assert bridge.get_karaoke_timeline(tmp_path) == {"legacy": True}


def test_legacy_timeline_empty_line_and_explicit_duration(monkeypatch, tmp_path):
    monkeypatch.setattr(
        bridge, "get_karaoke_lyrics", lambda _: [{"start": 2, "end": 3, "words": []}]
    )
    monkeypatch.setattr(bridge, "get_syllables", lambda _: [])
    monkeypatch.setattr(bridge, "get_game_notes", lambda _: [])
    dump(tmp_path / "songMap.json", {"duration": 7})
    timeline = bridge._build_legacy_karaoke_timeline(tmp_path)
    assert timeline["lines"][0]["start"] == 2
    assert timeline["duration"] == 7


def test_reference_note_priority(tmp_path):
    dump(tmp_path / "reference.json", {"notes": [{"midi": 1}, "bad"]})
    assert bridge.get_reference_notes(tmp_path)[0]["pitch"] == 1
    cache = tmp_path / ".ai-cache"
    cache.mkdir()
    dump(cache / "vocal-notes.json", [{"midi_note": 2}])
    assert bridge.get_reference_notes(tmp_path)[0]["pitch"] == 2
    dump(tmp_path / "acousticNotes.json", {"notes": [{"midi": 3}]})
    assert bridge.get_reference_notes(tmp_path)[0]["pitch"] == 3


@pytest.mark.parametrize(
    "duration,notes,level",
    [(0, [], "easy"), (10, [{"midi": 60}], "easy"), (1, [{"midi": 40}, {"midi": 70}], "hard")],
)
def test_ensure_legacy_artifacts(tmp_path, duration, notes, level):
    dump(tmp_path / "lyricsSync.json", {"text": "hello", "words": [word("hello", 0, 1)]})
    dump(tmp_path / "songMap.json", {"duration": duration})
    dump(tmp_path / "acousticNotes.json", {"notes": notes})
    bridge.ensure_legacy_artifacts(tmp_path, title="Title")
    assert json.loads((tmp_path / "songInfo.json").read_text(encoding="utf-8"))["title"] == "Title"
    assert json.loads((tmp_path / "difficulty.json").read_text(encoding="utf-8"))["level"] == level
    structure = json.loads((tmp_path / "structure.json").read_text(encoding="utf-8"))
    assert bool(structure) is bool(duration)
    assert json.loads((tmp_path / "breaths.json").read_text()) == []


def test_ensure_artifacts_recovers_from_invalid_song_map(tmp_path):
    dump(tmp_path / "lyricsSync.json", [])
    dump(tmp_path / "songMap.json", [])
    bridge.ensure_legacy_artifacts(tmp_path)
    assert json.loads((tmp_path / "songInfo.json").read_text()) == {}
