
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

from app.services.microphone_quality import (
    MonitorEffectsChain,
    RealtimePitchShifter,
    StudioMicrophoneProcessor,
)

_running = True
_level = {"rms_db": -120.0, "clipping": False, "silent": True}
_live_lock = threading.Lock()
_live_params = {"reverb": 0.0, "echo": 0.0, "delay": 0.0, "noise_suppression": 0.35, "octave": 0.0}
_GLITCH_WINDOW_SECONDS = 5.0
_GLITCH_RESTART_THRESHOLD = 12


def _stream_candidates(options: dict) -> list[dict]:
    rates = list(dict.fromkeys([options["sample_rate"], *options.get("sample_rates", [])]))
    if len(rates) > 1:
        return [candidate for rate in rates for candidate in _stream_candidates({
            **options, "sample_rate": rate, "sample_rates": []
        })]
    sample_rate = float(options["sample_rate"])
    base = {
        "samplerate": sample_rate,
        "channels": (1, int(options["output_channels"])),
        "device": (int(options["input_device_id"]), int(options["output_device_id"])),
    }
    requested_blocksize = int(options["blocksize"])
    # Effects and noise suppression run in Python on every callback. Tiny
    # 32/64-frame blocks can starve even a normal 44.1/48 kHz device and make
    # monitoring fall progressively behind. 128 frames is still only ~3 ms at
    # those rates and is a much safer realtime floor for every host API.
    stable_blocksize = max(128, requested_blocksize)
    blocks = tuple(dict.fromkeys((stable_blocksize, min(2048, stable_blocksize * 2))))
    candidates = []
    requested_mode = options.get("wasapi_mode", "exclusive" if options.get("wasapi_exclusive") else "plain")
    modes = {
        "exclusive": ("exclusive", "input-exclusive", "shared", "plain"),
        "input-exclusive": ("input-exclusive", "shared", "plain"),
        "shared": ("shared", "plain"),
        "plain": ("plain",),
    }[requested_mode]
    for mode in modes:
        # Keep latency deterministic for as long as the endpoint accepts it.
        # PortAudio's generic "low" preset can map to a surprisingly large
        # shared-mode buffer on consumer USB sound cards. Try 128 and 256
        # frames explicitly before allowing that host-controlled fallback.
        for blocksize in blocks:
            candidate = {
                **base,
                "_mode": mode,
                "blocksize": blocksize,
                "latency": max(0.002, blocksize / sample_rate),
            }
            if mode == "exclusive":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(exclusive=True),
                    sd.WasapiSettings(exclusive=True),
                )
            elif mode == "input-exclusive":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(exclusive=True),
                    sd.WasapiSettings(auto_convert=True),
                )
            elif mode == "shared":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(auto_convert=True),
                    sd.WasapiSettings(auto_convert=True),
                )
            if candidate not in candidates:
                candidates.append(candidate)
        for blocksize in (*blocks, 0):
            candidate = {**base, "blocksize": blocksize, "latency": "low", "_mode": mode}
            if mode == "exclusive":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(exclusive=True),
                    sd.WasapiSettings(exclusive=True),
                )
            elif mode == "input-exclusive":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(exclusive=True),
                    sd.WasapiSettings(auto_convert=True),
                )
            elif mode == "shared":
                candidate["extra_settings"] = (
                    sd.WasapiSettings(auto_convert=True),
                    sd.WasapiSettings(auto_convert=True),
                )
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates


def _emit(payload: dict) -> None: print(json.dumps(payload), flush=True)


def _stream_diagnostics(stream, candidate, options, mode):
    result = {
        "blocksize": candidate.get("blocksize", 0), "sample_rate": candidate.get("samplerate", options["sample_rate"]),
        "latency": candidate.get("latency", "low"), "mode": mode,
        "exclusive": mode == "exclusive",
    }
    # PortAudio reports endpoint latency, not full mic-to-ear latency (DSP and
    # hardware can add more). Never present the requested latency hint as measured.
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


def _audio_callback(gain: float, restart_requested: threading.Event, glitches: list[float], sample_rate: float = 44_100):
    quality = StudioMicrophoneProcessor(sample_rate, 1)
    pitch = RealtimePitchShifter(sample_rate)
    effects = MonitorEffectsChain(sample_rate)
    def callback(indata, outdata, _frames, _time_info, status):
        if status:
            now = time.monotonic()
            glitches.append(now)
            while glitches and glitches[0] < now - _GLITCH_WINDOW_SECONDS:
                glitches.pop(0)
            # A consumer USB endpoint can report an isolated underflow while
            # another application starts. Three such events used to push the
            # monitor permanently onto a high-latency host fallback. Restart
            # only for sustained failure, not harmless transients.
            if len(glitches) >= _GLITCH_RESTART_THRESHOLD:
                restart_requested.set()
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

    restart_requested = threading.Event()
    glitches: list[float] = []
    callback, stream = _audio_callback(gain, restart_requested, glitches, float(options['sample_rate'])), None
    try:
        failures: list[str] = []
        minimum_block = 0
        glitch_fallback = False
        callback_rate = float(options["sample_rate"])
        candidates = _stream_candidates(options)
        for candidate_index, candidate in enumerate(candidates):
            candidate = dict(candidate)
            mode = candidate.pop("_mode", "plain")
            if 0 < candidate.get("blocksize", 0) < minimum_block:
                continue
            try:
                candidate_rate = float(candidate.get("samplerate", callback_rate))
                if candidate_rate != callback_rate:
                    callback = _audio_callback(gain, restart_requested, glitches, candidate_rate)
                    callback_rate = candidate_rate
                stream = sd.Stream(**candidate, callback=callback)
                stream.start()
                diagnostics = _stream_diagnostics(stream, candidate, options, mode)
                if failures or candidate_index:
                    _emit(
                        {
                            "event": "fallback",
                            "message": "Audio glitches detected" if glitch_fallback else (failures[-1] if failures else "Driver compatibility fallback"),
                            "cause": "glitches" if glitch_fallback else "device-open",
                            **diagnostics,
                        }
                    )
                _emit(
                    {
                        "event": "started",
                        **diagnostics,
                    }
                )
                restart_requested.clear()
                glitches.clear()
                while _running and not restart_requested.wait(0.1): _emit({"event": "level", **_level})
                if _running:
                    minimum_block = max(minimum_block, candidate.get("blocksize", 0) + 1)
                    glitch_fallback = True
                    failures.clear()
                stream.abort()
                stream.close()
                stream = None
                if not _running: break
            except Exception as error:
                failures.append(str(error))
                if stream is not None:
                    try:
                        stream.abort()
                        stream.close()
                    except Exception:
                        pass
                    stream = None
        if _running: raise RuntimeError(failures[-1] if failures else "No audio stream candidate")
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
    if hasattr(signal, "SIGBREAK"): signal.signal(signal.SIGBREAK, _stop)
    sys.exit(main())
