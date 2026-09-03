import socket
import time

import numpy as np

from app.services.audio_relay import AudioRelayServer
from app.services.audio_relay_protocol import STREAM_DRY, encode_frame


def wait_until(predicate, timeout=2.0, interval=0.01):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_subscriber_receives_frames_sent_by_a_connected_client():
    server = AudioRelayServer()
    try:
        client = socket.create_connection(("127.0.0.1", server.port), timeout=2.0)
        try:
            subscriber = server.subscribe()
            samples = np.array([0.5, -0.5], dtype=np.float32)
            client.sendall(encode_frame(STREAM_DRY, 48000.0, samples))
            assert wait_until(lambda: not subscriber.empty())
            stream_id, sample_rate, decoded = subscriber.get(timeout=1.0)
            assert stream_id == STREAM_DRY
            assert sample_rate == 48000.0
            assert np.array_equal(decoded, samples)
        finally:
            client.close()
    finally:
        server.close()


def test_frames_are_discarded_when_nobody_is_subscribed():
    server = AudioRelayServer()
    try:
        client = socket.create_connection(("127.0.0.1", server.port), timeout=2.0)
        try:
            client.sendall(encode_frame(STREAM_DRY, 48000.0, np.zeros(4, dtype=np.float32)))
            time.sleep(0.05)
        finally:
            client.close()
    finally:
        server.close()  # must not hang/raise even though nobody ever subscribed


def test_unsubscribe_stops_further_delivery():
    server = AudioRelayServer()
    try:
        client = socket.create_connection(("127.0.0.1", server.port), timeout=2.0)
        try:
            subscriber = server.subscribe()
            server.unsubscribe(subscriber)
            client.sendall(encode_frame(STREAM_DRY, 48000.0, np.zeros(4, dtype=np.float32)))
            time.sleep(0.05)
            assert subscriber.empty()
        finally:
            client.close()
    finally:
        server.close()
