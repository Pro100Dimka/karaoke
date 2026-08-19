
from tests._shared import patch_attrs, raises, midi_frame

import math
import sys
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import notes
from AI.models import PitchFrame, Syllable, VocalNote, Word


frame = midi_frame


def note(start, end, midi=60, cents=(), word=None, syllable_index=None): return VocalNote(start, end, midi, 90, word, syllable_index, cents)


def syllable(start, end, index=0, word=None): return Syllable(start, end, f's{index}', index if word is None else word, index)


def test_statistical_pitch_helpers(): assert (notes.hz_to_midi(440) == 69) and (notes._median_filter([]) == []) and (notes._median_filter([3, 1, 2], 1) == [2, 2, 1.5]); raises(ValueError, lambda: notes._weighted_median([], [])); assert (notes._weighted_median([1, 9, 3], [0, 0, 0]) == 3) and (notes._weighted_median([1, 3, 9], [1, 4, 1]) == 3); raises(ValueError, lambda: notes._robust_pitch_center([], [])); assert (notes._robust_pitch_center([60, 61], [1, 1]) == pytest.approx(60.5)) and (notes._robust_pitch_center([50, 60, 80], [1, 5, 1]) == 60)


def test_timing_profile_and_voiced_runs():
    frames = [frame(0), frame(0.01), frame(0.02), frame(1), frame(1.01)]; assert (notes._robust_frame_step([], 0) == 0.0001) and (notes._robust_frame_step(frames, 1) == pytest.approx(0.01)); profile = notes._note_timing_profile(frames, [note(0, 0.4), note(0.5, 1)], min_note_hint=0.05); assert profile.frame_step == pytest.approx(0.01) and profile.merge_gap > 0
    usable = notes._voiced_runs(
        [frame(0), frame(0.01, voiced=False), frame(0.1, confidence=0.1), frame(1)],
        max_gap=0.2,
        min_confidence=0.5,
    )
    assert (len(usable) == 2) and (notes._voiced_runs([], max_gap=1, min_confidence=0) == [])


def test_attack_and_reattack_detection(): assert notes._local_frame_attack_strength([], 0) == 0; quiet = [frame(i * 0.01, energy=0) for i in range(12)]; assert notes._local_frame_attack_strength(quiet, 6) == 0; quiet[6] = frame(0.06, energy=1); assert (notes._local_frame_attack_strength(quiet, 6) == 1) and (notes._energy_reattack_boundaries(quiet[:5], 0.03) == []); steady = [frame(i * 0.01, energy=1) for i in range(30)]; assert notes._energy_reattack_boundaries(steady, 0.03) == []; valley = [frame(i * 0.01, energy=0.1 if 12 <= i < 15 else 1) for i in range(30)]; boundaries = notes._energy_reattack_boundaries(valley, 0.03); assert (boundaries) and (len(notes._split_on_reattacks(valley, 0.03)) == 2) and (notes._energy_reattack_boundaries([frame(i * 0.01, energy=0) for i in range(20)], 0.03) == []) and (notes._energy_reattack_boundaries([frame(i * 0.01, energy=1e-09) for i in range(20)], 0.03) == []); wide = [frame(i * 0.01, energy=0.01 if 5 <= i < 13 else 1) for i in range(30)]; assert notes._energy_reattack_boundaries(wide, 0.03) == []; edge = [frame(i * 0.01, energy=0.01 if 24 <= i < 28 else 1) for i in range(30)]; assert notes._energy_reattack_boundaries(edge, 0.03) == []


def test_split_reattacks_rejects_tiny_parts(monkeypatch): segment = [frame(i * 0.01) for i in range(10)]; monkeypatch.setattr(notes, "_energy_reattack_boundaries", lambda *_: [1]); assert notes._split_on_reattacks(segment, 0.05) == [segment]


def test_sustained_segments_empty_stable_and_jump(monkeypatch): assert notes._sustained_pitch_segments([], split_semitones=1, min_note=0.05) == []; one = [frame(0)]; assert notes._sustained_pitch_segments(one, split_semitones=1, min_note=0.05) == [one]; stable = [frame(i * 0.01, 60 + math.sin(i) * 0.1) for i in range(40)]; assert len(notes._sustained_pitch_segments(stable, split_semitones=0.8, min_note=0.04)) == 1; jumped = [frame(i * 0.01, 60 if i < 20 else 64, energy=1 if i != 20 else 3) for i in range(50)]; assert len(notes._sustained_pitch_segments(jumped, split_semitones=0.8, min_note=0.04)) >= 2


@pytest.mark.parametrize(
    "observed",
    [
        [60] * 10 + [64] * 20,
        [60] * 10 + [61.2] * 20,
        [60] * 18 + [64] * 2,
        [60] * 13 + [64] * 7,
        [60] * 10 + [64, 60, 60, 60, 60, 60] + [60] * 14,
        [60] * 10 + [64, 60, 64, 60, 64, 64] + [64] * 14,
        [60] * 10 + [64] * 6 + [60] * 20,
        [60] * 10 + [61, 63, 61, 63, 61, 63] + [62] * 14,
    ],
)
def test_sustained_segment_decision_guards(monkeypatch, observed): run = [frame(i * 0.01) for i in range(len(observed))]; patch_attrs(monkeypatch, notes, _median_filter=lambda *_a, **_k: observed, _local_frame_attack_strength=lambda *_: 0); result = notes._sustained_pitch_segments(run, split_semitones=0.8, min_note=0.04); assert result


def test_bend_note_and_syllable_assignment(): segment = [frame(i * 0.01, 60 + i * 0.05) for i in range(10)]; assert notes._bend_curve([], start=0, base=60, duration=1) == (); curve = notes._bend_curve(segment, start=0, base=60, duration=0.1); assert (curve[0][0] == 0 and curve[-1][0] <= 0.1) and (notes._note_from_segment([], None, min_note=0.1) is None) and (notes._note_from_segment(segment[:2], None, min_note=1) is None); owner = syllable(0, 1); built = notes._note_from_segment(segment, owner, min_note=0.02); assert (built and built.syllable_index == 0) and (notes._best_syllable_for_segment([], [owner]) is None) and (notes._best_syllable_for_segment(segment, []) is None) and (notes._best_syllable_for_segment(segment, [owner]) is owner); far = syllable(2, 3, 1); assert notes._best_syllable_for_segment(segment, [far]) is far


def test_activity_clipping_and_soft_labels(): syllables = [syllable(0.1, 0.3), syllable(0.5, 0.7, 1)]; assert (notes._lyric_activity_intervals([]) == []) and (len(notes._lyric_activity_intervals(syllables)) == 2) and (len(notes._lyric_activity_intervals([syllable(0, 0.2), syllable(0.21, 0.4, 1)])) == 1); source = note(0, 1, cents=((0.2, 10), (0.6, 20))); assert notes._clip_note_to_lyric_activity(source, [], min_note=0.05) == [source]; pieces = notes._clip_note_to_lyric_activity(source, syllables, min_note=0.05); assert (len(pieces) == 2 and pieces[0].syllable_index == 0) and (notes._attach_soft_lyric_labels([source], []) == [source]); labeled = notes._attach_soft_lyric_labels([source], syllables); assert labeled[0].syllable_index is not None; distant = note(2, 3); assert (notes._attach_soft_lyric_labels([distant], syllables) == [distant]) and (notes._clip_note_to_lyric_activity(source, [syllable(0, 0.01)], min_note=0.1) == [])


def test_decode_filter_intervals_and_monophonic(monkeypatch):
    frames = [frame(i * 0.01) for i in range(20)]
    decoded = notes._decode_pitch_only(
        frames, min_note=0.03, split_semitones=1, max_gap=0.05, min_confidence=0.5
    )
    assert decoded; words = [Word(0, 0.2, "one"), Word(1, 1.2, "two", index=1)]; assert (notes._word_activity_intervals([]) == []) and (len(notes._word_activity_intervals(words)) == 2); touching = [Word(0, 0.2, "one"), Word(0.21, 0.4, "two", index=1)]
    assert len(notes._word_activity_intervals(touching)) == 1; timing = notes._adaptive_lyric_timing(words, [], 0.05); assert all(value > 0 for value in timing); candidates = [note(0, 0.2), note(0.5, 0.6), note(2, 2.2)]
    assert notes._filter_to_lyric_phrases(candidates, [], min_note=0.05) == candidates
    filtered = notes._filter_to_lyric_phrases(
        candidates, [syllable(0, 0.2)], min_note=0.05, words=words[:1]
    )
    assert candidates[0] in filtered and candidates[-1] not in filtered; before, future_word = note(0, 0.1), [Word(0.15, 0.3, 'future')]
    assert notes._filter_to_lyric_phrases([before], [], min_note=0.05, words=future_word) == [
        before
    ]
    overlapping = [note(0, 1, 60, ((0.2, 1),)), note(0.5, 1.5, 62, ((0.1, 2),))]; mono = notes._make_monophonic(overlapping, 0.1); assert len(mono) == 2 and mono[0].end <= mono[1].start; nonoverlap = [note(0, 0.2), note(0.3, 0.5)]
    assert notes._make_monophonic(nonoverlap, 0.1) == nonoverlap; replaced = notes._make_monophonic([note(0, 0.05), note(0.01, 0.5, 62)], 0.1); assert (len(replaced) == 1 and replaced[0].midi_note == 62) and (notes._make_monophonic([], 0.1) == [])


def test_pitch_attack_and_fragment_postprocessing():
    frames = [frame(i * 0.01, energy=1 if i != 10 else 3) for i in range(50)]; profile = notes._note_timing_profile(frames, [note(0, 0.2)], min_note_hint=0.04); assert (notes._pitch_attack_strength([], 0) == 0) and (notes._pitch_attack_strength(frames, 0) == 0) and (notes._pitch_attack_strength(frames, 0.1, profile) > 0); zero_frames = [frame(i * 0.01, energy=0) for i in range(20)]
    zero_frames[10] = frame(0.1, energy=1); assert (notes._pitch_attack_strength(zero_frames, 0.1, profile) == 1) and (notes._consolidate_micro_fragments([note(0, 1)], frames, profile) == [note(0, 1)]); aba, quiet_frames = [note(0, 0.2, 60, word=0, syllable_index=0), note(0.2, 0.22, 61, word=0, syllable_index=0), note(0.22, 0.5, 60, word=0, syllable_index=0)], [frame(i * 0.01, energy=1) for i in range(60)]; assert len(notes._consolidate_micro_fragments(aba, quiet_frames, profile)) == 1
    adjacent = [
        note(0, 0.2, 60, word=0, syllable_index=0),
        note(0.2, 0.22, 61, word=0, syllable_index=0),
    ]
    assert len(notes._consolidate_micro_fragments(adjacent, quiet_frames, profile)) == 1; separate = [note(0, 0.2, 60), note(1, 1.2, 65)]; assert notes._consolidate_micro_fragments(separate, quiet_frames, profile) == separate; three = [note(0, 0.2, 60), note(0.3, 0.5, 65), note(0.6, 0.8, 62)]
    assert notes._consolidate_micro_fragments(three, quiet_frames, profile) == three; equal = [note(0, 0.1, 60), note(0.1, 0.3, 60)]; assert (len(notes._consolidate_micro_fragments(equal, quiet_frames, profile)) == 1) and (notes._repair_short_isolated_spikes(adjacent, quiet_frames, profile) == adjacent); spike = [note(0, 0.2, 60), note(0.2, 0.21, 72), note(0.21, 0.5, 61)]
    assert notes._repair_short_isolated_spikes(spike, quiet_frames, profile)[1].midi_note == 60; long_spike = [note(0, 0.2, 60), note(0.2, 1, 72), note(1, 1.2, 60)]; assert notes._repair_short_isolated_spikes(long_spike, quiet_frames, profile) == long_spike; lonely = [note(0, 0.1, 60), note(2, 2.01, 72), note(4, 4.1, 60)]
    assert notes._repair_short_isolated_spikes(lonely, quiet_frames, profile) == lonely; same = [note(0, 0.2, 60, word=0), note(0.21, 0.4, 60, word=1)]; merged = notes._merge_same_pitch_gaps(same, quiet_frames, profile); assert (len(merged) == 1 and merged[0].word_index is None) and (notes._merge_same_pitch_gaps(separate, quiet_frames, profile) == separate) and (notes._merge_same_pitch_gaps([], [], profile) == []) and (notes._repair_note_outliers(spike) == spike)


def test_local_harmonic_repair_and_verified_merge():
    frames, base_notes = [frame(i * 0.01, energy=1) for i in range(100)], [note(0, 0.2, 60), note(0.21, 0.3, 72), note(0.31, 0.5, 61)]; profile = notes._note_timing_profile(frames, base_notes, min_note_hint=0.04); assert notes._repair_isolated_harmonic_notes(base_notes[:2], frames, profile) == base_notes[:2]; repaired = notes._repair_isolated_harmonic_notes(base_notes, frames, profile)
    assert repaired[1].midi_note in {60, 61}
    fragments = [
        note(0, 0.2, 60, word=0, syllable_index=0),
        note(0.21, 0.4, 60, word=0, syllable_index=0),
        note(0.5, 0.7, 62),
    ]
    assert (len(notes._merge_verified_fragments(fragments, frames, profile)) == 2) and (notes._merge_verified_fragments([], frames, profile) == [])


def test_harmonic_repair_rejection_guards(monkeypatch):
    frames, base = [frame(i * 0.01) for i in range(200)], [note(0, 0.2, 60), note(0.21, 0.3, 72), note(0.31, 0.5, 60)]; profile = notes._note_timing_profile(frames, base, min_note_hint=0.04)

    def unchanged(items, attack=0, selected_profile=profile): monkeypatch.setattr(notes, "_pitch_attack_strength", lambda *_: attack); assert notes._repair_isolated_harmonic_notes(items, frames, selected_profile) == items

    unchanged([note(0, 0.2, 60), note(2, 2.1, 72), note(2.2, 2.4, 60)]); unchanged(base, attack=1); unchanged([note(0, 0.2, 50), note(0.21, 0.3, 72), note(0.31, 0.5, 70)]); unchanged([note(0, 0.2, 60), note(0.21, 0.3, 65), note(0.31, 0.5, 60)])
    unchanged([note(0, 0.2, 60), note(0.21, 0.3, 100), note(0.31, 0.5, 60)]); long = [note(0, 0.2, 60), note(0.21, 2, 72), note(2.01, 2.2, 60)]; unchanged(long, selected_profile=replace(profile, phrase_gap=3))


def test_game_notes_preserve_syllable_granularity():
    vocal = [note(0, 1, 60), note(2, 2, 61)]; assert (len(notes.build_game_notes(vocal)) == 1) and (notes.build_game_notes(vocal, min_note=2) == []); aligned = [syllable(0, 0.5, word=0), syllable(0.5, 1, 1, word=0)]; result = notes.build_game_notes(vocal[:1], aligned)
    assert (len(result) == 1) and (result[0].syllable_indices == (0, 1)); collapsed = [syllable(0, 0.8, word=0), syllable(0, 1, 1, word=0)]; result = notes.build_game_notes(vocal[:1], collapsed); assert (len(result) == 1 and result[0].end == 1) and (result[0].syllable_indices == (0, 1))
    duplicates = [syllable(0, 0.5), syllable(0, 0.5)]; assert len(notes.build_game_notes(vocal[:1], duplicates)) == 1

    rounding_edge, aligned_edge = note(114.46, 114.97000000000001, 63), [syllable(114.325024, 114.478816, 199, word=10), syllable(114.478816, 114.683872, 200, word=10), syllable(114.683872, 114.87, 201, word=10), syllable(114.87, 114.97, 202, word=10), syllable(114.97, 115.14, 203)]; result = notes.build_game_notes([rounding_edge], aligned_edge); assert (len(result) == 1) and (result[0].syllable_indices == (199, 200, 201, 202)) and (all((item.end > item.start for item in result)))

    boundary_note, boundary_syllables = note(7.12, 7.52, 55), [syllable(7.048732824, 7.12, 2, word=1), syllable(7.12, 7.16, 3, word=1)]; result = notes.build_game_notes([boundary_note], boundary_syllables); assert result[0].syllable_indices == (3,)

    future = notes.build_game_notes([note(6.22, 6.48, 52)], [syllable(6.48, 6.86, 23)]); assert future[0].syllable_indices == ()

    cross_word = notes.build_game_notes(
        [note(6.92, 7.18, 59)],
        [syllable(6.864, 7.12, 24), syllable(7.14, 7.52, 25)],
    )
    assert cross_word[0].syllable_indices == (24, 25)


def test_game_notes_preserve_real_repeated_notes_and_melisma(): repeated = [note(0, 0.4, 64), note(0.5, 0.9, 64)]; assert len(notes.build_game_notes(repeated, [syllable(0, 1)])) == 2; melisma = [note(0, 0.4, 60), note(0.4, 0.8, 62), note(0.8, 1.0, 64)]; result = notes.build_game_notes(melisma, [syllable(0, 1)]); assert (len(result) == 3) and (all((item.syllable_indices == (0,) for item in result))) and (all((item.end > item.start for item in result)))


def test_many_to_many_lyric_association_never_consumes_by_note_count():
    aligned, melody = [syllable(0, 1, 0, word=0), syllable(1, 2, 1, word=1), syllable(2, 2.5, 2, word=2), syllable(2.5, 3, 3, word=3)], [note(0, 0.3, 60), note(0.3, 0.6, 62), note(0.6, 1, 64), note(1, 2, 65), note(2, 3, 67)]; result = notes.build_game_notes(melody, aligned); assert ([(item.start, item.end, item.midi_note) for item in result], [item.syllable_indices for item in result]) == ([(item.start, item.end, item.midi_note) for item in melody], [(0,), (0,), (0,), (1,), (2, 3)])

    with_extra_melisma = notes.build_game_notes(
        [note(0, 0.15, 59), note(0.15, 0.3, 61), *melody], aligned
    )
    assert [item.syllable_indices for item in with_extra_melisma if item.start >= 1] == [
        (1,),
        (2, 3),
    ]


def test_harmonic_salience_bounds_and_signal(): magnitude = pytest.importorskip("numpy").ones((1025, 3)); assert (notes._audio_harmonic_salience(magnitude, -1, 60, sample_rate=16000, n_fft=2048) == -12) and (math.isfinite(notes._audio_harmonic_salience(magnitude, 1, 60, sample_rate=16000, n_fft=2048))) and (math.isfinite(notes._audio_harmonic_salience(magnitude, 1, 120, sample_rate=16000, n_fft=2048)))


def test_audio_register_verifier_guards_and_full_decode(monkeypatch):
    source, frames = [note(0, 0.2, 60), note(0.21, 0.3, 72), note(0.31, 0.5, 60)], [frame(i * 0.01) for i in range(60)]; profile = notes._note_timing_profile(frames, source, min_note_hint=0.04); assert (notes._audio_verify_note_register([], 'x', profile, fmin_hz=50, fmax_hz=500) == []) and (notes._audio_verify_note_register(source, None, profile, fmin_hz=50, fmax_hz=500) == source)

    fake = SimpleNamespace(
        yin=lambda *_a, **_k: pytest.importorskip("numpy").full(100, 261.625565),
        stft=lambda *_a, **_k: pytest.importorskip("numpy").ones((1025, 100), dtype=complex),
        onset=SimpleNamespace(onset_strength=lambda **_: pytest.importorskip("numpy").zeros(100)),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake); patch_attrs(monkeypatch, notes, load_mono=lambda *_: (pytest.importorskip('numpy').ones(16000), 16000), _audio_harmonic_salience=lambda _m, _i, midi, **_: 10 - abs(midi - 60))
    verified = notes._audio_verify_note_register(
        source, "audio.wav", profile, fmin_hz=50, fmax_hz=500
    )
    assert verified[1].midi_note == 60; diagnostics = notes.get_note_diagnostics()["register_verification"]; assert diagnostics["checked_notes"] == 3 and diagnostics["accepted_proposals"] >= 1

    patch_attrs(monkeypatch, notes, load_mono=lambda *_: (pytest.importorskip('numpy').zeros(10), 16000))
    assert (
        notes._audio_verify_note_register(source, "x", profile, fmin_hz=50, fmax_hz=500) == source
    )
    monkeypatch.setitem(sys.modules, "librosa", SimpleNamespace(yin=Mock(side_effect=RuntimeError))); patch_attrs(monkeypatch, notes, load_mono=lambda *_: (pytest.importorskip('numpy').ones(16000), 16000))
    assert (
        notes._audio_verify_note_register(source, "x", profile, fmin_hz=50, fmax_hz=500) == source
    )


@pytest.mark.parametrize(
    ("original", "yin_midi", "peak", "accepted_bucket"),
    [
        (84, 60, 60, "harmonic_19_plus"),
        (69, 60, 60, "large_7_11"),
        (64, 60, 60, "medium_3_6"),
        (61, 60, 60, "small_1_2"),
        (72, 72, 60, None),
    ],
)
def test_audio_register_decision_bands(monkeypatch, original, yin_midi, peak, accepted_bucket):
    np, source, frames = pytest.importorskip('numpy'), [note(0, 0.2, 60), note(0.21, 0.3, original), note(0.31, 0.5, 60)], [frame(i * 0.01) for i in range(60)]; profile, yin_hz, onset = notes._note_timing_profile(frames, source, min_note_hint=0.04), 440 * 2 ** ((yin_midi - 69) / 12), np.ones(100) if original == 64 else np.zeros(100)
    if original == 64: onset[21] = 2
    fake = SimpleNamespace(
        yin=lambda *_a, **_k: np.full(100, yin_hz),
        stft=lambda *_a, **_k: np.ones((1025, 100), dtype=complex),
        onset=SimpleNamespace(onset_strength=lambda **_: onset),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake); patch_attrs(monkeypatch, notes, load_mono=lambda *_: (np.ones(16000), 16000), _audio_harmonic_salience=lambda _m, _i, midi, **_: 20 - abs(midi - peak) * 2); result, diagnostic = notes._audio_verify_note_register(source, 'audio.wav', profile, fmin_hz=50, fmax_hz=500), notes.get_note_diagnostics()['register_verification']
    if accepted_bucket:
        assert result[1].midi_note == peak; assert diagnostic["accepted_buckets"][accepted_bucket] >= 1
    else:
        assert result[1].midi_note == original; assert diagnostic["rejected_proposals"] >= 1


def test_audio_register_extreme_candidate_and_phrase_resets(monkeypatch):
    np = pytest.importorskip("numpy"); onset = np.ones(200); onset[21] = 3
    fake = SimpleNamespace(
        yin=lambda *_a, **_k: np.full(200, 440 * 2 ** ((127 - 69) / 12)),
        stft=lambda *_a, **_k: np.ones((1025, 200), dtype=complex),
        onset=SimpleNamespace(onset_strength=lambda **_: onset),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake); patch_attrs(monkeypatch, notes, load_mono=lambda *_: (np.ones(32000), 16000), _audio_harmonic_salience=lambda *_a, **_k: 1); frames, extreme = [frame(i * 0.01) for i in range(200)], [note(0, 0.2, 0), note(0.21, 0.3, 127), note(0.31, 0.5, 0)]; profile = notes._note_timing_profile(frames, extreme, min_note_hint=0.04)
    result = notes._audio_verify_note_register(
        extreme, "audio.wav", profile, fmin_hz=50, fmax_hz=500
    )
    assert result[1].midi_note == 127; spaced = [note(0, 0.1, 60), note(1, 1.1, 60)]; profile = notes._note_timing_profile(frames, spaced, min_note_hint=0.04)
    assert (
        len(
            notes._audio_verify_note_register(spaced, "audio.wav", profile, fmin_hz=50, fmax_hz=500)
        )
        == 2
    )
    gapped, profile = [note(0, 0.1, 60), note(0.2, 0.3, 60)], replace(profile, phrase_gap=1, merge_gap=0.01, gap_scale=0.01); onset[20] = 0.5
    assert (
        len(
            notes._audio_verify_note_register(gapped, "audio.wav", profile, fmin_hz=50, fmax_hz=500)
        )
        == 2
    )


def test_build_vocal_notes_orchestrates_all_stages(monkeypatch):
    frames, syllables, base = [frame(0), frame(0.01)], [syllable(0, 0.2)], [note(0, 0.2)]; patch_attrs(monkeypatch, notes, _decode_pitch_only=Mock(return_value=base), _filter_to_lyric_phrases=Mock(side_effect=lambda value, *_a, **_k: value), _attach_soft_lyric_labels=Mock(side_effect=lambda value, *_: value), _make_monophonic=Mock(side_effect=lambda value, *_: value), _audio_verify_note_register=Mock(side_effect=lambda value, *_a, **_k: value))
    for name in (
        "_repair_isolated_harmonic_notes",
        "_merge_verified_fragments",
        "_consolidate_micro_fragments",
        "_repair_short_isolated_spikes",
        "_merge_same_pitch_gaps",
    ):
        monkeypatch.setattr(notes, name, Mock(side_effect=lambda value, *_: value))
    monkeypatch.setattr(notes, "_repair_note_outliers", Mock(side_effect=lambda value: value)); result = notes.build_vocal_notes(frames[::-1], syllables, words=[]); assert result == base and notes.get_note_diagnostics()["timing_profile"]["frame_step"] > 0; notes.build_vocal_notes(frames, [])
    notes._attach_soft_lyric_labels.assert_called_once()
