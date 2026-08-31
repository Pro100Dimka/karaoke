
from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
import time

def _stage(name: str) -> None:
    print(json.dumps({"event": "stage", "stage": name}), flush=True)


if __name__ == "__main__":
    _stage("import numpy")
import numpy as np

if __name__ == "__main__":
    _stage("import sounddevice / initialize PortAudio")
try:
    import sounddevice as sd
except Exception:  # PortAudio may be unavailable in CI/diagnostics.
    from types import SimpleNamespace
    sd = SimpleNamespace(Stream=None, WasapiSettings=lambda **kwargs: kwargs)

if __name__ == "__main__":
    _stage("import microphone DSP")
from app.services.microphone_quality import (
    MonitorEffectsChain,
    RealtimePitchShifter,
    StudioMicrophoneProcessor,
)
from app.services.wasapi_monitor_stream import WasapiMonitorStream

_running = True
_level = {"rms_db": -120.0, "clipping": False, "silent": True}
_live_lock = threading.Lock()
_live_params = {"reverb": 0.0, "echo": 0.0, "delay": 0.0, "noise_suppression": 0.35, "octave": 0.0}


def _stream_candidates(options: dict) -> list[dict]:
    """Exactly one requested configuration: no buffer, mode or rate fallback."""
    rate = float(options["sample_rate"])
    blocksize = int(options["blocksize"])
    if blocksize <= 0:
        raise ValueError("A fixed positive monitoring buffer is required")
    mode = options.get("wasapi_mode", "shared")
    if mode not in {"shared", "plain"} or options.get("wasapi_exclusive"):
        raise ValueError("Unsupported WASAPI mode")
    candidate = {
        "samplerate": rate, "blocksize": blocksize, "latency": blocksize / rate,
        "channels": (1, int(options["output_channels"])),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
        "_mode": mode,
    }
    if mode != "plain":
        candidate["extra_settings"] = (
            sd.WasapiSettings(exclusive=False, auto_convert=True),
            sd.WasapiSettings(exclusive=False, auto_convert=True),
        )
        if options.get("native_shared"):
            candidate["_engine"] = "wasapi-native-shared"
    return [candidate]

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


def _audio_callback(gain: float, sample_rate: float = 44_100, statistics=None):
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
        processed = pitch.process(processed, octave)
        processed = effects.process(processed, reverb, echo, delay)
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
    stream = None
    try:
        candidate = dict(_stream_candidates(options)[0])
        mode = candidate.pop("_mode")
        engine = candidate.pop("_engine", "duplex")
        if engine == "wasapi-native-shared":
            _stage("load native WASAPI and open shared endpoints")
            from app.services.native_wasapi import NativeWasapiStream
            stream = NativeWasapiStream(options, statistics)
        _stage("initialize microphone DSP")
        process = _audio_callback(gain, stream.info.sample_rate if stream else float(options["sample_rate"]), statistics)

        def callback(*args):
            try:
                process(*args)
            except Exception as error:
                statistics["callback_error"] = str(error)
                failed.set()

        if engine == "wasapi-native-shared":
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
        _emit({"event": "started", **details})
        reported = time.monotonic()
        while _running and not failed.is_set():
            if engine == "wasapi-native-shared":
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
        if stream is not None:
            for method in ("abort", "close"):
                try:
                    getattr(stream, method)()
                except Exception:
                    pass
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _stop)
    if hasattr(signal, "SIGBREAK"): signal.signal(signal.SIGBREAK, _stop)
    sys.exit(main())
