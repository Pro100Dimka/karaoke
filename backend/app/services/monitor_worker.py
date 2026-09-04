
from __future__ import annotations

import argparse
import contextlib
import json
import signal
import sys
import threading
import time
from typing import Any


def _stage(name: str) -> None:
    print(json.dumps({"event": "stage", "stage": name}), flush=True)


if __name__ == "__main__":
    _stage("import numpy")
import numpy as np  # noqa: E402 - startup stage telemetry must precede this costly import

if __name__ == "__main__":
    _stage("import sounddevice / initialize PortAudio")
try:
    import sounddevice as sd
except Exception:  # PortAudio may be unavailable in CI/diagnostics.
    from types import SimpleNamespace
    sd = SimpleNamespace(Stream=None, WasapiSettings=lambda **kwargs: kwargs)

if __name__ == "__main__":
    _stage("import microphone DSP")
from app.services.audio_relay_protocol import STREAM_DRY, STREAM_WET  # noqa: E402
from app.services.microphone_quality import (  # noqa: E402 - staged worker startup
    MonitorEffectsChain,
    RealtimePitchShifter,
    StudioMicrophoneProcessor,
)
from app.services.monitor_relay_link import RelayLink  # noqa: E402
from app.services.wasapi_monitor_stream import WasapiMonitorStream  # noqa: E402

_running = True
_level = {"rms_db": -120.0, "clipping": False, "silent": True}
_live_lock = threading.Lock()
_live_params = {"reverb": 0.0, "echo": 0.0, "delay": 0.0, "noise_suppression": 0.35, "octave": 0.0}


def _stream_candidates(options: dict) -> list[dict]:
    """No buffer or rate fallback. The only fallback is mode: an explicitly
    requested exclusive-mode attempt (PortAudio-negotiated, see WasapiSettings
    below) is tried first and, on any failure to open it, main() falls back
    to the same shared/plain configuration used when exclusive was never
    requested at all -- never a hard error just because exclusive failed.
    """
    rate = float(options["sample_rate"])
    blocksize = int(options["blocksize"])
    if blocksize <= 0:
        raise ValueError("A fixed positive monitoring buffer is required")
    mode = options.get("wasapi_mode", "shared")
    if mode not in {"shared", "plain"}:
        raise ValueError("Unsupported WASAPI mode")
    fallback = {
        "samplerate": rate, "blocksize": blocksize, "latency": blocksize / rate,
        "channels": (1, int(options["output_channels"])),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
        "_mode": mode,
    }
    if mode != "plain":
        fallback["extra_settings"] = (
            sd.WasapiSettings(exclusive=False, auto_convert=True),
            sd.WasapiSettings(exclusive=False, auto_convert=True),
        )
        if options.get("native_shared"):
            fallback["_engine"] = "wasapi-native-shared"
    if mode != "shared" or not options.get("wasapi_exclusive"):
        return [fallback]
    # Exclusive mode seizes the device; it never goes through the native DLL
    # (shared-mode only, see monitor.cpp), only through PortAudio's own
    # WASAPI exclusive negotiation. Same requested buffer/rate as the
    # fallback, so a failure here is purely about mode, not about a
    # different buffer size being rejected.
    exclusive = {
        "samplerate": rate, "blocksize": blocksize, "latency": blocksize / rate,
        "channels": (1, int(options["output_channels"])),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
        "_mode": "exclusive",
        "extra_settings": (sd.WasapiSettings(exclusive=True), sd.WasapiSettings(exclusive=True)),
    }
    return [exclusive, fallback]

def _emit(payload: dict) -> None: print(json.dumps(payload), flush=True)


def _stream_diagnostics(stream, candidate, options, mode):
    result = {
        "blocksize": candidate.get("blocksize", 0), "sample_rate": candidate.get("samplerate", options["sample_rate"]),
        "latency": candidate.get("latency", "low"), "mode": mode,
        "exclusive": mode == "exclusive",
        "engine": "wasapi-split" if isinstance(stream, WasapiMonitorStream) else "duplex",
    }
    # WASAPI PortAudio derives these estimates from allocated buffer capacity,
    # not an observed mic-to-output transit time. Keep their provenance explicit.
    result["latency_source"] = "portaudio-buffer-estimate"
    latency = getattr(stream, "latency", None)
    if isinstance(latency, (tuple, list)) and len(latency) == 2:
        result.update(input_latency_ms=round(float(latency[0]) * 1000, 2),
                      output_latency_ms=round(float(latency[1]) * 1000, 2))
    return result


def _stop(_signum: int, _frame: object) -> None:
    global _running
    _running = False


def _read_live_updates() -> None:
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line: continue
            try:
                update = json.loads(line)
            except json.JSONDecodeError:
                continue
            with _live_lock:
                for key in ("reverb", "echo", "delay", "noise_suppression", "octave"):
                    if key in update: _live_params[key] = float(update[key])
    except Exception:
        return


def _audio_callback(gain: float, sample_rate: float = 44_100, statistics=None, relay: RelayLink | None = None):
    statistics = {} if statistics is None else statistics
    quality = StudioMicrophoneProcessor(sample_rate, 1)
    pitch = RealtimePitchShifter(sample_rate)
    effects = MonitorEffectsChain(sample_rate)
    def callback(indata, outdata, _frames, _time_info, status):
        compute_started = time.perf_counter()
        statistics["callback_frames"] = int(_frames)
        statistics["callback_count"] = statistics.get("callback_count", 0) + 1
        if status:
            statistics["glitch_count"] = statistics.get("glitch_count", 0) + 1
        with _live_lock:
            reverb, echo, delay, noise_suppression, octave = (
                _live_params["reverb"],
                _live_params["echo"],
                _live_params["delay"],
                _live_params.get("noise_suppression", 0.35),
                _live_params.get("octave", 0.0),
            )
        processed = quality.process(indata[:, :1], gain, noise_suppression)[:, 0]
        dry = pitch.process(processed, octave)
        processed = effects.process(dry, reverb, echo, delay)
        if relay is not None:
            relay.push(STREAM_DRY, sample_rate, dry)
            relay.push(STREAM_WET, sample_rate, processed)
        outdata.fill(0)
        for channel in range(outdata.shape[1]): outdata[:, channel] = processed
        rms, peak = float(np.sqrt(np.mean(np.square(processed)))) if len(processed) else 0.0, float(np.max(np.abs(processed))) if len(processed) else 0.0
        _level.update(
            {
                "rms_db": round(20 * np.log10(rms) if rms > 0 else -120.0, 1),
                "clipping": peak >= 0.99,
                "silent": rms < 10 ** (-50 / 20),
            }
        )
        statistics["dsp_compute_ms"] = round((time.perf_counter() - compute_started) * 1000, 3)

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
        _live_params["noise_suppression"] = float(options.get("noise_suppression", 0.35))
        _live_params["octave"] = float(options.get("octave", 0.0))
    threading.Thread(target=_read_live_updates, daemon=True).start()

    failed = threading.Event()
    statistics = {"glitch_count": 0}
    stream: Any = None
    relay: RelayLink | None = None
    try:
        candidates = _stream_candidates(options)
        _stage("initialize microphone DSP")
        relay_port = options.get("audio_relay_port")
        process = None

        def open_relay(sample_rate: float) -> None:
            nonlocal relay, process
            if relay is not None:
                relay.close()
            # Connecting is fully non-blocking (a background thread) specifically
            # so an unavailable or slow relay server can never delay solo
            # monitoring startup -- see monitor_relay_link.RelayLink.
            relay = RelayLink(int(relay_port), sample_rate) if relay_port else None
            process = _audio_callback(gain, sample_rate, statistics, relay)

        open_relay(float(options["sample_rate"]))

        def callback(*args):
            try:
                process(*args)
            except Exception as error:
                statistics["callback_error"] = str(error)
                failed.set()

        chosen_engine, details = "duplex", None
        for index, raw_candidate in enumerate(candidates):
            candidate = dict(raw_candidate)
            mode = candidate.pop("_mode")
            engine = candidate.pop("_engine", "duplex")
            last_attempt = index + 1 == len(candidates)
            try:
                if engine == "wasapi-native-shared":
                    _stage("load native WASAPI and open shared endpoints")
                    from app.services.native_wasapi import NativeWasapiStream
                    stream = NativeWasapiStream(options, statistics)
                    if stream.info.sample_rate != float(options["sample_rate"]):
                        open_relay(stream.info.sample_rate)
                    _stage("start native shared audio stream")
                    stream.start(process)
                    details = stream.diagnostics()
                else:
                    _stage("open PortAudio stream")
                    stream = (WasapiMonitorStream(sd, candidate, callback, statistics, failed)
                              if engine == "wasapi-split" else sd.Stream(**candidate, callback=callback))
                    _stage("start PortAudio stream")
                    stream.start()
                    details = _stream_diagnostics(stream, candidate, options, mode)
                chosen_engine = engine
                break
            except Exception as error:
                if stream is not None:
                    for method in ("abort", "close"):
                        with contextlib.suppress(Exception):
                            getattr(stream, method)()
                    stream = None
                if last_attempt:
                    raise
                _emit({"event": "fallback", "message": str(error)})
        _emit({"event": "started", **details})
        reported = time.monotonic()
        while _running and not failed.is_set():
            if chosen_engine == "wasapi-native-shared":
                stream.pump()
                if time.monotonic() - reported < .1:
                    continue
                reported = time.monotonic()
            elif failed.wait(.1):
                break
            _emit({"event": "level", **_level, **statistics})
        if failed.is_set():
            raise RuntimeError(statistics.get("callback_error", "Monitoring callback failed; selected settings were not changed"))
    except Exception as exc:  # The parent converts this into a friendly API error.
        _emit({"event": "error", "message": str(exc)})
        return 1
    finally:
        if relay is not None:
            with contextlib.suppress(Exception):
                relay.close()
        if stream is not None:
            for method in ("abort", "close"):
                with contextlib.suppress(Exception):
                    getattr(stream, method)()
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _stop)
    if hasattr(signal, "SIGBREAK"): signal.signal(signal.SIGBREAK, _stop)
    sys.exit(main())
