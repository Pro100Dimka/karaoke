from __future__ import annotations

import json
import sys

import numpy as np
import pytest

from AI import alignment_debug as debug
from AI.models import Word


def test_debug_flag_and_word_helpers(monkeypatch):
    monkeypatch.delenv(debug.DEBUG_ENV, raising=False)
    assert not debug.alignment_debug_enabled()
    monkeypatch.setenv(debug.DEBUG_ENV, " YES ")
    assert debug.alignment_debug_enabled()
    word = Word(1, 2, "hello", confidence=0.87654)
    assert debug._word_dict(word) == {
        "text": "hello",
        "start": 1,
        "end": 2,
        "duration": 1,
        "confidence": 0.8765,
    }
    assert debug._line_min_duration([]) == debug._line_max_duration([]) == 0
    assert debug._line_min_duration(["hello"]) >= 0.45
    assert debug._line_max_duration(["hello"]) >= 3


def test_rms_activity_all_shapes():
    audio = np.concatenate((np.zeros(100), np.ones(100))).astype(np.float32)
    assert debug._rms_activity(audio, 100, 3, 4) == {"rms": 0, "peak": 0, "active_ratio": 0}
    assert debug._rms_activity(audio, 100, 0, 0.1)["active_ratio"] == 0
    assert debug._rms_activity(audio, 100, 1, 1.05)["active_ratio"] == 1
    framed = debug._rms_activity(audio, 100, 0, 2)
    assert framed["rms"] > 0 and 0 <= framed["active_ratio"] <= 1


@pytest.mark.parametrize(
    ("words", "expected"),
    [
        ([], "missing"),
        ([Word(0, 1, "a", confidence=0.1)], "fallback"),
        ([Word(0, 1, "a", confidence=0.15)], "very_low_confidence"),
        ([Word(0, 1, "a", confidence=0.8)], "forced_aligner"),
    ],
)
def test_confidence_mode(words, expected):
    assert debug._confidence_mode(words) == expected


def test_build_alignment_debug_detects_structural_failures(monkeypatch):
    monkeypatch.setattr(debug, "load_mono", lambda *_: (np.ones(2000), 100))
    monkeypatch.setattr(
        debug,
        "_rms_activity",
        lambda _audio, _rate, start, end: {
            "rms": 1 if end - start > 0.5 else 0.5,
            "peak": 1,
            "active_ratio": 0.5,
        },
    )
    words = [
        Word(0, 0.5, "Hello", confidence=0.8),
        Word(0.5, 1, "world", confidence=0.8, index=1),
        Word(2, 2.05, "Fallback", confidence=0.1, index=2),
        Word(4, 4.05, "here", confidence=0.1, index=3),
        Word(6, 10, "Low", confidence=0.15, index=4),
        Word(12, 14, "confidence", confidence=0.15, index=5),
    ]
    report = debug.build_alignment_debug(
        "vocals", "Hello world\nFallback here\nLow confidence\n!!!\nmissing words now", words
    )
    assert report["token_count_matches"] is False
    assert report["first_token_mismatch"]["reason"] == "token_count_mismatch"
    assert report["first_suspect"]
    modes = [line["mode"] for line in report["lines"]]
    assert modes == [
        "forced_aligner",
        "fallback",
        "very_low_confidence",
        "no_tokens",
        "missing_words",
    ]
    reasons = {reason for line in report["lines"] for reason in line["reasons"]}
    assert any("FIRST forced-aligner" in reason for reason in reasons)
    assert any("implausibly long" in reason for reason in reasons)
    assert any("Huge gap" in reason for reason in reasons)
    assert any("substantial vocal energy" in reason for reason in reasons)
    assert report["top_suspects"]


def test_token_mismatch_and_yo_normalization(monkeypatch):
    monkeypatch.setattr(debug, "load_mono", lambda *_: (np.ones(10), 10))
    same = debug.build_alignment_debug("v", "ёлка", [Word(0, 1, "елка")])
    assert same["first_token_mismatch"] is None
    mismatch = debug.build_alignment_debug("v", "expected", [Word(0, 1, "actual")])
    assert mismatch["first_token_mismatch"] == {
        "index": 0,
        "expected": "expected",
        "actual": "actual",
    }


def test_missing_words_is_first_suspect_and_compressed_line(monkeypatch):
    monkeypatch.setattr(debug, "load_mono", lambda *_: (np.ones(100), 100))
    missing = debug.build_alignment_debug("v", "one two", [])
    assert missing["first_suspect"]["mode"] == "missing_words"
    compressed = debug.build_alignment_debug(
        "v",
        "one two",
        [Word(0, 0.02, "one", index=0), Word(0.02, 0.04, "two", index=1)],
    )
    assert any("compressed" in reason for reason in compressed["lines"][0]["reasons"])


def test_write_alignment_debug_with_and_without_suspect(monkeypatch, tmp_path, capsys):
    suspect = {
        "first_suspect": {"line_index": 0, "start": 1, "end": 2, "text": "x", "reasons": ["bad"]}
    }
    monkeypatch.setattr(debug, "build_alignment_debug", lambda *_: suspect)
    path = tmp_path / "nested" / "debug.json"
    assert debug.write_alignment_debug(path, "v", "x", []) is suspect
    assert json.loads(path.read_text()) == suspect
    assert "FIRST SUSPECT" in capsys.readouterr().out
    monkeypatch.setattr(debug, "build_alignment_debug", lambda *_: {"first_suspect": None})
    debug.write_alignment_debug(path, "v", "x", [])
    assert "No obvious" in capsys.readouterr().out


def test_cli_reports_missing_and_builds_report(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(sys, "argv", ["debug", str(tmp_path)])
    assert debug._main() == 2
    assert "Missing required files" in capsys.readouterr().out
    (tmp_path / "separated").mkdir()
    (tmp_path / "separated" / "vocals.wav").touch()
    (tmp_path / "lyrics.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "lyricsSync.json").write_text(
        json.dumps({"words": [{"start": 0, "end": 1, "text": "hello"}]}), encoding="utf-8"
    )
    called = []
    monkeypatch.setattr(debug, "write_alignment_debug", lambda *args: called.append(args) or {})
    assert debug._main() == 0
    assert called[0][0] == tmp_path / "alignmentDebug.json"
