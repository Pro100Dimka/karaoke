from AI.diagnostics import build_alignment_debug
from AI.models import PitchFrame, StageReport, Syllable, VocalNote, Word


def test_alignment_debug_reports_sources_reasons_lines_and_health():
    data = build_alignment_debug(
        lyrics_text="one two\nthree",
        words=[
            Word(1.0, 1.3, "one", 0.9, 0),
            Word(1.4, 1.8, "two", 0.8, 1),
            Word(2.0, 2.01, "three", 0.01, 2),
        ],
        syllables=[Syllable(1.0, 1.3, "one", 0, 0, 0.8)],
        pitch=[PitchFrame(1.0 + i * 0.01, 220.0, 0.9, True, 0.5) for i in range(100)],
        notes=[VocalNote(1.0, 1.5, 57, 96, 0, 0, ())],
        duration_sec=4.0,
        alignment_diagnostics={
            "word_sources": ["consensus", "ctc", "interpolated"],
            "word_candidates": [
                {
                    "index": 0,
                    "text": "one",
                    "ctc": {"start": 1.0, "end": 1.3, "confidence": 0.9},
                    "qwen": {"start": 1.02, "end": 1.31, "confidence": 0.85},
                },
                {"index": 1, "text": "two"},
                {"index": 2, "text": "three"},
            ],
            "ctc_words": 2,
        },
        reports=[StageReport("alignment", 2.0, False, "test")],
    )
    assert data["summary"]["source_counts"]["consensus"] == 1
    assert data["summary"]["source_counts"]["ctc"] == 1
    assert len(data["lines"]) == 2
    assert data["words"][0]["agreement"]["ctc_qwen_delta_ms"] is not None
    assert "very_low_confidence" in data["words"][2]["reasons"]
    assert "micro_duration" in data["words"][2]["reasons"]
    assert 0 <= data["health"]["text_alignment"] <= 100
    assert data["suspicious_regions"]


def test_alignment_debug_handles_empty_evidence():
    data = build_alignment_debug(
        lyrics_text="hello",
        words=[Word(0.2, 0.5, "hello", 0.5, 0)],
        syllables=[],
        pitch=[],
        notes=[],
        duration_sec=1.0,
        alignment_diagnostics={},
        reports=[],
    )
    assert data["words"][0]["final"]["source"] == "unknown"
    assert data["performance"]["total_stage_time_sec"] == 0
