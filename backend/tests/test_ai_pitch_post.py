
import builtins
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from AI import pitch_post as post
from tests._shared import missing_import, patch_attrs, pitch_frame


def frame(time, hz=220, confidence=1, voiced=True, energy=0.1):
    return pitch_frame(time, hz, confidence, voiced, energy)


def test_normalized_periodicity_edges_and_signal():
    assert (post._normalized_periodicity(np.ones(5), 1) == 0) and (post._normalized_periodicity(np.ones(20), 3) == 0)
    signal = np.sin(np.arange(1000) * 2 * np.pi / 20).astype(np.float32)
    assert post._normalized_periodicity(signal, 20) > 0.99


def test_refine_confidence_fallbacks(monkeypatch):
    frames = [frame(0)]
    assert post.refine_pitch_confidence([], "x") == []
    monkeypatch.setattr(post, "load_mono", lambda *_: (_ for _ in ()).throw(OSError("bad")))
    assert post.refine_pitch_confidence(frames, "x") == frames
    monkeypatch.setattr(post, "load_mono", lambda *_: (np.ones(10), 100))
    assert post.refine_pitch_confidence(frames, "x") == frames


def test_refine_confidence_fake_unity_and_genuine(monkeypatch):
    frames = [frame(0), frame(0.01, voiced=False), frame(0.02)]
    monkeypatch.setattr(post, "load_mono", lambda *_: (np.ones(1000), 1000))
    values = iter([0.8, 0.95, 0.1, 0.1])
    monkeypatch.setattr(post, "_normalized_periodicity", lambda *_: next(values))
    refined = post.refine_pitch_confidence(frames, "x", sample_rate=1000)
    assert (refined[0].confidence < 0.8) and (refined[1] is frames[1]) and (not refined[2].voiced)

    genuine = [frame(0, confidence=0.64)]
    monkeypatch.setattr(post, "_normalized_periodicity", lambda *_: 0.25)
    refined = post.refine_pitch_confidence(genuine, "x", sample_rate=1000)
    assert refined[0].confidence == pytest.approx(0.4)


def test_fuse_pitch_fallbacks(monkeypatch):
    frames = [frame(0)]
    assert post.fuse_pitch_with_yin([], "x") == []
    monkeypatch.setattr(builtins, "__import__", missing_import(builtins.__import__, "librosa"))
    assert post.fuse_pitch_with_yin(frames, "x") == frames


def test_fuse_pitch_short_and_yin_failure(monkeypatch):
    fake = SimpleNamespace(yin=lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")))
    monkeypatch.setitem(sys.modules, "librosa", fake)
    frames = [frame(0), frame(0.01)]
    monkeypatch.setattr(post, "load_mono", lambda *_: (np.ones(10), 100))
    assert post.fuse_pitch_with_yin(frames, "x") == frames
    monkeypatch.setattr(post, "load_mono", lambda *_: (np.ones(4096), 1000))
    assert post.fuse_pitch_with_yin(frames, "x") == frames


def test_fuse_pitch_builds_phrase_local_path(monkeypatch):
    yin = np.asarray([220, 220, np.nan, 50, 440], dtype=float)
    fake = SimpleNamespace(yin=lambda *_args, **_kwargs: yin)
    monkeypatch.setitem(sys.modules, "librosa", fake)
    frames = [
        frame(0, 220, energy=0.1),
        frame(0.01, 440, energy=0.4),
        frame(0.2, voiced=False),
        frame(0.3, 2000),
        frame(0.4, 440),
    ]
    monkeypatch.setattr(post, "load_mono", lambda *_: (np.ones(4096), 1000))

    def periodicity(_window, lag): return 0.5 if lag >= 4 else 0.2

    monkeypatch.setattr(post, "_normalized_periodicity", periodicity)
    result = post.fuse_pitch_with_yin(frames, "x", sample_rate=1000, fmin_hz=55, fmax_hz=1400)
    assert (len(result) == len(frames)) and (result[0].voiced and (not result[2].voiced)) and (result[1].frequency in {220, 440})


def _run_synthetic_fusion(monkeypatch, frames, yin, periodicity):
    fake = SimpleNamespace(yin=lambda *_args, **_kwargs: np.asarray(yin, dtype=float))
    monkeypatch.setitem(sys.modules, "librosa", fake)
    patch_attrs(monkeypatch, post, load_mono=lambda *_: (np.ones(20000), 8000), _normalized_periodicity=lambda _window, lag: periodicity(lag))
    return post.fuse_pitch_with_yin(
        frames,
        "x",
        sample_rate=8_000,
        fmin_hz=55,
        fmax_hz=1_400,
    )


def test_fusion_keeps_stable_fcpe_e4_over_yin_e2(monkeypatch):
    frames = [frame(i * 0.01, 329.63, confidence=0.7) for i in range(30)]
    result = _run_synthetic_fusion(
        monkeypatch,
        frames,
        [82.41] * len(frames),
        lambda lag: 0.68 if lag >= 90 else 0.62 if lag <= 30 else 0.1,
    )
    assert all(item.frequency == pytest.approx(329.63) for item in result)


def test_brief_yin_subharmonics_do_not_capture_stable_fcpe_run(monkeypatch):
    frames = [frame(i * 0.01, 155.56, confidence=0.65) for i in range(30)]
    yin = [155.56] * len(frames)
    yin[10:15] = [77.78] * 5
    result = _run_synthetic_fusion(
        monkeypatch,
        frames,
        yin,
        lambda lag: 0.69 if lag >= 95 else 0.64 if 45 <= lag <= 55 else 0.1,
    )
    assert all(item.frequency == pytest.approx(155.56) for item in result)


def test_strong_yin_can_correct_unstable_low_confidence_fcpe(monkeypatch):
    frames = [frame(i * 0.01, 220 if i % 2 else 330, confidence=0.1) for i in range(30)]
    result = _run_synthetic_fusion(
        monkeypatch,
        frames,
        [110] * len(frames),
        lambda lag: 0.9 if lag >= 70 else 0.25,
    )
    assert sum(item.frequency == pytest.approx(110) for item in result) >= 25


def test_pitch_math_and_frame_step():
    assert (post._hz(post._midi(440)) == pytest.approx(440)) and (post._frame_step([]) == 0.01) and (post._frame_step([frame(0), frame(0.001), frame(0.1)]) == 0.005) and (post._frame_step([frame(0), frame(0.006)]) == 0.006) and (post._frame_step([frame(0), frame(0.07)]) == 0.04)


def test_attack_transition_and_shift_costs():
    run = [frame(0, energy=0), frame(0.01, energy=0), frame(0.02, energy=1)]
    assert (post._attack_strength(run, 0) == 0) and (post._attack_strength(run, 1) == 0) and (post._attack_strength(run, 2) == 1)
    run = [frame(0, energy=1), frame(0.01, energy=3)]
    assert (post._attack_strength(run, 1) == 1) and (post._transition_cost(0, 100, 1) < post._transition_cost(0, 100, 0)) and (post._shift_cost(0, 1) == 0) and (post._shift_cost(12, 0) < post._shift_cost(19, 0) < post._shift_cost(24, 0))


def test_stabilize_voiced_runs_and_harmonics():
    assert post._stabilize_voiced_run([frame(0), frame(0.01)]) == [frame(0), frame(0.01)]
    extreme = [frame(i * 0.01, 1) for i in range(3)]
    assert len(post._stabilize_voiced_run(extreme)) == 3
    octave = [frame(0, 220), frame(0.01, 440), frame(0.02, 220)]
    stabilized = post._stabilize_voiced_run(octave)
    assert len(stabilized) == 3
    mixed = [frame(0, voiced=False), *octave, frame(1, voiced=False), frame(2, 220)]
    assert len(post._stabilize_harmonics(mixed)) == len(mixed)


def test_repair_single_frame_holes_all_guards():
    valid = [frame(0, 220), frame(0.01, voiced=False), frame(0.02, 221)]
    repaired = post._repair_single_frame_holes(valid)
    assert repaired[1].voiced
    cases = [
        [frame(0, 220), frame(0.01, 220), frame(0.02, 221)],
        [frame(0, voiced=False), frame(0.01, voiced=False), frame(0.02, 221)],
        [frame(0, 220), frame(0.01, voiced=False), frame(0.02, voiced=False)],
        [frame(0, 220), frame(0.01, voiced=False), frame(0.2, 221)],
        [frame(0, 220), frame(0.01, voiced=False), frame(0.02, 440)],
    ]
    for frames in cases:
        assert not post._repair_single_frame_holes(frames)[1].voiced or frames[1].voiced


def test_stabilize_pitch_public_contract():
    short = [frame(0), frame(0.01)]
    assert post.stabilize_pitch(short, max_octave_jump=1) == short
    frames = [frame(0), frame(0.01, voiced=False), frame(0.02)]
    assert post.stabilize_pitch(frames)[1].voiced
