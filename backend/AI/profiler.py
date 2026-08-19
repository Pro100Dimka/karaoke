from __future__ import annotations

import os
import platform
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ResourceSnapshot:
    wall_time: float
    rss_mb: float | None
    cuda_allocated_mb: float | None
    cuda_reserved_mb: float | None
    warnings: tuple[str, ...] = ()


@dataclass(slots=True)
class OperationMetric:
    count: int = 0
    elapsed_sec: float = 0.0
    bytes: int = 0


def _torch_memory() -> tuple[float | None, float | None, list[str]]:
    warnings: list[str] = []
    try:
        import torch

        if torch.cuda.is_available():
            scale = 1024 * 1024
            return (
                torch.cuda.memory_allocated() / scale,
                torch.cuda.memory_reserved() / scale,
                warnings,
            )
    except ImportError:
        warnings.append("torch is not installed")
    except RuntimeError as exc:
        warnings.append(f"Unable to read CUDA memory: {exc}")
    return None, None, warnings


def snapshot() -> ResourceSnapshot:
    warnings: list[str] = []
    rss = None
    try:
        import psutil

        rss = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
    except ImportError:
        warnings.append("psutil is not installed")
    except OSError as exc:
        warnings.append(f"Unable to read process memory: {exc}")
    allocated, reserved, cuda_warnings = _torch_memory()
    warnings.extend(cuda_warnings)
    return ResourceSnapshot(
        wall_time=time.perf_counter(),
        rss_mb=rss,
        cuda_allocated_mb=allocated,
        cuda_reserved_mb=reserved,
        warnings=tuple(warnings),
    )


def delta(start: ResourceSnapshot, end: ResourceSnapshot) -> dict[str, Any]: return {'elapsed_sec': max(0.0, end.wall_time - start.wall_time), 'rss_mb': end.rss_mb, 'cuda_allocated_mb': end.cuda_allocated_mb, 'cuda_reserved_mb': end.cuda_reserved_mb, 'warnings': list(dict.fromkeys((*start.warnings, *end.warnings)))}


def environment_info() -> dict[str, object]:
    info: dict[str, object] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
    }
    try:
        import psutil

        info.update(
            {
                "cpu_logical": psutil.cpu_count(logical=True),
                "cpu_physical": psutil.cpu_count(logical=False),
                "ram_mb": round(psutil.virtual_memory().total / 1024 / 1024),
            }
        )
    except (ImportError, OSError, AttributeError):
        pass
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda_available"] = bool(torch.cuda.is_available())
        info["torch_cuda"] = getattr(torch.version, "cuda", None)
        if torch.cuda.is_available():
            info["gpu"] = torch.cuda.get_device_name(0)
            properties = torch.cuda.get_device_properties(0)
            info["vram_mb"] = round(properties.total_memory / 1024 / 1024)
            capability = getattr(torch.cuda, "get_device_capability", lambda _index: None)(0)
            if capability is not None: info["gpu_compute_capability"] = list(capability)
    except ImportError as exc:
        info["cuda_available"] = False
        info["torch_error"] = str(exc)
    except RuntimeError as exc:
        info["cuda_available"] = False
        info["torch_error"] = str(exc)
    return info


class RuntimeTelemetry:

    def __init__(self, sample_interval: float = 0.2):
        self.sample_interval = max(0.05, float(sample_interval))
        self.started_at = time.perf_counter()
        self.finished_at: float | None = None
        self.operations: defaultdict[str, OperationMetric] = defaultdict(OperationMetric)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._token = None
        self._peak_rss_bytes = 0
        self._peak_cuda_allocated_mb = 0.0
        self._peak_cuda_reserved_mb = 0.0
        self._warnings: list[str] = []
        self._cpu_start: dict[int, float] = {}
        self._cpu_latest: dict[int, float] = {}
        self._io_start: dict[int, tuple[int, int, int, int]] = {}
        self._io_latest: dict[int, tuple[int, int, int, int]] = {}

    def _process_family(self):
        try:
            import psutil

            parent = psutil.Process(os.getpid())
            return [parent, *parent.children(recursive=True)]
        except (ImportError, OSError, RuntimeError):
            return []

    @staticmethod
    def _process_sample(process):
        cpu, io = process.cpu_times(), process.io_counters()
        return (
            process.memory_info().rss,
            cpu.user + cpu.system,
            (io.read_bytes, io.write_bytes, io.read_count, io.write_count),
        )

    def _sample(self, *, initial: bool = False) -> None:
        rss = 0
        for process in self._process_family():
            try:
                memory, cpu, io = self._process_sample(process)
            except Exception:  # A process can disappear between enumeration and sampling.
                continue
            pid = process.pid
            rss += memory
            if initial or pid not in self._cpu_start:
                self._cpu_start[pid] = cpu
                self._io_start[pid] = io
            self._cpu_latest[pid] = max(cpu, self._cpu_latest.get(pid, cpu))
            previous = self._io_latest.get(pid, io)
            self._io_latest[pid] = tuple(
                max(left, right) for left, right in zip(previous, io, strict=True)
            )
        self._peak_rss_bytes = max(self._peak_rss_bytes, rss)
        allocated, reserved, warnings = _torch_memory()
        if allocated is not None: self._peak_cuda_allocated_mb = max(self._peak_cuda_allocated_mb, allocated)
        if reserved is not None: self._peak_cuda_reserved_mb = max(self._peak_cuda_reserved_mb, reserved)
        self._warnings.extend(warnings)

    def _sample_loop(self) -> None:
        while not self._stop.wait(self.sample_interval): self._sample()

    def start(self) -> RuntimeTelemetry:
        if self._thread is not None: return self
        self.started_at = time.perf_counter()
        self._sample(initial=True)
        self._token = _ACTIVE_TELEMETRY.set(self)
        self._thread = threading.Thread(
            target=self._sample_loop,
            name="ai-runtime-profiler",
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self) -> None:
        if self.finished_at is not None: return
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread(): self._thread.join(timeout=max(1.0, self.sample_interval * 3))
        self._sample()
        self.finished_at = time.perf_counter()
        if self._token is not None:
            _ACTIVE_TELEMETRY.reset(self._token)
            self._token = None

    def __enter__(self) -> RuntimeTelemetry: return self.start()

    def __exit__(self, *_args) -> None: self.stop()

    def record(
        self,
        name: str,
        *,
        count: int = 1,
        elapsed_sec: float = 0.0,
        byte_count: int = 0,
    ) -> None:
        with self._lock:
            metric = self.operations[name]
            metric.count += int(count)
            metric.elapsed_sec += max(0.0, float(elapsed_sec))
            metric.bytes += max(0, int(byte_count))

    @contextmanager
    def operation(self, name: str, *, byte_count: int = 0):
        started = time.perf_counter()
        try:
            yield
        finally:
            self.record(
                name,
                elapsed_sec=time.perf_counter() - started,
                byte_count=byte_count,
            )

    def result(self, reports=()) -> dict[str, object]:
        ended = self.finished_at or time.perf_counter()
        elapsed, cpu_seconds, io_delta, logical_cpus = max(0.0, ended - self.started_at), sum((value - self._cpu_start.get(pid, 0.0) for pid, value in self._cpu_latest.items())), [tuple((value - self._io_start.get(pid, (0, 0, 0, 0))[index] for index, value in enumerate(values))) for pid, values in self._io_latest.items()], os.cpu_count() or 1
        return {
            "elapsed_sec": elapsed,
            "stages": [asdict(report) for report in reports],
            "operations": {
                name: asdict(metric) for name, metric in sorted(self.operations.items())
            },
            "resources": {
                "peak_rss_mb": self._peak_rss_bytes / 1024 / 1024,
                "peak_cuda_allocated_mb": self._peak_cuda_allocated_mb or None,
                "peak_cuda_reserved_mb": self._peak_cuda_reserved_mb or None,
                "cpu_seconds": cpu_seconds,
                "cpu_average_percent_of_machine": (
                    100.0 * cpu_seconds / elapsed / logical_cpus if elapsed else 0.0
                ),
                "io_read_bytes": sum(item[0] for item in io_delta),
                "io_write_bytes": sum(item[1] for item in io_delta),
                "io_read_operations": sum(item[2] for item in io_delta),
                "io_write_operations": sum(item[3] for item in io_delta),
                "gpu_utilization_percent": None,
                "warnings": list(dict.fromkeys(self._warnings)),
            },
        }


_ACTIVE_TELEMETRY: ContextVar[RuntimeTelemetry | None] = ContextVar(
    "ai_runtime_telemetry", default=None
)


def current_telemetry() -> RuntimeTelemetry | None: return _ACTIVE_TELEMETRY.get()


def record_operation(
    name: str,
    *,
    count: int = 1,
    elapsed_sec: float = 0.0,
    byte_count: int = 0,
) -> None:
    if (telemetry := current_telemetry()) is not None:
        telemetry.record(
            name,
            count=count,
            elapsed_sec=elapsed_sec,
            byte_count=byte_count,
        )


@contextmanager
def profile_operation(name: str, *, byte_count: int = 0):
    telemetry = current_telemetry()
    if telemetry is None:
        yield
        return
    with telemetry.operation(name, byte_count=byte_count): yield
