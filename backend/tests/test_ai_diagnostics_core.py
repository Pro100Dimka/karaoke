from types import SimpleNamespace

import pytest

from AI import diagnostics
from AI.models import PitchFrame, StageReport, Syllable, VocalNote, Word
from AI.utils.numeric import clamp01
from tests._shared import alignment_candidate


def pitch(time, hz=220, confidence=0.8, voiced=True): return PitchFrame(time, hz if voiced else 0, confidence, voiced, 0.1)


def test_diagnostic_primitives():
    assert (clamp01(2) == 1 and clamp01(-1) == 0) and (diagnostics._median([1, float('nan'), 3]) == 2) and (diagnostics._median([], 4) == 4) and (diagnostics._pitch_regions([]) == ([], []))
    regions, onsets = diagnostics._pitch_regions([pitch(0), pitch(0.01), pitch(0.02), pitch(1)])
    assert (len(regions) == 2 and onsets == [0, 1]) and (diagnostics._overlap_ratio(0, 1, [(-1, 0), (0.2, 0.5), (2, 3)]) == pytest.approx(0.3)) and (diagnostics._nearest_ms(1, []) is None) and (diagnostics._nearest_ms(1, [0.9, 2]) == pytest.approx(100))


def test_timeline_metrics_and_candidates():
    items = [
        {"start": 0, "end": 0.01},
        SimpleNamespace(start=0.005, end=0.2),
        {"start": 0.5, "end": 0.5},
    ]
    result = diagnostics._timeline_metrics(items)
    assert (result['overlap_count'] == 1 and result['gap_count'] == 1) and (result['micro_interval_count'] == 2 and result['non_positive_interval_count'] == 1) and (diagnostics._candidate_for({}, 'ctc') is None) and (diagnostics._candidate_for({'ctc': []}, 'ctc') is None) and (diagnostics._candidate_for({'ctc': {'start': 0, 'end': 1}}, 'ctc') == {'start': 0, 'end': 1, 'confidence': 0}) and (diagnostics._candidate_for({'ctc': {'start': 'bad'}}, 'ctc') is None)



def test_build_alignment_debug_comprehensive():
    words, candidates, frames, raw, syllables, notes = [Word(0, 0.01, 'zero', confidence=0.01, index=0), Word(0.2, 3.2, 'one', confidence=0.1, index=1), Word(3, 3.5, 'two', confidence=0.8, index=2), Word(4, 4.5, 'three', confidence=0.8, index=3), Word(5, 5.5, 'four', confidence=0.8, index=4), Word(5.4, 5.8, 'five', confidence=0.01, index=5)], [alignment_candidate(0, 0.01, 0.7, 'consensus'), {**alignment_candidate(0.2, 1, 0.7, 'ctc'), **alignment_candidate(0.21, 1.01, 0.7, 'qwen')}, {**alignment_candidate(3, 3.2, 0.7, 'ctc'), **alignment_candidate(4, 4.2, 0.7, 'qwen')}, alignment_candidate(4, 4.5, 0.7, 'ctc'), alignment_candidate(5, 5.5, 0.7, 'qwen'), 'bad'], [pitch(0), pitch(0.01), pitch(0.3), pitch(1), pitch(3.1), pitch(4.2), pitch(5.5)], [pitch(0, 440), pitch(0.01, voiced=False), pitch(0.3, 220), pitch(99)], [Syllable(0, 0.01, 'z', 0, 0, 0.5), Syllable(0.2, 0.2, 'o', 1, 1, 0.6), Syllable(3, 3.5, 't', 2, 2, 0.7)], [VocalNote(0, 0.02, 60, word_index=0, syllable_index=0), VocalNote(0.01, 0.03, 72)]
    game = [
        *notes,
        VocalNote(0.03, 0.04, 61, syllable_index=0),
        VocalNote(0.04, 0.5, 62, syllable_index=2),
    ]
    result = diagnostics.build_alignment_debug(
        lyrics_text="zero one\ntwo three\nfour five\nunused",
        words=words,
        syllables=syllables,
        pitch=frames,
        notes=notes,
        duration_sec=6,
        raw_pitch=raw,
        game_notes=game,
        alignment_diagnostics={"word_candidates": candidates, "model": "x"},
        reports=[StageReport("slow", 3, False, "a"), StageReport("fast", -1, True, "b")],
        note_diagnostics={"notes": True},
        music_diagnostics={"tempo": True},
        pitch_source_diagnostics={
            "original": {
                "voiced_ratio": 0.8,
                "micro_run_rate": 0.5,
                "jump_rate": 0.5,
                "octave_flip_rate": 0.5,
            },
            "tail_suppressed": {
                "voiced_ratio": 0.4,
                "micro_run_rate": 0.1,
                "jump_rate": 0.2,
                "octave_flip_rate": 0.2,
            },
        },
        vocal_effect_diagnostics={
            "cleanup": {
                "denoise_mean_rms_attenuation_ratio": 0.2,
                "tail_gate_mean_rms_attenuation_ratio": 0.4,
            },
            "possible_causes_percent": {"delay": 80},
        },
    )
    assert ((result['summary']['words'], result['summary']['source_counts']) == (6, {'consensus': 2, 'ctc_or_qwen': 1, 'ctc': 1, 'qwen': 1, 'interpolated': 1})) and (result['suspicious_regions']) and (result['pitch']['postprocess_changes']['large_pitch_changes'] >= 1) and (result['pitch_source_analysis']['effect_residual_indicators']) and (result['notes']['syllable_split_events'] == 2) and (result['notes']['game_duration_quantiles']['p50'] > 0) and (result['root_cause_analysis']['primary_cause'] in result['root_cause_analysis']['scores_percent']) and (result['performance']['audio_realtime_factor'] == 0.5)


def test_build_alignment_debug_empty_and_fallback_line():
    empty = diagnostics.build_alignment_debug(
        lyrics_text="",
        words=[],
        syllables=[],
        pitch=[],
        notes=[],
        duration_sec=0,
        alignment_diagnostics=None,
        reports=[],
    )
    assert (empty['summary']['words'] == 0) and (empty['performance']['audio_realtime_factor'] is None) and (empty['notes']['game_duration_quantiles'] == {'p05': 0, 'p25': 0, 'p50': 0, 'p75': 0, 'p95': 0})
    one = diagnostics.build_alignment_debug(
        lyrics_text="",
        words=[Word(0, 1, "hello")],
        syllables=[],
        pitch=[],
        notes=[],
        duration_sec=1,
        alignment_diagnostics={"word_sources": ["manual"]},
        reports=[],
    )
    assert one["lines"][0]["text"] == "hello"


def test_build_debug_classifies_long_weak_and_separated_suspicious_regions():
    words, active = [Word(0, 0.1, 'a', confidence=0), Word(5, 5.1, 'b', confidence=0, index=1), Word(6, 7, 'c', confidence=0.8, index=2), Word(8, 12, 'd', confidence=0.1, index=3)], [pitch(6 + index * 0.01) for index in range(20)]
    result = diagnostics.build_alignment_debug(
        lyrics_text="a b c d",
        words=words,
        syllables=[],
        pitch=active,
        notes=[VocalNote(6, 7, 60)],
        duration_sec=12,
        alignment_diagnostics={"word_sources": ["manual"] * 4},
        reports=[],
    )
    reasons = [set(row["reasons"]) for row in result["words"]]
    assert ('weak_vocal_overlap' in reasons[2]) and ('very_long_duration' in reasons[3]) and (len(result['suspicious_regions']) >= 2) and (result['notes']['game_duration_quantiles'] == {'p05': 1, 'p25': 1, 'p50': 1, 'p75': 1, 'p95': 1})


def test_region_summary():
    items = [
        {"text": str(i), "final": {"start": i, "end": i + 1, "confidence": 0.5}, "reasons": ["x"]}
        for i in range(30)
    ]
    result = diagnostics._region(items)
    assert result["words"] == 30 and len(result["text"].split()) == 24
