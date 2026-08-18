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
import threading
import time

import numpy as np

try:
    import sounddevice as sd
except Exception:  # PortAudio may be unavailable in CI/diagnostics.
    from types import SimpleNamespace
    sd = SimpleNamespace(Stream=None, WasapiSettings=lambda **kwargs: kwargs)

from app.services.microphone_quality import MonitorEffectsChain, StudioMicrophoneProcessor

_running = True
_level = {"rms_db": -120.0, "clipping": False, "silent": True}
_live_lock = threading.Lock()
_live_params = {"reverb": 0.0, "echo": 0.0, "delay": 0.0}


def _stream_candidates(options: dict) -> list[dict]:
    """Prefer the requested low latency, then relax only what the driver rejects."""
    base = {
        "samplerate": float(options["sample_rate"]),
        "channels": (1, int(options["output_channels"])),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
        "latency": "low",
    }
    blocks = dict.fromkeys((int(options["blocksize"]), 128, 256, 0))
    candidates = []
    modes = ("exclusive", "shared", "plain") if options.get("wasapi_exclusive") else ("plain",)
    for mode in modes:
        for blocksize in blocks:
            candidate = {**base, "blocksize": blocksize}
            if mode == "exclusive":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(exclusive=True),
                    sd.WasapiSettings(exclusive=True),
                )
            elif mode == "shared":
                # Shared WASAPI can transparently reconcile endpoint formats;
                # this is the reliable fallback for Bluetooth and mixed-rate
                # microphone/headphone pairs.
                candidate["extra_settings"] = (
                    sd.WasapiSettings(auto_convert=True),
                    sd.WasapiSettings(auto_convert=True),
                )
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates


def _emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


def _stop(_signum: int, _frame: object) -> None:
    global _running
    _running = False


def _read_live_updates() -> None:
    """Apply reverb/echo/delay changes pushed over stdin without restarting the stream.

    Reverb/echo/delay used to be in the parent's restart-field set, so every
    knob nudge tore down and reopened the native audio stream -- slow, and on
    a burst of drag events (rapid stdin patches from the settings API) prone
    to losing the race for the device and going silent. Reading live updates
    here instead lets the already-open stream just change its effect mix.
    """
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                update = json.loads(line)
            except json.JSONDecodeError:
                continue
            with _live_lock:
                for key in ("reverb", "echo", "delay"):
                    if key in update:
                        _live_params[key] = float(update[key])
    except Exception:
        return


def _audio_callback(gain: float, restart_requested: threading.Event, glitches: list[float], sample_rate: float = 48_000):
    quality = StudioMicrophoneProcessor(sample_rate, 1)
    effects = MonitorEffectsChain(sample_rate)
    def callback(indata, outdata, _frames, _time_info, status):
        if status:
            now = time.monotonic()
            glitches.append(now)
            while glitches and glitches[0] < now - 2.0:
                glitches.pop(0)
            if len(glitches) >= 3:
                restart_requested.set()
        with _live_lock:
            reverb, echo, delay = _live_params["reverb"], _live_params["echo"], _live_params["delay"]
        processed = quality.process(indata[:, :1], gain)[:, 0]
        processed = effects.process(processed, reverb, echo, delay)
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

    return callback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    options = json.loads(parser.parse_args().config)
    gain = float(options["gain"])
    with _live_lock:
        _live_params["reverb"] = float(options.get("reverb", 0.0))
        _live_params["echo"] = float(options.get("echo", 0.0))
        _live_params["delay"] = float(options.get("delay", 0.0))
    threading.Thread(target=_read_live_updates, daemon=True).start()

    restart_requested = threading.Event()
    glitches: list[float] = []
    callback = _audio_callback(gain, restart_requested, glitches, float(options["sample_rate"]))

    stream = None
    try:
        failures: list[str] = []
        candidates = _stream_candidates(options)
        for candidate_index, candidate in enumerate(candidates):
            try:
                stream = sd.Stream(**candidate, callback=callback)
                stream.start()
                if failures or candidate_index:
                    _emit(
                        {
                            "event": "fallback",
                            "message": failures[-1] if failures else "Audio glitches detected",
                            "blocksize": candidate["blocksize"],
                            "exclusive": "extra_settings" in candidate,
                        }
                    )
                _emit(
                    {
                        "event": "started",
                        "blocksize": candidate["blocksize"],
                        "exclusive": "extra_settings" in candidate,
                    }
                )
                restart_requested.clear()
                glitches.clear()
                while _running and not restart_requested.wait(0.1):
                    _emit({"event": "level", **_level})
                stream.abort()
                stream.close()
                stream = None
                if not _running:
                    break
            except Exception as error:
                failures.append(str(error))
                if stream is not None:
                    try:
                        stream.abort()
                        stream.close()
                    except Exception:
                        pass
                    stream = None
        if _running:
            raise RuntimeError(failures[-1] if failures else "No audio stream candidate")
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
