"""Wire format shared between monitor_worker.py (sender, child process) and
audio_relay.py (receiver, main process) for relaying processed monitor audio
to the browser. Deliberately separate from the existing stdin/stdout JSON
control channel (audio_service._launch_monitor_process opens that pipe in
text mode for command/status JSON lines; it cannot carry binary PCM).
"""

from __future__ import annotations

import struct

import numpy as np

STREAM_DRY = 0
STREAM_WET = 1

# stream_id (0=dry, 1=wet), sample_rate, sample_count -- followed by
# sample_count * 4 bytes of little-endian float32 PCM.
_HEADER = struct.Struct("<BfI")


def encode_frame(stream_id: int, sample_rate: float, samples: np.ndarray) -> bytes:
    payload = np.asarray(samples, dtype="<f4").tobytes()
    header = _HEADER.pack(int(stream_id), float(sample_rate), len(samples))
    return header + payload


class FrameReader:
    """Incrementally reassembles encode_frame() messages from a byte stream."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> None:
        self._buffer.extend(chunk)

    def pop_frames(self) -> list[tuple[int, float, np.ndarray]]:
        frames = []
        while len(self._buffer) >= _HEADER.size:
            stream_id, sample_rate, sample_count = _HEADER.unpack_from(self._buffer, 0)
            total = _HEADER.size + sample_count * 4
            if len(self._buffer) < total:
                break
            payload = bytes(self._buffer[_HEADER.size : total])
            samples = np.frombuffer(payload, dtype="<f4")
            frames.append((stream_id, sample_rate, samples))
            del self._buffer[:total]
        return frames
