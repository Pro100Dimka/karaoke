"""Serialize device ownership changes, never audio callbacks or file encoding."""

import asyncio
import concurrent.futures
import threading
from functools import wraps

hardware_lock = threading.RLock()

# ASIO drivers are COM-based and bind specifically to the process's main
# thread the first time they're loaded; opening a stream on the same driver
# from any other thread later fails with a generic PortAudio host error
# ("Failed to load ASIO driver") even though the device and parameters are
# fine. uvicorn runs the asyncio event loop on the main thread by default,
# but FastAPI dispatches sync route handlers onto a separate worker
# threadpool -- so every direct PortAudio stream open in this process
# (recording capture, the mic level-check probe) must be marshaled back onto
# the main/event-loop thread via this helper instead of running on whichever
# worker thread happened to handle the request.
_main_loop: asyncio.AbstractEventLoop | None = None


def bind_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def run_on_audio_thread(action, *args, **kwargs):
    loop = _main_loop
    if loop is None or loop.is_closed() or threading.current_thread() is threading.main_thread():
        return action(*args, **kwargs)
    future: concurrent.futures.Future = concurrent.futures.Future()

    def invoke() -> None:
        try:
            future.set_result(action(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 - propagated to the caller via the future
            future.set_exception(exc)

    loop.call_soon_threadsafe(invoke)
    return future.result()


def serialized(action):
    @wraps(action)
    def run(*args, **kwargs):
        with hardware_lock:
            return action(*args, **kwargs)
    return run
