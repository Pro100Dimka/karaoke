
import builtins
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import config, profiler
from AI.errors import ConfigurationError
from AI.models import PitchFrame, StageReport, Syllable, VocalNote, Word
from AI.quality import evaluate_quality
from tests._shared import patch_attrs, raises


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_env_bool_true(monkeypatch, value):
    monkeypatch.setenv("FLAG", value)
    assert config._env_bool("FLAG", False)


@pytest.mark.parametrize("value", ["0", "false", "NO", "off"])
def test_env_bool_false(monkeypatch, value):
    monkeypatch.setenv("FLAG", value)
    assert not config._env_bool("FLAG", True)


def test_environment_parsers_defaults_and_errors(monkeypatch):
    monkeypatch.delenv("FLAG", raising=False)
    assert (config._env_bool('FLAG', True)) and (config._env_int('NUMBER', 2) == 2) and (config._env_float('FLOAT', 0.5) == 0.5)
    monkeypatch.setenv("FLAG", "maybe")
    monkeypatch.setenv("NUMBER", "x")
    monkeypatch.setenv("FLOAT", "x")
    raises(ConfigurationError, lambda: config._env_bool('FLAG', True))
    raises(ConfigurationError, lambda: config._env_int('NUMBER', 2))
    raises(ConfigurationError, lambda: config._env_float('FLOAT', 0.5))


@pytest.mark.parametrize(
    "changes",
    [
        {"hop_seconds": float("nan")},
        {"sample_rate": 0},
        {"hop_seconds": 1},
        {"fmin_hz": 1500},
        {"min_voiced_confidence": 2},
        {"min_note_sec": 0},
        {"split_note_semitones": 20},
        {"midi_bend_range": 0},
        {"asr_model": " "},
        {"separation_engine": "other"},
        {"pitch_engine": "other"},
        {"transcription_engine": "other"},
        {"alignment_engine": "other"},
    ],
)
def test_core_config_rejects_invalid_values(changes):
    raises(ConfigurationError, lambda: config.CoreConfig(**changes))


def test_core_config_default_min_note_filters_transient_blips():
    default = config.CoreConfig()
    assert (default.min_note_sec == pytest.approx(0.07)) and (config.CoreConfig.from_env().min_note_sec == pytest.approx(0.07))


def test_core_config_from_env_and_fingerprint(monkeypatch):
    monkeypatch.setenv("KARAOKE_AI_SAMPLE_RATE", "48000")
    monkeypatch.setenv("KARAOKE_AI_PITCH_SR", "22050")
    monkeypatch.setenv("KARAOKE_AI_HOP_SECONDS", ".02")
    monkeypatch.setenv("KARAOKE_AI_ALLOW_FALLBACK", "yes")
    value = config.CoreConfig.from_env()
    assert (value.sample_rate == 48000 and value.pitch_sample_rate == 22050) and (value.hop_seconds == 0.02 and value.allow_fallback) and (value.fingerprint()['sample_rate'] == 48000)


def test_quality_reports_good_and_bad_analysis():
    empty = evaluate_quality(0, [], [], [], [])
    assert (empty.overall == 0) and ('No timed words were produced' in empty.warnings)
    pitch, words, syllables, notes = [PitchFrame(0, 440, 0.9, True), PitchFrame(0.1, 0, 0, False)], [Word(0, 1, 'hello', confidence=0.9)], [Syllable(0, 1, 'hel', 0, 0, confidence=0.9)], [VocalNote(0, 1, 69)]
    good = evaluate_quality(1, pitch, words, syllables, notes)
    assert good.overall > 0.8 and not good.warnings
    bad = evaluate_quality(
        10,
        [PitchFrame(0, 440, 0.1, True)],
        [Word(0, 1, "hello", confidence=0.1)],
        [Syllable(0, 1, "hel", 0, 0, confidence=0.1)],
        [],
    )
    assert len(bad.warnings) == 4


def import_override(real_import, replacements):
    def fake(name, *args, **kwargs):
        value = replacements.get(name)
        if isinstance(value, BaseException): raise value
        return value if name in replacements else real_import(name, *args, **kwargs)

    return fake


def test_profiler_snapshot_and_environment_success(monkeypatch):
    process = SimpleNamespace(memory_info=lambda: SimpleNamespace(rss=10 * 1024 * 1024))
    psutil, cuda = SimpleNamespace(Process=lambda _: process), SimpleNamespace(is_available=lambda: True, memory_allocated=lambda: 2 * 1024 * 1024, memory_reserved=lambda: 3 * 1024 * 1024, get_device_name=lambda _: 'GPU', get_device_properties=lambda _: SimpleNamespace(total_memory=8 * 1024 * 1024), get_device_capability=lambda _: (8, 6))
    torch = SimpleNamespace(__version__="1", cuda=cuda, version=SimpleNamespace(cuda="12"))
    patch_attrs(monkeypatch, builtins, __import__=import_override(builtins.__import__, {'psutil': psutil, 'torch': torch}))
    snap = profiler.snapshot()
    assert snap.rss_mb == 10 and snap.cuda_allocated_mb == 2 and snap.cuda_reserved_mb == 3
    info = profiler.environment_info()
    assert (info['gpu'] == 'GPU' and info['vram_mb'] == 8) and (info['gpu_compute_capability'] == [8, 6])


@pytest.mark.parametrize("error", [ImportError("missing"), OSError("blocked")])
def test_profiler_process_failures(monkeypatch, error):
    patch_attrs(monkeypatch, builtins, __import__=import_override(builtins.__import__, {'psutil': error, 'torch': ImportError('missing')}))
    snap = profiler.snapshot()
    assert (snap.rss_mb is None and snap.cuda_allocated_mb is None) and (snap.warnings)


def test_profiler_cuda_runtime_failures_and_delta(monkeypatch):
    psutil, torch = SimpleNamespace(Process=lambda _: (_ for _ in ()).throw(OSError('memory'))), SimpleNamespace(__version__='1', cuda=SimpleNamespace(is_available=lambda: (_ for _ in ()).throw(RuntimeError('cuda'))), version=SimpleNamespace(cuda=None))
    patch_attrs(monkeypatch, builtins, __import__=import_override(builtins.__import__, {'psutil': psutil, 'torch': torch}))
    snap = profiler.snapshot()
    assert any("CUDA" in warning for warning in snap.warnings)
    info = profiler.environment_info()
    assert info["cuda_available"] is False and "cuda" in info["torch_error"]
    start, end = profiler.ResourceSnapshot(2, None, None, None, ('a',)), profiler.ResourceSnapshot(1, 3, 4, 5, ('a', 'b'))
    assert profiler.delta(start, end) == {
        "elapsed_sec": 0,
        "rss_mb": 3,
        "cuda_allocated_mb": 4,
        "cuda_reserved_mb": 5,
        "warnings": ["a", "b"],
    }


def test_profiler_environment_without_torch(monkeypatch):
    patch_attrs(monkeypatch, builtins, __import__=import_override(builtins.__import__, {'torch': ImportError('none')}))
    assert profiler.environment_info()["cuda_available"] is False


def test_runtime_telemetry_records_operations_and_resources(monkeypatch):
    samples, process, telemetry = iter([(100, 2.0, (10, 20, 1, 2)), (150, 3.5, (40, 70, 4, 7))]), SimpleNamespace(pid=7), profiler.RuntimeTelemetry(sample_interval=60)
    patch_attrs(monkeypatch, telemetry, _process_family=lambda: [process], _process_sample=lambda _process: next(samples))
    monkeypatch.setattr(profiler, "_torch_memory", lambda: (4.0, 6.0, []))

    with telemetry:
        assert profiler.current_telemetry() is telemetry
        profiler.record_operation("decode", byte_count=12)
        with profiler.profile_operation("read", byte_count=8): pass

    assert profiler.current_telemetry() is None
    result = telemetry.result([StageReport("stage", 1, False, "x")])
    assert ((result['operations']['decode']['count'], result['operations']['read']['bytes']) == (1, 8)) and (result['resources']['peak_rss_mb'] == pytest.approx(150 / 1024 / 1024)) and ((result['resources']['io_read_bytes'], result['resources']['peak_cuda_reserved_mb'], result['stages'][0]['stage']) == (30, 6, 'stage'))


def test_runtime_telemetry_helpers_without_active_session():
    profiler.record_operation("ignored")
    with profiler.profile_operation("ignored"): pass


def test_runtime_telemetry_sampling_failures_loop_and_idempotency(monkeypatch):
    telemetry = profiler.RuntimeTelemetry(sample_interval=60)
    patch_attrs(monkeypatch, telemetry, _process_family=lambda: [SimpleNamespace(pid=1)], _process_sample=Mock(side_effect=RuntimeError('process disappeared')))
    monkeypatch.setattr(profiler, "_torch_memory", lambda: (None, None, []))
    telemetry._sample()
    sample = Mock()
    monkeypatch.setattr(telemetry, "_sample", sample)
    telemetry._stop = SimpleNamespace(wait=Mock(side_effect=[False, True]), set=Mock())
    telemetry._sample_loop()
    sample.assert_called_once_with()

    telemetry = profiler.RuntimeTelemetry(sample_interval=60)
    monkeypatch.setattr(telemetry, "_sample", Mock())
    with telemetry:
        assert telemetry.start() is telemetry
    telemetry.stop()


def test_runtime_telemetry_process_family_failure(monkeypatch):
    real_import = builtins.__import__
    patch_attrs(monkeypatch, builtins, __import__=import_override(real_import, {'psutil': OSError('unavailable')}))
    assert profiler.RuntimeTelemetry()._process_family() == []
