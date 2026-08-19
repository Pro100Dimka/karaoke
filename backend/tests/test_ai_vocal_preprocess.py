from tests._shared import raises, patch_many, pitch_frame

import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import soundfile as sf

from AI import audio as ai_audio
from AI import vocal_preprocess as vocal
from AI.errors import AICoreError
from AI.models import PitchFrame


def write(path, values, rate=1000): sf.write(path, np.asarray(values, dtype=np.float32), rate, format='WAV')


def test_render_analysis_variant_success(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    write(source, np.ones(100))
    target = tmp_path / "nested" / "target.wav"

    def run(command, **_): write(command[-1], np.ones(100))

    monkeypatch.setattr(ai_audio.subprocess, "run", run)
    assert (vocal._render_analysis_variant(source, target, 'filter') == target) and (target.exists() and (not list(target.parent.glob('*.tmp'))))
    raises(FileNotFoundError, lambda: vocal._render_analysis_variant(tmp_path / 'missing', target, 'filter'))


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (FileNotFoundError(), "FFmpeg is required"),
        (subprocess.TimeoutExpired("ffmpeg", 1), "safety timeout"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b"filter bad"), "filter bad"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b""), "preprocessing failed"),
    ],
)
def test_render_wraps_ffmpeg_failures(monkeypatch, tmp_path, failure, message):
    source = tmp_path / "source.wav"
    write(source, np.ones(100))
    monkeypatch.setattr(ai_audio.subprocess, "run", Mock(side_effect=failure))
    raises(AICoreError, lambda: vocal._render_analysis_variant(source, tmp_path / 'out.wav', 'filter'), match=message)


@pytest.mark.parametrize(
    ("target_info", "message"),
    [
        (SimpleNamespace(frames=0, samplerate=1000, duration=0.1), "empty WAV"),
        (SimpleNamespace(frames=1, samplerate=2000, duration=0.1), "sample rate"),
        (SimpleNamespace(frames=1, samplerate=1000, duration=1), "changed duration"),
    ],
)
def test_render_rejects_changed_output(monkeypatch, tmp_path, target_info, message):
    source = tmp_path / "source.wav"
    write(source, np.ones(100))

    def run(command, **_):
        with open(command[-1], "wb") as stream: stream.write(b"wav")

    infos = iter((SimpleNamespace(frames=100, samplerate=1000, duration=0.1), target_info))
    patch_many(monkeypatch, (ai_audio.subprocess, "run", run), (vocal.sf, "info", lambda _: next(infos)))
    raises(AICoreError, lambda: vocal._render_analysis_variant(source, tmp_path / 'out.wav', 'filter'), match=message)


def test_adaptive_gate_threshold_and_variants(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    write(source, np.linspace(-0.1, 0.1, 1000))
    threshold = vocal._adaptive_gate_threshold(source)
    assert 0.001 <= threshold <= 0.03
    short = tmp_path / "short.wav"
    write(short, [0, 1])
    assert vocal._adaptive_gate_threshold(short) == 0.008
    render = Mock(side_effect=[tmp_path / "denoise", tmp_path / "tail"])
    monkeypatch.setattr(vocal, "_render_analysis_variant", render)
    result = vocal.prepare_midi_analysis_variants(source, tmp_path / "d", tmp_path / "t")
    assert (result == {'denoise': tmp_path / 'denoise', 'tail-suppressed': tmp_path / 'tail'}) and ('agate=threshold=' in render.call_args_list[1].args[2])
    render.reset_mock(return_value=True, side_effect=True)
    render.return_value = tmp_path / "single"
    assert vocal.prepare_midi_analysis_vocal(source, tmp_path / "d") == tmp_path / "single"


frame = pitch_frame


def test_score_pitch_track_empty_short_and_discontinuous():
    assert vocal.score_pitch_track([]).score == -1
    short = vocal.score_pitch_track([frame(0), frame(0.01, voiced=False)])
    assert short.score == -0.5 and short.voiced_ratio == 0.5
    frames = [
        frame(0, 220),
        frame(0.01, 440),
        frame(0.02, 440),
        frame(0.03, 220),
        frame(0.04, voiced=False),
        frame(0.05, 220),
        frame(0.06, voiced=False),
        frame(0.07, 220),
        frame(0.08, 220),
        frame(0.09, 220),
    ]
    quality = vocal.score_pitch_track(frames)
    assert (quality.jump_rate > 0 and quality.octave_flip_rate > 0) and (quality.micro_run_rate > 0)
    constant_time = vocal.score_pitch_track([frame(0), frame(0), frame(0)])
    assert np.isfinite(constant_time.score)


def quality(score=0, voiced=0.8, confidence=0.8, jump=0.1, micro=0.1, octave=0.1): return vocal.PitchTrackQuality(score, voiced, confidence, jump, micro, octave)


def test_pitch_quality_selection_rules():
    original = quality(score=0.5)
    assert (not vocal.prefer_cleaned_pitch(original, quality(voiced=0.5))) and (not vocal.prefer_cleaned_pitch(original, quality(confidence=0.6)))
    better = quality(score=0.6, confidence=0.9, jump=0, micro=0, octave=0)
    assert (vocal._relative_wins(better, original) > 1) and (vocal.prefer_cleaned_pitch(original, better))
    raises(ValueError, lambda: vocal.choose_best_pitch_track({'clean': better}), match='original')
    assert (vocal.choose_best_pitch_track({'original': original, 'bad': quality(voiced=0.1), 'weak': quality(confidence=0.1)}) == 'original') and (vocal.choose_best_pitch_track({'original': original, 'clean': better}) == 'clean')


def test_rms_envelope_levels(tmp_path):
    source = tmp_path / "audio.wav"
    write(source, [[1, -1], [0.5, 0.5], [0, 0]] * 20)
    envelope, levels = vocal._rms_envelope(source, frame_ms=1, hop_ms=1)
    assert (len(envelope) > 0 and levels['peak'] > 0) and (levels['crest_factor'] >= 1 and levels['clipped_sample_ratio'] >= 0)
    empty = tmp_path / "empty.wav"
    write(empty, np.asarray([], dtype=np.float32))
    _, empty_levels = vocal._rms_envelope(empty)
    assert empty_levels["peak"] == 0 and empty_levels["dc_offset"] == 0


def test_analyze_vocal_residuals_short_and_detailed(monkeypatch):
    levels, short = {'clipped_sample_ratio': 0.001}, np.ones(10)
    monkeypatch.setattr(vocal, "_rms_envelope", lambda _: (short, levels))
    assert vocal.analyze_vocal_residuals(*([None] * 4)) == {
        "available": False,
        "reason": "audio_too_short",
    }

    base = np.asarray(([1] * 8 + [0.1] * 8) * 4, dtype=float)
    instrumental, denoised, tail = base.copy(), base * 0.8, base * 0.5
    values = iter(((base, levels), (instrumental, {}), (denoised, {}), (tail, {})))
    monkeypatch.setattr(vocal, "_rms_envelope", lambda _: next(values))
    result = vocal.analyze_vocal_residuals(*([None] * 4))
    assert result["available"]
    causes = result["possible_causes_percent"]
    assert causes["accompaniment_leakage"] > 0 and causes["stationary_noise"] > 0

    flat = np.ones(64)
    values = iter(((flat, levels), (flat, {}), (flat, {}), (flat, {})))
    monkeypatch.setattr(vocal, "_rms_envelope", lambda _: next(values))
    result = vocal.analyze_vocal_residuals(*([None] * 4))
    assert result["proxies"]["vocal_instrumental_envelope_correlation"] == 0
