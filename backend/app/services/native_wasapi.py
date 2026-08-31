"""Event-driven shared I/O. All COM calls stay on the monitor worker's thread."""
import ctypes as ct
from pathlib import Path
import sys

import numpy as np

import config


class Info(ct.Structure):
    _fields_ = [(name, ct.c_uint32) for name in (
        "sample_rate", "output_sample_rate", "blocksize", "input_period", "output_period", "input_buffer", "output_buffer"
    )] + [(name, ct.c_double) for name in ("input_latency_ms", "output_latency_ms")]


class Statistics(ct.Structure):
    _fields_ = [(name, ct.c_uint64) for name in (
        "captured_frames", "rendered_frames", "dropped_frames", "underruns", "discontinuities", "queued_frames"
    )] + [("stream_latency_ms", ct.c_double)]


Process = ct.CFUNCTYPE(ct.c_int, ct.POINTER(ct.c_float), ct.POINTER(ct.c_float), ct.c_uint32)


def library_path():
    return (Path(sys.executable).parent if config.IS_FROZEN else Path(config.PROJECT_ROOT) / "generated/build/asio") / "KaraokeWasapi.dll"


def load_library():
    path = library_path()
    if not path.is_file():
        raise RuntimeError("Native WASAPI library is missing; rebuild the native audio components")
    dll = ct.CDLL(str(path))
    opening = [ct.c_wchar_p, ct.c_wchar_p, ct.c_uint32, ct.POINTER(Info), ct.c_char_p, ct.c_uint32]
    dll.wm_open.argtypes, dll.wm_open.restype = opening, ct.c_void_p
    dll.wm_probe.argtypes, dll.wm_probe.restype = opening, ct.c_int
    dll.wm_start.argtypes, dll.wm_start.restype = [ct.c_void_p, Process, ct.c_char_p, ct.c_uint32], ct.c_int
    dll.wm_pump.argtypes, dll.wm_pump.restype = [ct.c_void_p, ct.c_uint32, ct.POINTER(Statistics), ct.c_char_p, ct.c_uint32], ct.c_int
    dll.wm_close.argtypes, dll.wm_close.restype = [ct.c_void_p], None
    return dll


class NativeWasapiStream:
    def __init__(self, options, statistics):
        self.dll = load_library()
        self.info, self.stats = Info(), Statistics()
        self.error = ct.create_string_buffer(1024)
        self.statistics, self.callback = statistics, None
        # Empty names are allowed only for an explicitly requested system default.
        # Production supplies both resolved names; the DLL rejects ambiguity.
        self.handle = self.dll.wm_open(options["input_device_name"], options["output_device_name"],
                                       options["blocksize"], ct.byref(self.info), self.error, len(self.error))
        self._check(self.handle)

    def _check(self, success):
        if not success:
            raise RuntimeError(self.error.value.decode("utf-8", errors="replace") or "Native WASAPI failed")

    def start(self, callback):
        def process(source, output, frames):
            try:
                callback(np.ctypeslib.as_array(source, shape=(frames, 1)),
                         np.ctypeslib.as_array(output, shape=(frames, 1)), frames, None, None)
                return 1
            except Exception as error:
                self.statistics["callback_error"] = str(error)
                return 0
        self.callback = Process(process)
        self._check(self.dll.wm_start(self.handle, self.callback, self.error, len(self.error)))

    def pump(self):
        self._check(self.dll.wm_pump(self.handle, 20, ct.byref(self.stats), self.error, len(self.error)))
        self.statistics.update(
            glitch_count=self.stats.discontinuities,
            queue_underruns=self.stats.underruns,
            queue_dropped_frames=self.stats.dropped_frames,
            queue_ms=round(self.stats.queued_frames * 1000 / self.info.sample_rate, 3),
            captured_frames=self.stats.captured_frames, rendered_frames=self.stats.rendered_frames,
            stream_latency_ms=round(self.stats.stream_latency_ms, 3) if self.stats.stream_latency_ms > 0 else None,
        )

    def diagnostics(self):
        return {
            "engine": "wasapi-native-shared", "host_api": "Windows WASAPI", "mode": "shared", "exclusive": False,
            "blocksize": self.info.blocksize, "sample_rate": self.info.sample_rate,
            "output_sample_rate": self.info.output_sample_rate,
            "input_period_frames": self.info.input_period, "output_period_frames": self.info.output_period,
            "input_latency_ms": self.info.input_latency_ms if self.info.input_latency_ms > 0 else None,
            "output_latency_ms": self.info.output_latency_ms if self.info.output_latency_ms > 0 else None,
            "latency_source": "wasapi-stream-report",
        }

    def close(self):
        if self.handle:
            self.dll.wm_close(self.handle)
            self.handle = None
            self.callback = None

    abort = close
