from __future__ import annotations

import asyncio

import pytest

import config
from app import main as main_module


def test_env_int_rejects_non_integer(monkeypatch):
    monkeypatch.setenv("TEST_INTEGER", "abc")
    with pytest.raises(ValueError, match="TEST_INTEGER must be an integer"):
        config._env_int("TEST_INTEGER", 1, minimum=1)


def test_env_int_enforces_bounds(monkeypatch):
    monkeypatch.setenv("TEST_INTEGER", "70000")
    with pytest.raises(ValueError, match="1..65535"):
        config._env_int("TEST_INTEGER", 8000, minimum=1, maximum=65535)


def test_unique_csv_trims_deduplicates_and_preserves_order(monkeypatch):
    monkeypatch.setenv("TEST_CSV", " one, two,one, ,three ")
    assert config._unique_csv("TEST_CSV", ()) == ("one", "two", "three")


def test_lifespan_stops_monitoring_even_if_recording_cleanup_fails(monkeypatch):
    calls: list[str] = []

    def fail_close():
        calls.append("recordings")
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(main_module, "init_db", lambda: None)
    monkeypatch.setattr(main_module.recording_service, "close_all_sessions", fail_close)
    monkeypatch.setattr(main_module.audio_service, "stop_monitoring", lambda: calls.append("monitor"))

    async def exercise():
        manager = main_module.lifespan(main_module.app)
        await manager.__aenter__()
        with pytest.raises(RuntimeError, match="cleanup failed"):
            await manager.__aexit__(None, None, None)

    asyncio.run(exercise())
    assert calls == ["recordings", "monitor"]
