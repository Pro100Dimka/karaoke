
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import AI
from AI import artifacts, run_all, service
from AI import runtime as ai_runtime
from AI.engines import device, registry
from AI.errors import ConfigurationError
from AI.utils import io
from tests._shared import patch_attrs, patch_many, raises


def test_lazy_ai_exports_and_unknown_attribute():
    assert (AI.__version__) and (AI.CoreConfig.__name__ == 'CoreConfig')
    raises(AttributeError, lambda: AI.__getattr__('missing'), match='missing')


@pytest.mark.parametrize(
    ("preference", "cuda", "expected"),
    [
        ("cpu", False, "cpu"),
        ("cuda", True, "cuda:0"),
        ("auto", True, "cuda:0"),
        ("", False, "cpu"),
    ],
)
def test_device_selection(monkeypatch, preference, cuda, expected):
    ai_runtime.reset_runtime_for_tests()
    monkeypatch.setenv("SONGAPP_DEVICE", preference)
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda))
    assert device.select_torch_device(torch) == expected


def test_device_selection_safely_falls_back_for_unavailable_or_unknown(monkeypatch):
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
    monkeypatch.setenv("SONGAPP_DEVICE", "cuda")
    ai_runtime.reset_runtime_for_tests()
    assert device.select_torch_device(torch) == "cpu"
    monkeypatch.setenv("SONGAPP_DEVICE", "metal")
    ai_runtime.reset_runtime_for_tests()
    assert device.select_torch_device(torch) == "cpu"


def test_default_engine_registry_uses_config(monkeypatch):
    constructors = {
        name: Mock(return_value=name)
        for name in ("separator", "pitch", "transcriber", "aligner")
    }
    patch_attrs(monkeypatch, registry, MSSTMelRoformerSeparator=constructors['separator'], FCPEPitchEstimator=constructors['pitch'], Qwen3Transcriber=constructors['transcriber'], Qwen3ForcedAligner=constructors['aligner'])
    config = SimpleNamespace(
        pitch_sample_rate=100,
        hop_seconds=0,
        fmin_hz=50,
        fmax_hz=500,
        asr_model="asr",
        aligner_model="align",
    )
    engines = registry.EngineRegistry.create_default(config)
    assert (
        engines.separator,
        engines.pitch,
        engines.transcriber,
        engines.aligner,
        engines.melody,
    ) == (
        "separator",
        "pitch",
        "transcriber",
        "aligner",
        None,
    )
    constructors["pitch"].assert_called_once_with(sr=100, hop=1, fmin=50, fmax=500)


def test_atomic_ai_io_round_trip_and_defaults(tmp_path):
    binary = tmp_path / "nested" / "value.bin"
    io.write_bytes_atomic(binary, b"data")
    assert binary.read_bytes() == b"data"
    text = tmp_path / "value.txt"
    io.write_text_atomic(text, "текст")
    assert text.read_text(encoding="utf-8") == "текст"
    payload = tmp_path / "value.json"
    io.write_json_atomic(payload, {"b": 1, "a": "я"})
    assert (io.read_json(payload) == {'a': 'я', 'b': 1}) and (io.read_json(tmp_path / 'missing', 'safe') == 'safe')
    payload.write_bytes(b"\xff")
    assert io.read_json(payload, {}) == {}


def test_atomic_io_cleans_temporary_file_on_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(io.os, "replace", Mock(side_effect=OSError("locked")))
    raises(OSError, lambda: io.write_bytes_atomic(tmp_path / 'value', b'data'), match='locked')
    assert list(tmp_path.iterdir()) == []


def test_artifact_transaction_validation_and_success(tmp_path):
    assert artifacts.publish_files_atomically([]) is None
    missing = tmp_path / "missing"
    raises(FileNotFoundError, lambda: artifacts.publish_files_atomically([(missing, tmp_path / 'out')]), match='missing')
    source = tmp_path / "source"
    source.write_text("new")
    target = tmp_path / "target"
    target.write_text("old")
    raises(ValueError, lambda: artifacts.publish_files_atomically([(source, target), (source, target)]), match='unique')
    artifacts.publish_files_atomically([(source, target)])
    assert (target.read_text() == 'new') and (not list(tmp_path.glob('*.bak')))


def test_artifact_transaction_rolls_back(monkeypatch, tmp_path):
    first = tmp_path / "first"
    first.write_text("one")
    second = tmp_path / "second"
    second.write_text("two")
    first_target = tmp_path / "out1"
    first_target.write_text("old")
    second_target, original = tmp_path / 'out2', artifacts.os.replace

    def replace(source, target):
        if Path(source) == second: raise OSError("publish failed")
        return original(source, target)

    monkeypatch.setattr(artifacts.os, "replace", replace)
    raises(OSError, lambda: artifacts.publish_files_atomically([(first, first_target), (second, second_target)]), match='publish failed')
    assert (first_target.read_text() == 'old') and (not second_target.exists())


def pipeline_stub():
    pitch, aligner = SimpleNamespace(name='pitch', estimate=Mock(return_value=['raw'])), SimpleNamespace(name='align', _ctc=SimpleNamespace(models={'ru': 'r'}))
    engines = SimpleNamespace(
        separator=SimpleNamespace(name="sep", available=lambda: False),
        pitch=pitch,
        transcriber=SimpleNamespace(name="asr"),
        aligner=aligner,
    )
    return SimpleNamespace(VERSION="v", engines=engines, run=Mock(return_value="done"))


def test_ai_service_facade(monkeypatch):
    pipeline = pipeline_stub()
    patch_attrs(monkeypatch, service, KaraokePipeline=lambda _: pipeline, stabilize_pitch=lambda frames: [*frames, 'stable'])
    config = SimpleNamespace(allow_fallback=True)
    core = service.AICoreService(config)
    assert core.process_song(
        "in", "out", language="uk", bpm_override=120, processing_mode="fast"
    ) == "done"
    request = pipeline.run.call_args.args[0]
    assert (request.source_path == 'in' and request.language == 'uk' and (request.bpm_override == 120) and request.processing_mode == "fast") and (core.analyze_pitch('voice') == ['raw', 'stable'])
    health = core.health()
    assert (health['ctc_ru_configured'] is True) and (health['ctc_uk_configured'] is False) and (health['separation_configured'] is False)
    pipeline.close = Mock()
    core.close()
    pipeline.close.assert_called_once_with()


def test_ai_service_singleton_and_reset(monkeypatch):
    service.reset_ai_service()
    config, instance = object(), Mock()
    patch_many(monkeypatch, (service, "AICoreService", Mock(return_value=instance)), (service.CoreConfig, "from_env", lambda: config))
    assert (service.get_ai_service(config) is instance) and (service.get_ai_service(config) is instance)
    raises(ConfigurationError, lambda: service.get_ai_service(object()), match='another configuration')
    instance.process_song.return_value = "ok"
    assert service.process_song(1, value=2) == "ok"
    service.reset_ai_service()
    instance.close.assert_called_once_with()
    assert service._service is None and service._service_config is None


def test_run_all_cli(monkeypatch, capsys, tmp_path):
    result, pipeline = SimpleNamespace(manifest_path=tmp_path / 'manifest.json', warnings=['warning']), Mock()
    pipeline.run.return_value = result
    monkeypatch.setattr(run_all, "KaraokePipeline", Mock(return_value=pipeline))
    run_all.main(
        [
            "--input",
            "song.wav",
            "--output",
            str(tmp_path),
            "--language",
            "uk",
            "--bpm",
            "123",
            "--key",
            "Am",
        ]
    )
    assert json.loads(capsys.readouterr().out) == {
        "status": "ok",
        "manifest": str(result.manifest_path),
        "warnings": ["warning"],
    }
    request = pipeline.run.call_args.args[0]
    assert request.source_path == "song.wav" and request.key_override == "Am"
