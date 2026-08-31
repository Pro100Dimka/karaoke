"""Separate WASAPI endpoints with a bounded, non-blocking monitoring queue.

PortAudio forces a duplex Stream into polling mode and sizes its output from
the capture buffer. Separate exclusive endpoints can use event-driven buffers.
This adapter is only for local monitoring, never recording or network audio.
"""

from collections import deque
import time

import numpy as np


class MonitorQueue:
    def __init__(self, blocksize, channels, max_blocks=4):
        # CPython deque append/popleft are atomic. Each callback owns its block
        # until it returns it to the pool; no lock spans a NumPy copy (which can
        # release the GIL). Neither callback waits for the other audio thread.
        self.blocksize = blocksize
        self.capacity = blocksize * max_blocks
        self.max_blocks = max_blocks
        self.ready = deque()
        self.free = deque(np.empty((blocksize, channels), dtype=np.float32)
                          for _ in range(max_blocks + 2))
        self.dropped_frames = self.underruns = self.contentions = 0

    @property
    def size(self):
        return len(self.ready) * self.blocksize

    def push(self, samples):
        try:
            block = self.free.popleft()
        except IndexError:
            self.contentions += 1
            self.dropped_frames += len(samples)
            return
        np.copyto(block, samples)
        if len(self.ready) >= self.max_blocks:
            try:
                self.free.append(self.ready.popleft())
                self.dropped_frames += self.blocksize
            except IndexError:
                pass  # The render callback consumed it first.
        self.ready.append(block)

    def pop(self, output):
        try:
            block = self.ready.popleft()
        except IndexError:
            output.fill(0)
            self.underruns += 1
            return False
        try:
            np.copyto(output, block)
            return True
        finally:
            self.free.append(block)


class WasapiMonitorStream:
    def __init__(self, sd, candidate, callback, statistics, restart_requested):
        rate = float(candidate["samplerate"])
        blocksize = int(candidate["blocksize"])
        if blocksize <= 0:
            raise ValueError("Split WASAPI monitoring requires a fixed callback size")
        self.queue = MonitorQueue(blocksize, candidate["channels"][1])
        self.input = self.output = None
        self.statistics = statistics
        self.rate = rate
        self.started_at = None
        self.failures = []
        self.last_dropped = 0
        work = np.zeros((blocksize, candidate["channels"][1]), dtype=np.float32)

        def capture(indata, frames, clocks, status):
            # Fixed callbacks avoid allocation in the realtime path. Fail closed
            # if a driver violates the requested size instead of repeating audio.
            if frames != blocksize:
                restart_requested.set()
                return
            try:
                callback(indata, work, frames, clocks, status)
                self.queue.push(work)
            except Exception:
                # PortAudio otherwise swallows callback errors and can leave the
                # parent reporting a running stream with no microphone audio.
                restart_requested.set()

        def render(outdata, frames, clocks, status):
            if frames != blocksize:
                outdata.fill(0)
                restart_requested.set()
                return
            complete = self.queue.pop(outdata)
            now = time.monotonic()
            dropped = self.queue.dropped_frames != self.last_dropped
            self.last_dropped = self.queue.dropped_frames
            if status:
                statistics["glitch_count"] = statistics.get("glitch_count", 0) + 1
            if self.started_at is not None and now - self.started_at > .3 and (status or not complete or dropped):
                self.failures.append(now)
                while self.failures and self.failures[0] < now - 5:
                    self.failures.pop(0)
                if len(self.failures) >= 12:
                    restart_requested.set()
            statistics.update(
                queue_frames=self.queue.size,
                queue_capacity_frames=self.queue.capacity,
                queue_underruns=self.queue.underruns,
                queue_dropped_frames=self.queue.dropped_frames,
                queue_contentions=self.queue.contentions,
                queue_ms=round(self.queue.size * 1000 / rate, 2),
                queue_capacity_ms=round(self.queue.capacity * 1000 / rate, 2),
            )

        common = {key: value for key, value in candidate.items()
                  if key not in {"channels", "device", "extra_settings"}}
        try:
            self.input = sd.InputStream(**common, device=candidate["device"][0],
                                        channels=candidate["channels"][0],
                                        extra_settings=candidate["extra_settings"][0], callback=capture)
            self.output = sd.OutputStream(**common, device=candidate["device"][1],
                                          channels=candidate["channels"][1],
                                          extra_settings=candidate["extra_settings"][1], callback=render)
        except BaseException:
            self.close()
            raise

    @property
    def latency(self):
        return self.input.latency, self.output.latency

    def start(self):
        self.started_at = time.monotonic()
        try:
            self.input.start()
            self.output.start()
        except BaseException:
            self.abort()
            raise

    def abort(self):
        self._both("abort")

    def close(self):
        self._both("close")

    def _both(self, method):
        for stream in (self.output, self.input):
            if stream is not None:
                try:
                    getattr(stream, method)()
                except Exception:
                    pass
