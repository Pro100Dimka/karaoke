"""Isolated PortAudio direct-monitor worker.

PortAudio drivers are native code.  A faulty device/driver must never be able
to take down the FastAPI process, so the microphone monitor deliberately runs
in its own short-lived process.  It writes newline-delimited JSON telemetry to
stdout; the API process owns lifecycle and exposes the last known level.
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time

import numpy as np
import sounddevice as sd

_running = True
_level = {"rms_db": -120.0, "clipping": False, "silent": True}


def _emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


def _stop(_signum: int, _frame: object) -> None:
    global _running
    _running = False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    options = json.loads(parser.parse_args().config)
    gain = float(options["gain"])
    output_channels = int(options["output_channels"])

    def callback(indata, outdata, _frames, _time_info, _status):
        processed = np.clip(indata[:, 0] * gain, -1.0, 1.0)
        outdata.fill(0)
        for channel in range(outdata.shape[1]):
            outdata[:, channel] = processed
        rms = float(np.sqrt(np.mean(np.square(processed)))) if len(processed) else 0.0
        peak = float(np.max(np.abs(processed))) if len(processed) else 0.0
        _level.update(
            {
                "rms_db": round(20 * np.log10(rms) if rms > 0 else -120.0, 1),
                "clipping": peak >= 0.99,
                "silent": rms < 10 ** (-50 / 20),
            }
        )

    stream_options = {
        "samplerate": float(options["sample_rate"]),
        "channels": (1, output_channels),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
        "blocksize": int(options["blocksize"]),
        "latency": "low",
        "callback": callback,
    }
    if options.get("wasapi_exclusive"):
        stream_options["extra_settings"] = (
            sd.WasapiSettings(exclusive=True),
            sd.WasapiSettings(exclusive=True),
        )

    stream = None
    try:
        try:
            stream = sd.Stream(**stream_options)
        except Exception as exclusive_error:
            if not options.get("wasapi_exclusive"):
                raise
            # Some USB drivers reject WASAPI exclusive while another program
            # has the device open.  Shared low-latency mode is still useful.
            stream_options.pop("extra_settings", None)
            stream = sd.Stream(**stream_options)
            _emit({"event": "fallback", "message": str(exclusive_error)})
        stream.start()
        _emit({"event": "started"})
        while _running:
            _emit({"event": "level", **_level})
            time.sleep(0.1)
    except Exception as exc:  # The parent converts this into a friendly API error.
        _emit({"event": "error", "message": str(exc)})
        return 1
    finally:
        if stream is not None:
            try:
                stream.abort()
                stream.close()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _stop)
    sys.exit(main())
