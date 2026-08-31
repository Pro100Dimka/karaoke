"""One coalescing hardware-command lane; no DB sessions cross thread boundaries."""

import logging
import threading
import time

_STREAM_STATISTICS = ("callback_frames", "callback_count", "glitch_count", "queue_frames",
                      "queue_capacity_frames", "queue_underruns", "queue_dropped_frames",
                      "queue_contentions", "queue_ms", "queue_capacity_ms", "queue_underruns_after_start",
                      "queue_wait_ms", "dsp_compute_ms")


class MonitorCancelled(RuntimeError):
    pass


class MonitorControl:
    def __init__(self, execution_lock=None):
        self.condition = threading.Condition(threading.RLock())
        self.execution = execution_lock if execution_lock is not None else threading.RLock()
        self.local = threading.local()
        self.token = threading.Event()
        self.pending = None
        self.live = None
        self.thread = None
        self.status = {"state": "idle", "fallback_count": 0, "glitch_fallback_count": 0}

    def _begin(self, state, details):
        self.token.set()
        self.token = threading.Event()
        self.live = None
        self.status = {
            "state": state, "fallback_count": 0, "glitch_fallback_count": 0,
            "requested_at": time.monotonic(), **details,
            "request_id": str(time.monotonic_ns()),
        }
        return self.token

    def submit(self, action, *, state="starting", **details):
        with self.condition:
            token = self._begin(state, details)
            self.pending = (token, action)
            self._wake()

    def update_live(self, action):
        with self.condition:
            # A change during startup is applied after the new stream is ready.
            self.live = (self.token, action)
            self._wake()

    def _wake(self):
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._run, name="monitor-control", daemon=True)
            self.thread.start()
        self.condition.notify_all()

    def cancel(self):
        with self.condition:
            self.token.set()
            self.pending = self.live = None
            self.status = {"state": "idle", "fallback_count": 0, "glitch_fallback_count": 0}

    def check(self):
        token = getattr(self.local, "token", None)
        if token is not None and token.is_set():
            raise MonitorCancelled("Monitoring request was superseded")

    def publish(self, token=None, **fields):
        token = token if token is not None else getattr(self.local, "token", None)
        with self.condition:
            if token is not None and (token is not self.token or token.is_set()):
                return
            self.status.update(fields)

    def snapshot(self):
        with self.condition:
            result = dict(self.status)
        started = result.pop("requested_at", None)
        if started is not None:
            result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        return result

    def event(self, token, message):
        with self.condition:
            if token is not None and (token is not self.token or token.is_set()):
                return
            event = message.get("event")
            if event == "level":
                for key in _STREAM_STATISTICS:
                    if key in message:
                        self.status[key] = message[key]
            if event == "started" and "buffer_size" in message:
                # Normalize the existing ASIO bridge protocol without changing
                # its command, callback, buffer selection or effects.
                message = {**message, "blocksize": message["buffer_size"], "mode": "ASIO",
                           "latency_source": "asio-driver-report"}
                rate = float(message.get("sample_rate") or 0)
                if rate > 0:
                    for kind in ("input", "output"):
                        if f"{kind}_latency" in message:
                            message[f"{kind}_latency_ms"] = round(float(message[f"{kind}_latency"]) * 1000 / rate, 2)
            if event in {"started", "fallback"}:
                for key in ("blocksize", "sample_rate", "mode", "engine", "driver", "latency", "latency_source", "input_latency_ms", "output_latency_ms"):
                    if key in message:
                        self.status[key] = message[key]
                if event == "started":
                    for key in _STREAM_STATISTICS:
                        self.status.pop(key, None)
                    self.status["state"] = "running"
                    started = self.status.get("requested_at")
                    if started is not None:
                        self.status["startup_ms"] = round((time.monotonic() - started) * 1000)
                else:
                    self.status["fallback_count"] = self.status.get("fallback_count", 0) + 1
                    self.status["fallback_reason"] = message.get("message")
                    if message.get("cause") == "glitches":
                        self.status["glitch_fallback_count"] = self.status.get("glitch_fallback_count", 0) + 1
            elif event == "error":
                self.status.update(state="error", error=message.get("message"))

    def run_sync(self, action, *, enabled=True):
        if getattr(self.local, "token", None) is not None:
            self.check()
            return action()
        with self.condition:
            token = self._begin("starting" if enabled else "stopping", {})
            self.pending = None
        try:
            return self._execute(token, action)
        except MonitorCancelled:
            raise
        except Exception as exc:
            self.publish(token, state="error", error=str(exc))
            raise

    def _execute(self, token, action):
        with self.execution:
            self.local.token = token
            try:
                self.check()
                return action()
            finally:
                del self.local.token

    def _run(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.pending is not None or self.live is not None)
                if self.pending is not None:
                    token, action = self.pending
                    self.pending = None
                else:
                    token, action = self.live
                    self.live = None
            try:
                self._execute(token, action)
            except MonitorCancelled:
                pass
            except Exception as exc:
                self.publish(token, state="error", error=str(exc))
                logging.getLogger(__name__).exception("Background audio monitoring failed")
