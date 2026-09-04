import queue
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.routers import audio_relay
from app.services.audio_relay_protocol import STREAM_DRY, FrameReader, encode_frame


def make_app():
    app = FastAPI()
    app.include_router(audio_relay.router)
    return app


def test_rejects_a_missing_or_wrong_token_when_one_is_configured(monkeypatch):
    # The router closes the socket before ever accepting it for a bad token,
    # so the test client surfaces that as a failed handshake, not a message
    # to receive after connecting -- unlike the no-relay-available path
    # below, which accepts first and closes afterward.
    monkeypatch.setattr(audio_relay, "_API_TOKEN", "secret")
    with TestClient(make_app()) as client:
        with pytest.raises(WebSocketDisconnect) as missing:
            with client.websocket_connect("/audio/direct-monitor/relay"):
                pass
        assert missing.value.code == 1008

        with pytest.raises(WebSocketDisconnect) as wrong:
            with client.websocket_connect("/audio/direct-monitor/relay?token=wrong"):
                pass
        assert wrong.value.code == 1008


def test_accepts_the_correct_token(monkeypatch):
    monkeypatch.setattr(audio_relay, "_API_TOKEN", "secret")
    monkeypatch.setattr(audio_relay.audio_service, "subscribe_monitor_relay", lambda: None)
    with TestClient(make_app()) as client:
        with client.websocket_connect("/audio/direct-monitor/relay?token=secret") as ws:
            message = ws.receive()
    assert message["type"] == "websocket.close"
    assert message["code"] == audio_relay._NO_RELAY_CLOSE_CODE


def test_closes_with_a_distinct_code_when_no_relay_is_running(monkeypatch):
    monkeypatch.setattr(audio_relay, "_API_TOKEN", "")
    monkeypatch.setattr(audio_relay.audio_service, "subscribe_monitor_relay", lambda: None)
    with TestClient(make_app()) as client:
        with client.websocket_connect("/audio/direct-monitor/relay") as ws:
            message = ws.receive()
    assert message["type"] == "websocket.close"
    assert message["code"] == audio_relay._NO_RELAY_CLOSE_CODE


def test_forwards_frames_from_the_subscribed_queue_to_the_browser(monkeypatch):
    monkeypatch.setattr(audio_relay, "_API_TOKEN", "")
    relay = Mock()
    subscriber = queue.Queue()
    subscriber.put((STREAM_DRY, 48000.0, [0.1, 0.2, 0.3]))
    monkeypatch.setattr(audio_relay.audio_service, "subscribe_monitor_relay", lambda: (relay, subscriber))

    with TestClient(make_app()) as client:
        with client.websocket_connect("/audio/direct-monitor/relay") as ws:
            payload = ws.receive_bytes()
            reader = FrameReader()
            reader.feed(payload)
            frames = reader.pop_frames()
            assert len(frames) == 1
            stream_id, sample_rate, decoded = frames[0]
            assert stream_id == STREAM_DRY
            assert sample_rate == 48000.0
            assert list(decoded) == pytest.approx([0.1, 0.2, 0.3], abs=1e-6)

    relay.unsubscribe.assert_called_once_with(subscriber)


def test_matches_the_wire_format_used_by_relay_link(monkeypatch):
    monkeypatch.setattr(audio_relay, "_API_TOKEN", "")
    relay = Mock()
    subscriber = queue.Queue()
    subscriber.put((STREAM_DRY, 48000.0, [1.0, -1.0]))
    monkeypatch.setattr(audio_relay.audio_service, "subscribe_monitor_relay", lambda: (relay, subscriber))

    with TestClient(make_app()) as client:
        with client.websocket_connect("/audio/direct-monitor/relay") as ws:
            payload = ws.receive_bytes()

    assert payload == encode_frame(STREAM_DRY, 48000.0, [1.0, -1.0])
