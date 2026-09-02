"""Serialize device ownership changes, never audio callbacks or file encoding."""

import threading
from concurrent.futures import ThreadPoolExecutor
from functools import wraps

hardware_lock = threading.RLock()

# ASIO drivers are COM-based and bind to whichever thread first loads them;
# opening a stream on the same driver from a different thread later fails
# with a generic PortAudio host error ("Failed to load ASIO driver") even
# though the device and parameters are fine. FastAPI dispatches sync route
# handlers onto a rotating threadpool, so every direct PortAudio stream open
# in this process (recording capture, the mic level-check probe) must be
# funneled through this one dedicated thread instead of whichever worker
# thread happened to handle the request.
_audio_thread_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="audio-stream")


def run_on_audio_thread(action, *args, **kwargs):
    return _audio_thread_pool.submit(action, *args, **kwargs).result()


def serialized(action):
    @wraps(action)
    def run(*args, **kwargs):
        with hardware_lock:
            return action(*args, **kwargs)
    return run
