"""Serialize device ownership changes, never audio callbacks or file encoding."""

import threading
from functools import wraps

hardware_lock = threading.RLock()


def serialized(action):
    @wraps(action)
    def run(*args, **kwargs):
        with hardware_lock:
            return action(*args, **kwargs)
    return run
