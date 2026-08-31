import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import audio
from app.services import audio_service, monitor_worker
from app.services.monitor_control import MonitorCancelled, MonitorControl
from database import get_db
from tests.test_audio_settings import settings


@pytest.fixture
def control(monkeypatch):
    instance = MonitorControl()
    monkeypatch.setattr(audio_service, "_monitor_control", instance)
    monkeypatch.setattr(audio_service, "_monitor_process", None)
    monkeypatch.setattr(audio_service, "_monitor_reader", None)
    monkeypatch.setattr(audio_service, "_monitor_effects_disabled", False)
    monkeypatch.setattr(audio_service, "_requested_effects_disabled", False)
    monkeypatch.setattr(audio_service, "_monitor_wasapi_mode", "shared")
    yield instance
    instance.cancel()


def test_latest_request_wins_and_old_status_is_ignored(control):
    entered, release, done = threading.Event(), threading.Event(), threading.Event()
    played = []
    old_token = []

    def first():
        old_token.append(control.local.token)
        entered.set()
        assert release.wait(2)
        control.check()
        played.append("stale")

    control.submit(first)
    assert entered.wait(2)
    control.submit(lambda: played.append("intermediate"))
    control.submit(lambda: (played.append("latest"), done.set()))
    release.set()
    assert done.wait(2)
    assert played == ["latest"]
    control.event(old_token[0], {"event": "error", "message": "stale driver failure"})
    assert "error" not in control.snapshot()


def test_stop_during_device_enumeration_never_launches_worker(control, monkeypatch):
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    def query():
        entered.set()
        assert release.wait(2)
        return []

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    monkeypatch.setattr(audio_service.sd, "query_devices", query)
    launch = Mock()
    monkeypatch.setattr(audio_service, "_start_monitor_worker", launch)
    audio_service.request_monitoring(settings(monitoring_enabled=True))
    assert entered.wait(2)
    audio_service.stop_monitoring()
    release.set()
    # A barrier in the same execution lane proves the cancelled request has ended.
    control.update_live(finished.set)
    # update_live on a cancelled token intentionally does nothing; execution lock
    # waits for the in-flight enumeration instead of relying on a sleep.
    with control.execution:
        pass
    launch.assert_not_called()
    assert control.snapshot()["state"] == "idle"


def test_http_accepts_start_and_settings_while_hardware_is_blocked(control, monkeypatch):
    entered, release, completed = threading.Event(), threading.Event(), threading.Event()
    current = settings(monitoring_enabled=False, noise_suppression=0.35, octave=0)
    db = Mock()
    db.get.return_value = current
    monkeypatch.setattr(audio_service, "commit_refresh", lambda _db, item: item)

    def configure(_settings):
        assert isinstance(_settings, SimpleNamespace)
        entered.set()
        assert release.wait(3)
        completed.set()
        control.check()

    monkeypatch.setattr(audio_service, "_configure_monitoring", configure)
    app = FastAPI()
    app.include_router(audio.router)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        try:
            start = time.perf_counter()
            response = client.post("/audio/direct-monitor/start")
            elapsed = time.perf_counter() - start
            assert response.status_code == 202
            assert elapsed < 0.2
            assert entered.wait(2)
            assert response.json()["monitoring_enabled"] is True
            assert client.get("/audio/direct-monitor/status").json()["state"] == "starting"
            query = Mock(side_effect=AssertionError("No device query in settings HTTP request"))
            monkeypatch.setattr(audio_service.sd, "query_devices", query)
            start = time.perf_counter()
            response = client.post("/audio/settings", json={"input_device_id": 2})
            assert response.status_code == 200
            assert time.perf_counter() - start < 0.2
            assert client.post("/audio/direct-monitor/stop").status_code == 200
            print(f"\nAccepted monitor start with blocked hardware: {elapsed * 1000:.1f} ms")
        finally:
            control.cancel()
            release.set()
            assert completed.wait(2)


def test_one_enumeration_and_no_parent_format_probes(control, monkeypatch):
    devices = [
        {"name": "USB mic", "hostapi": 0, "max_input_channels": 1, "max_output_channels": 0, "default_samplerate": 48000},
        {"name": "USB speakers", "hostapi": 0, "max_input_channels": 0, "max_output_channels": 2, "default_samplerate": 48000},
    ]
    query = Mock(return_value=devices)
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    monkeypatch.setattr(audio_service.sd, "query_devices", query)
    monkeypatch.setattr(audio_service.sd, "query_hostapis", lambda _: {"name": "Windows WASAPI"})
    monkeypatch.setattr(audio_service.sd, "default", SimpleNamespace(device=(0, 1)))
    monkeypatch.setattr(audio_service.sd, "check_input_settings", Mock(side_effect=AssertionError("No parent probe")))
    launch = Mock()
    monkeypatch.setattr(audio_service, "_start_monitor_worker", launch)
    audio_service.configure_monitoring(settings(monitoring_enabled=True, reverb=.3, echo=.4, delay=.2))
    query.assert_called_once_with()
    options = launch.call_args.args[0]
    assert options["wasapi_mode"] == "shared"
    assert (options["reverb"], options["echo"], options["delay"]) == (.3, .4, .2)


def test_live_changes_during_start_are_coalesced_without_restart(control, monkeypatch):
    entered, release, updated = threading.Event(), threading.Event(), threading.Event()
    def start():
        entered.set()
        assert release.wait(2)
        control.publish(state="running")
    control.submit(start)
    assert entered.wait(2)
    current = settings(monitoring_enabled=True, noise_suppression=.35, octave=0)
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _: current)
    monkeypatch.setattr(audio_service, "commit_refresh", lambda _db, item: item)
    calls = []
    monkeypatch.setattr(audio_service, "_send_live_update", lambda payload: (calls.append(payload), updated.set()))
    audio_service.update_settings(Mock(), {"echo": .2}, background=True)
    audio_service.update_settings(Mock(), {"reverb": .6}, background=True)
    release.set()
    assert updated.wait(2)
    assert len(calls) == 1
    assert calls[0]["echo"] == .2 and calls[0]["reverb"] == .6
    assert control.snapshot()["state"] == "running"


def test_status_distinguishes_driver_rejection_and_repeated_glitches(control):
    control.run_sync(lambda: None)
    token = control.token
    control.event(token, {"event": "fallback", "cause": "device-open", "message": "exclusive unavailable"})
    assert control.snapshot()["glitch_fallback_count"] == 0
    for _ in range(2):
        control.event(token, {"event": "fallback", "cause": "glitches", "message": "underflows"})
    control.event(token, {"event": "started", "mode": "shared", "blocksize": 256,
                          "sample_rate": 48000, "input_latency_ms": 5, "output_latency_ms": 8})
    result = control.snapshot()
    assert result["fallback_count"] == 3 and result["glitch_fallback_count"] == 2
    assert result["state"] == "running" and result["output_latency_ms"] == 8
    assert "startup_ms" in result
    control.cancel()
    control.event(token, {"event": "started"})
    assert control.snapshot()["state"] == "idle"


def test_cancelled_launch_does_not_spawn_a_process(control, monkeypatch, tmp_path):
    launch = Mock()
    monkeypatch.setattr(audio_service.subprocess, "Popen", launch)
    token = threading.Event()
    token.set()
    control.local.token = token
    try:
        with pytest.raises(MonitorCancelled):
            audio_service._launch_monitor_process(["unused"], cwd=tmp_path)
    finally:
        del control.local.token
    launch.assert_not_called()


def test_exclusive_is_opt_in_with_shared_fallback_and_correct_labels(monkeypatch):
    monkeypatch.setattr(monitor_worker.sd, "WasapiSettings", lambda **kwargs: kwargs)
    base = {"sample_rate": 48000, "output_channels": 2, "input_device_id": 0,
            "output_device_id": 1, "blocksize": 128, "wasapi_mode": "exclusive"}
    candidates = monitor_worker._stream_candidates(base)
    assert candidates[0]["extra_settings"] == ({"exclusive": True}, {"exclusive": True})
    shared = next(item for item in candidates if item["_mode"] == "shared")
    assert shared["extra_settings"] == ({"auto_convert": True}, {"auto_convert": True})
    partial = monitor_worker._stream_candidates({**base, "wasapi_mode": "input-exclusive"})[0]
    assert partial["extra_settings"] == ({"exclusive": True}, {"auto_convert": True})
    details = monitor_worker._stream_diagnostics(SimpleNamespace(latency=(.004, .006)), shared, base, "shared")
    assert details["exclusive"] is False
    assert details["input_latency_ms"] == 4 and details["output_latency_ms"] == 6


def test_fallback_never_decreases_explicit_buffer():
    base = {"sample_rate": 44100, "output_channels": 2, "input_device_id": 0,
            "output_device_id": 1, "blocksize": 512}
    assert all(item["blocksize"] == 0 or item["blocksize"] >= 512 for item in monitor_worker._stream_candidates(base))


def test_format_fallbacks_keep_native_rate_first():
    base = {"sample_rate": 44100, "sample_rates": [44100, 48000], "output_channels": 2,
            "input_device_id": 0, "output_device_id": 1, "blocksize": 128}
    candidates = monitor_worker._stream_candidates(base)
    assert candidates[0]["samplerate"] == 44100
    assert candidates[-1]["samplerate"] == 48000


def test_asio_settings_do_not_enumerate_drivers_in_http_thread(control, monkeypatch):
    current = settings(monitoring_enabled=False)
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _: current)
    monkeypatch.setattr(audio_service, "commit_refresh", lambda _db, item: item)
    enumerate_drivers = Mock(side_effect=AssertionError("Slow hardware enumeration in HTTP"))
    monkeypatch.setattr(audio_service, "list_asio_drivers", enumerate_drivers)
    saved = audio_service.update_settings(Mock(), {"audio_driver": "asio", "asio_driver_name": "Studio ASIO"}, background=True)
    assert saved.asio_driver_name == "Studio ASIO"
    enumerate_drivers.assert_not_called()


def test_async_hardware_error_is_reported_without_losing_controller(control):
    entered, release, barrier = threading.Event(), threading.Event(), threading.Event()
    def failing_start():
        entered.set()
        assert release.wait(2)
        raise RuntimeError("USB endpoint unavailable")
    control.submit(failing_start)
    assert entered.wait(2)
    control.update_live(barrier.set)
    release.set()
    assert barrier.wait(2)
    assert control.snapshot()["state"] == "error"
    assert control.snapshot()["error"] == "USB endpoint unavailable"
    recovered = threading.Event()
    control.submit(lambda: (control.publish(state="running"), recovered.set()))
    assert recovered.wait(2)
    assert control.snapshot()["state"] == "running"


def test_existing_asio_protocol_is_normalized_without_native_changes(control):
    control.run_sync(lambda: None)
    control.event(control.token, {"event": "started", "driver": "Studio ASIO",
                                "sample_rate": 48000, "buffer_size": 128,
                                "input_latency": 240, "output_latency": 480})
    status = control.snapshot()
    assert status["mode"] == "ASIO" and status["blocksize"] == 128
    assert status["input_latency_ms"] == 5 and status["output_latency_ms"] == 10
