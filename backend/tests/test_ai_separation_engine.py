from __future__ import annotations

import queue
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

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

    put_nowait = put

    def get(self, timeout=None):
        if self.empty:
            raise queue.Empty
        return self.value


def test_persistent_worker_loads_once_and_moves_model_off_gpu(monkeypatch, tmp_path):
    engine = tmp_path / "engine"
    (engine / "models").mkdir(parents=True)
    moves, runs, results = [], [], []
    model = SimpleNamespace(
        eval=lambda: model,
        to=lambda device: moves.append(device) or model,
    )
    torch = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            empty_cache=lambda: moves.append("empty"),
        ),
        backends=SimpleNamespace(
            cuda=SimpleNamespace(matmul=SimpleNamespace(allow_tf32=False)),
            cudnn=SimpleNamespace(allow_tf32=False, benchmark=False),
            mps=SimpleNamespace(is_available=lambda: False),
        ),
        set_float32_matmul_precision=lambda _: None,
        load=lambda *_args, **_kwargs: object(),
    )
    module_values = {
        "torch": torch,
        "parse_args_inference": lambda values: SimpleNamespace(
            **values, force_cpu=False, device_ids=0
        ),
        "get_model_from_config": lambda *_: (
            model,
            SimpleNamespace(training={"instruments": ["vocals"]}),
        ),
        "load_start_checkpoint": lambda *_args, **_kwargs: None,
        "run_folder": lambda _model, args, *_args, **_kwargs: runs.append(
            (args.input_folder, args.store_dir)
        ),
    }

    def load(module):
        for name, value in module_values.items():
            setattr(module, name, value)

    monkeypatch.setattr(
        separation.importlib.util,
        "spec_from_file_location",
        lambda *_: SimpleNamespace(loader=SimpleNamespace(exec_module=load)),
    )
    monkeypatch.setattr(
        separation.importlib.util, "module_from_spec", lambda _: ModuleType("worker")
    )
    requests = SimpleNamespace(get=Mock(side_effect=[("job", "in", "out"), None]))
    output = SimpleNamespace(put=results.append)
    separation._run_persistent_msst_worker(
        str(engine),
        {"model_type": "mel_band_roformer", "config_path": "c", "start_check_point": "p"},
        requests,
        output,
    )
    assert results[0][0] == "ready" and results[1][0] == "job"
    assert runs == [("in", "out")] and moves == ["cuda:0", "cpu", "empty"]


def test_persistent_worker_mps_model_override_failure_and_idle(monkeypatch, tmp_path):
    engine = tmp_path / "engine"
    (engine / "models").mkdir(parents=True)
    moves, results = [], []

    class Training(dict):
        __getattr__ = dict.__getitem__

    model = SimpleNamespace(eval=lambda: model, to=lambda device: moves.append(device) or model)
    torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None),
        mps=SimpleNamespace(empty_cache=lambda: moves.append("mps-empty")),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: True)),
        load=lambda *_args, **_kwargs: object(),
    )
    values = {
        "torch": torch,
        "parse_args_inference": lambda data: SimpleNamespace(**data, force_cpu=False, device_ids=0),
        "get_model_from_config": lambda *_: (
            model,
            SimpleNamespace(training=Training(model_type="alternate")),
        ),
        "load_start_checkpoint": lambda *_args, **_kwargs: None,
        "run_folder": Mock(side_effect=RuntimeError("inference failed")),
    }

    def load(module):
        for name, value in values.items():
            setattr(module, name, value)

    monkeypatch.setattr(
        separation.importlib.util,
        "spec_from_file_location",
        lambda *_: SimpleNamespace(loader=SimpleNamespace(exec_module=load)),
    )
    monkeypatch.setattr(
        separation.importlib.util, "module_from_spec", lambda _: ModuleType("worker")
    )
    requests = SimpleNamespace(get=Mock(side_effect=[("job", "in", "out"), queue.Empty()]))
    separation._run_persistent_msst_worker(
        str(engine),
        {"model_type": "mel_band_roformer", "config_path": "c", "start_check_point": "p"},
        requests,
        SimpleNamespace(put=results.append),
    )
    assert results[1][0] == "job" and "inference failed" in results[1][2]
    assert moves == ["mps", "cpu", "mps-empty"]


def test_park_model_cpu_cuda_and_mps():
    moves = []
    model = SimpleNamespace(to=lambda device: moves.append(device) or model)
    torch = SimpleNamespace(
        cuda=SimpleNamespace(empty_cache=lambda: moves.append("cuda-empty")),
        mps=SimpleNamespace(empty_cache=lambda: moves.append("mps-empty")),
    )
    assert separation._park_model(model, "cpu", torch) is model
    separation._park_model(model, "cuda:0", torch)
    separation._park_model(model, "mps", torch)
    assert moves == ["cpu", "cuda-empty", "cpu", "mps-empty"]


def test_persistent_worker_reports_boot_failure_without_console(monkeypatch, tmp_path):
    monkeypatch.setattr(separation.importlib.util, "spec_from_file_location", lambda *_: None)
    monkeypatch.setattr(separation.sys, "stdout", None)
    monkeypatch.setattr(separation.sys, "stderr", None)
    results = []
    separation._run_persistent_msst_worker(
        str(tmp_path), {}, SimpleNamespace(), SimpleNamespace(put=results.append)
    )
    assert results[0][0] == "ready" and "Could not load" in results[0][2]


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
    monkeypatch.setattr(separation.uuid, "uuid4", lambda: SimpleNamespace(hex="job"))
    process = Process([True], exitcode=0)
    separator._process = process
    separator._request_queue = ResultQueue()
    separator._result_queue = ResultQueue(("job", 2.0, None))
    monkeypatch.setattr(separator, "_ensure_worker", lambda _: None)
    separator._run_engine(tmp_path, tmp_path)
    process = Process(exitcode=2)
    separator._process = process
    with pytest.raises(AICoreError, match="code 2"):
        separator._run_engine(tmp_path, tmp_path)
    process = Process([True], exitcode=0)
    separator._process = process
    separator._request_queue = ResultQueue()
    separator._result_queue = ResultQueue(("job", 1.0, "trace"))
    with pytest.raises(AICoreError, match="trace"):
        separator._run_engine(tmp_path, tmp_path)

    process = Process([True, True], exitcode=0)
    separator._process = process
    separator._request_queue = ResultQueue()
    separator._result_queue = SimpleNamespace(
        get=Mock(side_effect=[("other", 0.0, None), ("job", 1.0, None)])
    )
    separator._run_engine(tmp_path, tmp_path)


@pytest.mark.parametrize(
    ("ready", "message"),
    [
        (None, "initialization exceeded"),
        (("invalid", 0.0, None), "invalid ready"),
        (("ready", 0.0, "boot failed"), "boot failed"),
    ],
)
def test_ensure_worker_initialization_failures(monkeypatch, tmp_path, ready, message):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    requests = ResultQueue()
    results = ResultQueue(empty=ready is None, value=ready)
    queues = iter([requests, results])
    process = Process()
    context = SimpleNamespace(
        Queue=lambda **_: next(queues),
        Process=lambda **_: process,
    )
    monkeypatch.setattr(separation.multiprocessing, "get_context", lambda _: context)
    with pytest.raises(AICoreError, match=message):
        separator._ensure_worker({})


def test_ensure_worker_reuses_live_process_and_close_is_idempotent(monkeypatch, tmp_path):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    separator.close()
    separator._process = Process([True])
    monkeypatch.setattr(
        separation.multiprocessing,
        "get_context",
        Mock(side_effect=AssertionError("must reuse worker")),
    )
    separator._ensure_worker({})


def test_ensure_worker_starts_session(monkeypatch, tmp_path):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    queues = iter([ResultQueue(), ResultQueue(("ready", 1.5, None))])
    process = Process([True, False])
    context = SimpleNamespace(
        Queue=lambda **_: next(queues),
        Process=lambda **_: process,
    )
    monkeypatch.setattr(separation.multiprocessing, "get_context", lambda _: context)
    separator._ensure_worker({"model_type": "mel_band_roformer"})
    assert separator._process is process
    separator.close()


def test_run_engine_heartbeat_and_timeout(monkeypatch, tmp_path, capsys):
    engine, config, checkpoint = resources(tmp_path)
    separator = separation.MSSTMelRoformerSeparator(str(engine), str(config), str(checkpoint))
    process = Process([True, True, False])
    separator._process = process
    separator._request_queue = ResultQueue()
    separator._result_queue = ResultQueue(empty=True)
    monkeypatch.setattr(separator, "_ensure_worker", lambda _: None)
    times = iter([0, 1, 2, 3])
    monkeypatch.setattr(separation.time, "monotonic", lambda: next(times, 3))
    with pytest.raises(AICoreError, match="code 0"):
        separator._run_engine(tmp_path, tmp_path)
    assert "separation is active" in capsys.readouterr().out

    process = Process([True, True, True])
    separator._process = process
    separator._request_queue = ResultQueue()
    separator._result_queue = ResultQueue(empty=True)
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
    real_copy = separation.shutil.copy2
    monkeypatch.setattr(separation.os, "link", Mock(side_effect=OSError("cross-volume")))
    copy = Mock(wraps=real_copy)
    monkeypatch.setattr(separation.shutil, "copy2", copy)
    separator.separate(mix, vocals, instrumental)
    copy.assert_called_once()
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
