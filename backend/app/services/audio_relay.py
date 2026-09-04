"""Loopback TCP server that receives processed monitor audio from
monitor_worker.py's RelayLink and fans it out to subscribers (a WebSocket
route serving the browser). Purely additive: with no subscribers, incoming
frames are read and discarded -- draining the socket is still required so
the worker's writer thread never stalls on a full send buffer.
"""

from __future__ import annotations

import contextlib
import queue
import socket
import threading

from .audio_relay_protocol import FrameReader

# A whole undecoded encode_frame() message: this server is a pure byte relay
# between monitor_worker.py's RelayLink and the WebSocket route, so there is
# nothing to decode a frame INTO here -- see FrameReader.pop_raw_frames.
Frame = bytes


class AudioRelayServer:
    def __init__(self) -> None:
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(1)
        self.port: int = self._server.getsockname()[1]
        self._subscribers: list[queue.Queue[Frame]] = []
        self._lock = threading.Lock()
        self._closed = False
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def subscribe(self, maxsize: int = 32) -> "queue.Queue[Frame]":
        subscriber: queue.Queue[Frame] = queue.Queue(maxsize=maxsize)
        with self._lock:
            self._subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: "queue.Queue[Frame]") -> None:
        with self._lock:
            if subscriber in self._subscribers:
                self._subscribers.remove(subscriber)

    def _accept_loop(self) -> None:
        self._server.settimeout(1.0)
        client = None
        while not self._closed and client is None:
            try:
                client, _ = self._server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
        if client is None:
            return
        client.settimeout(None)
        reader = FrameReader()
        try:
            while not self._closed:
                chunk = client.recv(65536)
                if not chunk:
                    break
                reader.feed(chunk)
                for frame in reader.pop_raw_frames():
                    self._dispatch(frame)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                client.close()

    def _dispatch(self, frame: Frame) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(frame)
            except queue.Full:
                with contextlib.suppress(queue.Empty):
                    subscriber.get_nowait()
                with contextlib.suppress(queue.Full):
                    subscriber.put_nowait(frame)

    def close(self) -> None:
        self._closed = True
        with contextlib.suppress(OSError):
            self._server.close()
        self._thread.join(timeout=2.0)
