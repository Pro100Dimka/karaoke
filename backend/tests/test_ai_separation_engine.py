from __future__ import annotations

import builtins
import queue
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from AI.engines import separation
from AI.errors import AICoreError, EngineUnavailableError


class ResultQueue:
    def __init__(self, value=None, empty=False):
        self.value = value
        self.empty = empty

    def put(self, value):
        self.value = value

    def get(self, timeout=None):
        if self.empty:
            raise queue.Empty
        return self.value


def test_msst_worker_success_restores_import_state(monkeypatch, tmp_path):
    engine = tmp_path / "engine"
    (engine / "models").mkdir(parents=True)
    previous = ModuleType("models")
    monkeypatch.setitem(sys.modules, "models", previous)
    loader = SimpleNamespace(
        exec_module=lambda module: setattr(module, "proc_folder", lambda args: None)
    )
    spec = SimpleNamespace(loader=loader)
    monkeypatch.setattr(separation.importlib.util, "spec_from_file_location", lambda *_: spec)
    monkeypatch.setattr(
        separation.importlib.util, "module_from_spec", lambda _: ModuleType("worker")
    )
    result = ResultQueue("unset")
    separation._run_msst_worker(str(engine), {"a": 1}, result)
    assert result.value is None
    assert sys.modules["models"] is previous
    assert str(engine.resolve()) not in sys.path


def test_msst_worker_reports_all_failures_and_handles_null_streams(monkeypatch, tmp_path):
    real_import = builtins.__import__

    def imports(name, *args, **kwargs):
        if name == "torch":
            return SimpleNamespace(
                cuda=SimpleNamespace(is_available=lambda: True),
                backends=SimpleNamespace(
                    cuda=SimpleNamespace(matmul=SimpleNamespace(allow_tf32=False)),
                    cudnn=SimpleNamespace(allow_tf32=False, benchmark=False),
                ),
                set_float32_matmul_precision=lambda _: None,
            )
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", imports)
    monkeypatch.setattr(separation.importlib.util, "spec_from_file_location", lambda *_: None)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    result = ResultQueue()
    separation._run_msst_worker(str(tmp_path), {}, result)
    assert "Could not load" in result.value


@pytest.mark.parametrize(
    ("audio", "channels", "frames", "shape"),
    [
        (np.ones(2), 2, 4, (4, 2)),
        (np.ones((4, 3)), 2, 2, (2, 2)),
        (np.ones((2, 1)), 3, 2, (2, 3)),
    ],
)
def test_fit_channels_and_length(audio, channels, frames, shape):
    assert separation._fit_channels_and_length(audio, channels, frames).shape == shape


def resources(tmp_path):
    engine = tmp_path / "engine"
    engine.mkdir()
    inference = engine / "inference.py"
    inference.write_text("pass")
    config = tmp_path / "config.yaml"
    config.write_text("x")
    checkpoint = tmp_path / "model.ckpt"
    checkpoint.write_text("x")
    return engine, config, checkpoint


def test_separator_resource_discovery(monkeypatch, tmp_path):
    for name in ("MSST_ENGINE_DIR", "MSST_CONFIG", "MSST_CHECKPOINT"):
        monkeypatch.delenv(name, raising=False)
    separator = separation.MSSTMelRoformerSeparator()
    assert not separator.available() and len(separator.missing_resources()) == 3
    with pytest.raises(EngineUnavailableError, match="not configured"):
        separator._run_engine(tmp_path, tmp_path)
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    assert separator.available() and separator.missing_resources() == []


class Process:
    def __init__(self, alive=None, exitcode=0):
        self.states = iter(alive or [False])
        self.current = False
        self.exitcode = exitcode
        self.terminated = False

    def start(self):
        pass

    def is_alive(self):
        self.current = next(self.states, self.current)
        return self.current

    def join(self, timeout=None):
        pass

    def terminate(self):
        self.terminated = True


def context(process, result_queue):
    return SimpleNamespace(
        Queue=lambda **_: result_queue,
        Process=lambda **_: process,
    )


def test_run_engine_success_empty_queue_and_errors(monkeypatch, tmp_path):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    process = Process(exitcode=0)
    monkeypatch.setattr(
        separation.multiprocessing,
        "get_context",
        lambda _: context(process, ResultQueue(empty=True)),
    )
    separator._run_engine(tmp_path, tmp_path)
    process = Process(exitcode=2)
    monkeypatch.setattr(
        separation.multiprocessing, "get_context", lambda _: context(process, ResultQueue())
    )
    with pytest.raises(AICoreError, match="code 2"):
        separator._run_engine(tmp_path, tmp_path)
    process = Process(exitcode=0)
    monkeypatch.setattr(
        separation.multiprocessing, "get_context", lambda _: context(process, ResultQueue("trace"))
    )
    with pytest.raises(AICoreError, match="trace"):
        separator._run_engine(tmp_path, tmp_path)


def test_run_engine_heartbeat_and_timeout(monkeypatch, tmp_path, capsys):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    process = Process([True, True, False])
    monkeypatch.setattr(
        separation.multiprocessing, "get_context", lambda _: context(process, ResultQueue())
    )
    times = iter([0, 1, 2, 3])
    monkeypatch.setattr(separation.time, "monotonic", lambda: next(times, 3))
    separator._run_engine(tmp_path, tmp_path)
    assert "separation is active" in capsys.readouterr().out

    process = Process([True, True, True])
    monkeypatch.setattr(
        separation.multiprocessing, "get_context", lambda _: context(process, ResultQueue())
    )
    times = iter([0, 1801, 1801])
    monkeypatch.setattr(separation.time, "monotonic", lambda: next(times, 1801))
    with pytest.raises(AICoreError, match="30-minute"):
        separator._run_engine(tmp_path, tmp_path)
    assert process.terminated


def write(path, audio, rate=8000):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.asarray(audio, dtype=np.float32), rate)


def test_separate_with_and_without_instrumental(monkeypatch, tmp_path):
    mix = tmp_path / "mix.wav"
    write(mix, [[0.5, -0.5]] * 10)
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))

    def run(_input, output):
        write(output / "vocals.wav", [[0.2]] * 5)

    monkeypatch.setattr(separator, "_run_engine", run)
    vocals, instrumental = tmp_path / "out" / "v.wav", tmp_path / "out" / "i.wav"
    separator.separate(mix, vocals, instrumental)
    assert sf.info(vocals).channels == 2 and sf.info(vocals).frames == 10
    assert sf.info(instrumental).frames == 10

    def both(_input, output):
        write(output / "vocals.wav", [[0.2, 0.2]] * 10)
        write(output / "instrumental.wav", [[0.3, 0.3]] * 10)

    monkeypatch.setattr(separator, "_run_engine", both)
    separator.separate(mix, vocals, instrumental)


def test_separate_rejects_missing_or_mismatched_stems(monkeypatch, tmp_path):
    mix = tmp_path / "mix.wav"
    write(mix, [[0, 0]] * 10)
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    monkeypatch.setattr(separator, "_run_engine", lambda *_: None)
    with pytest.raises(AICoreError, match="vocals stem"):
        separator.separate(mix, tmp_path / "v", tmp_path / "i")

    def wrong_vocal(_input, output):
        write(output / "vocals.wav", [[0, 0]], 16000)

    monkeypatch.setattr(separator, "_run_engine", wrong_vocal)
    with pytest.raises(AICoreError, match="vocals sample-rate"):
        separator.separate(mix, tmp_path / "v", tmp_path / "i")

    def wrong_inst(_input, output):
        write(output / "vocals.wav", [[0, 0]], 8000)
        write(output / "instrumental.wav", [[0, 0]], 16000)

    monkeypatch.setattr(separator, "_run_engine", wrong_inst)
    with pytest.raises(AICoreError, match="instrumental sample-rate"):
        separator.separate(mix, tmp_path / "v", tmp_path / "i")


def test_separate_requires_resources(monkeypatch, tmp_path):
    for name in ("MSST_ENGINE_DIR", "MSST_CONFIG", "MSST_CHECKPOINT"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(EngineUnavailableError, match="resources are missing"):
        separation.MSSTMelRoformerSeparator().separate("mix", tmp_path / "v", tmp_path / "i")


def test_center_channel_fallback_mono_and_stereo(tmp_path):
    separator = separation.CenterChannelFallbackSeparator()
    mono = tmp_path / "mono.wav"
    write(mono, [0.5, -0.5])
    vocals, inst = tmp_path / "mono-v.wav", tmp_path / "mono-i.wav"
    separator.separate(mono, vocals, inst)
    assert np.allclose(sf.read(inst)[0], 0)
    stereo = tmp_path / "stereo.wav"
    write(stereo, [[1, -1], [0.5, 0.5]])
    separator.separate(stereo, vocals, inst)
    assert sf.info(vocals).channels == 2
