"""Best-effort sender for processed monitor audio, used by monitor_worker.py.

push() is called from the realtime PortAudio/WASAPI callback thread and must
never block or perform network I/O itself -- samples are copied into a small
preallocated per-stream accumulator, and only a fully accumulated chunk
(~15ms) is ever handed off, as an already-encoded bytes object, to a bounded
queue. All actual socket I/O (including the initial connect) runs on a
separate thread, so a slow or unavailable relay server can never add latency
to the audio callback or to monitor_worker.py's startup sequence.
"""

from __future__ import annotations

import contextlib
import queue
import socket
import threading

import numpy as np

from .audio_relay_protocol import encode_frame

_CHUNK_SECONDS = 0.015
_QUEUE_MAXSIZE = 8


class _StreamAccumulator:
    __slots__ = ("buffer", "position")

    def __init__(self, size: int) -> None:
        self.buffer = np.empty(size, dtype=np.float32)
        self.position = 0


class RelayLink:
    def __init__(self, port: int, sample_rate: float, connect_timeout: float = 1.0) -> None:
        self._queue: queue.Queue[bytes | None] = queue.Queue(maxsize=_QUEUE_MAXSIZE)
        self._chunk_samples = max(1, round(sample_rate * _CHUNK_SECONDS))
        self._accumulators: dict[int, _StreamAccumulator] = {}
        self._closed = False
        self._socket: socket.socket | None = None
        self._connect_timeout = connect_timeout
        threading.Thread(target=self._connect_and_run, args=(port,), daemon=True).start()

    @property
    def connected(self) -> bool:
        return self._socket is not None

    def push(self, stream_id: int, sample_rate: float, samples: np.ndarray) -> None:
        if self._socket is None or self._closed:
            return
        accumulator = self._accumulators.get(stream_id)
        if accumulator is None:
            accumulator = _StreamAccumulator(self._chunk_samples)
            self._accumulators[stream_id] = accumulator
        source = np.asarray(samples, dtype=np.float32)
        offset, remaining = 0, len(source)
        while remaining:
            space = len(accumulator.buffer) - accumulator.position
            take = min(space, remaining)
            accumulator.buffer[accumulator.position : accumulator.position + take] = source[
                offset : offset + take
            ]
            accumulator.position += take
            offset += take
            remaining -= take
            if accumulator.position >= len(accumulator.buffer):
                self._enqueue(encode_frame(stream_id, sample_rate, accumulator.buffer))
                accumulator.position = 0

    def _enqueue(self, payload: bytes) -> None:
        try:
            self._queue.put_nowait(payload)
        except queue.Full:
            with contextlib.suppress(queue.Empty):
                self._queue.get_nowait()
            with contextlib.suppress(queue.Full):
                self._queue.put_nowait(payload)

    def _connect_and_run(self, port: int) -> None:
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=self._connect_timeout)
        except OSError:
            return
        sock.settimeout(None)
        if self._closed:
            with contextlib.suppress(OSError):
                sock.close()
            return
        self._socket = sock
        while True:
            item = self._queue.get()
            if item is None:
                return
            try:
                sock.sendall(item)
            except OSError:
                return

    def close(self) -> None:
        self._closed = True
        with contextlib.suppress(queue.Full):
            self._queue.put_nowait(None)
        if self._socket is not None:
            with contextlib.suppress(OSError):
                self._socket.close()
