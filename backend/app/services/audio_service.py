"""Микрофон и звук: список устройств, настройки записи, проверка сигнала."""

import json
import logging
import re
import subprocess
import sys
import threading
from pathlib import Path

from sqlalchemy.orm import Session

import config
import models
from app.services.db_utils import commit_refresh

try:
    import numpy as np
    import sounddevice as sd

    _AUDIO_BACKEND_AVAILABLE = True
except Exception:
    from types import SimpleNamespace
    sd = SimpleNamespace(
        query_devices=None, query_hostapis=None, rec=None, wait=None,
        default=SimpleNamespace(device=(None, None)), WasapiSettings=None
    )
    _AUDIO_BACKEND_AVAILABLE = False


_monitor_process: subprocess.Popen[str] | None = None
_monitor_reader: threading.Thread | None = None
_monitor_lock = threading.Lock()
_EMPTY_MONITOR_SIGNAL = {"rms_db": -120.0, "clipping": False, "silent": True}
_MONITOR_RESTART_FIELDS = frozenset(
    {
        "input_device_id",
        "output_device_id",
        "volume",
        "audio_driver",
        "asio_driver_name",
        "buffer_size",
        "reverb",
        "echo",
        "delay",
    }
)
_monitor_signal = dict(_EMPTY_MONITOR_SIGNAL)
logger = logging.getLogger(__name__)


def _asio_bridge_path() -> Path:
    if config.IS_FROZEN:
        return Path(sys.executable).with_name("KaraokeAsioBridge.exe")
    # Native artifacts are shared by the backend, frontend and installer and
    # therefore live in the repository-level build directory.  Keeping the
    # development lookup here in sync with the build scripts is important:
    # a missing bridge used to make karaoke playback fail before the first
    # audio frame even though the executable had been built successfully.
    return Path(config.PROJECT_ROOT) / "build" / "asio" / "KaraokeAsioBridge.exe"


def list_asio_drivers() -> list[str]:
    """Enumerate native ASIO drivers through the isolated C++ bridge."""
    bridge = _asio_bridge_path()
    if not bridge.is_file():
        return []
    try:
        result = subprocess.run(
            [str(bridge), "--list"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=4,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        drivers = payload.get("drivers", [])
        return [str(name) for name in drivers if isinstance(name, str)]
    except (OSError, ValueError, subprocess.SubprocessError, IndexError) as exc:
        logger.warning("Could not enumerate ASIO drivers: %s", exc)
        return []


def _device_tokens(name: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[\w]+", name.casefold())
        if len(token) > 2 and token not in {"audio", "device", "микрофон", "наушники"}
    }


def _device_latency(device: dict, kind: str) -> float:
    value = device.get(f"default_low_{kind}_latency", 1.0)
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 1.0


def _low_latency_equivalent(device_id: int | None, kind: str) -> int:
    """Prefer the WASAPI endpoint matching the selected/default Windows device."""
    source_id = _resolved_device_index(device_id, kind)
    devices = sd.query_devices()
    source = devices[source_id]
    capability = f"max_{kind}_channels"
    source_tokens = _device_tokens(str(source.get("name", "")))
    best: tuple[float, int] | None = None
    for index, candidate in enumerate(devices):
        if int(candidate.get(capability, 0)) < 1:
            continue
        host = _host_api_name(candidate).casefold()
        if "wasapi" not in host:
            continue
        overlap = len(source_tokens & _device_tokens(str(candidate.get("name", ""))))
        # An explicit selection must map to the same physical endpoint. For an
        # OS default, Windows' low-latency host default remains a valid choice.
        if device_id is not None and overlap == 0 and index != source_id:
            continue
        score = 300 + overlap * 30 - _device_latency(candidate, kind) * 1000
        if index == source_id:
            score += 20
        if best is None or score > best[0]:
            best = (score, index)
    return best[1] if best else source_id


def _matching_output_for_input(input_id: int, output_id: int | None) -> int:
    """Choose a low-latency output, favoring the microphone's physical device."""
    selected_output = _low_latency_equivalent(output_id, "output")
    devices = sd.query_devices()
    input_info = devices[input_id]
    input_host_api = int(input_info["hostapi"])
    if output_id is not None:
        output_info = devices[selected_output]
        if int(output_info["hostapi"]) == input_host_api:
            return selected_output
        # A PortAudio duplex stream cannot combine different host APIs.
        selected_output = _resolved_device_index(output_id, "output")
        if int(devices[selected_output]["hostapi"]) == input_host_api:
            return selected_output
    input_tokens = _device_tokens(str(input_info.get("name", "")))
    input_rate = float(input_info.get("default_samplerate", 0) or 0)
    candidates: list[tuple[float, int]] = []
    for index, candidate in enumerate(devices):
        if int(candidate.get("max_output_channels", 0)) < 1:
            continue
        if int(candidate["hostapi"]) != input_host_api:
            continue
        host = _host_api_name(candidate).casefold()
        overlap = len(input_tokens & _device_tokens(str(candidate.get("name", ""))))
        rate = float(candidate.get("default_samplerate", 0) or 0)
        score = float((300 if "wasapi" in host else 100) + overlap * 35)
        score -= abs(rate - input_rate) / 1000
        score -= _device_latency(candidate, "output") * 1000
        if index == selected_output:
            score += 45
        candidates.append((score, index))
    return max(candidates)[1] if candidates else selected_output


def _asio_device_hint(driver_name: str | None) -> str:
    """Return a stable, human-readable part of a native ASIO driver name."""
    if not driver_name:
        return ""
    hint = driver_name.lower()
    for suffix in (" asio driver", " asio", " driver"):
        hint = hint.replace(suffix, "")
    return " ".join(hint.split())


def _matching_asio_device_index(driver_name: str | None, kind: str) -> int | None:
    """Resolve native ASIO to its matching PortAudio device for recording.

    The native bridge owns direct monitoring; recording currently uses
    PortAudio. Prefer the same interface by name so any selected ASIO device
    does not silently fall back to Windows' default microphone.
    """
    if not _AUDIO_BACKEND_AVAILABLE:
        return None
    hint = _asio_device_hint(driver_name)
    if not hint:
        return None
    capability = "max_input_channels" if kind == "input" else "max_output_channels"
    best: tuple[int, int] | None = None
    for index, device in enumerate(sd.query_devices()):
        if int(device.get(capability, 0)) < 1:
            continue
        name = str(device.get("name", "")).lower()
        overlap = sum(token in name for token in hint.split() if len(token) > 2)
        if overlap == 0:
            continue
        score = overlap * 10 + (5 if _is_asio_device(device) else 0)
        if best is None or score > best[0]:
            best = (score, index)
    return best[1] if best else None


def preferred_input_device(
    device_id: int | None,
    driver: str = "auto",
    asio_driver_name: str | None = None,
) -> int | None:
    if driver == "asio":
        return (
            device_id
            if device_id is not None
            else _matching_asio_device_index(asio_driver_name, "input")
        )
    if not _AUDIO_BACKEND_AVAILABLE:
        return device_id
    return _low_latency_equivalent(device_id, "input")


def _host_api_name(device: dict) -> str:
    return str(sd.query_hostapis(device["hostapi"])["name"])


def _is_asio_device(device: dict) -> bool:
    return "asio" in _host_api_name(device).lower()


def _resolved_device_index(device_id: int | None, kind: str) -> int:
    if device_id is not None:
        return device_id
    default_input, default_output = sd.default.device
    raw_default = default_input if kind == "input" else default_output
    try:
        default_id = int(raw_default)
    except (TypeError, ValueError):
        default_id = -1
    if default_id >= 0:
        return default_id
    capability = f"max_{kind}_channels"
    candidates = [
        (index, device)
        for index, device in enumerate(sd.query_devices())
        if int(device.get(capability, 0)) > 0
    ]
    if not candidates:
        raise RuntimeError(f"No {kind} audio device is available")
    host_priority = {"wasapi": 0, "mme": 1, "directsound": 2, "wdm-ks": 3}

    def rank(item: tuple[int, dict]) -> tuple[int, float]:
        _index, device = item
        host = _host_api_name(device).casefold().replace("windows ", "")
        priority = next((value for name, value in host_priority.items() if name in host), 4)
        return priority, _device_latency(device, kind)

    return min(candidates, key=rank)[0]


def _is_wasapi_device(device: dict) -> bool:
    return "wasapi" in _host_api_name(device).lower()


def preferred_output_device(
    input_device_id: int | None = None,
    driver: str = "auto",
    output_device_id: int | None = None,
    asio_driver_name: str | None = None,
) -> int | None:
    if not _AUDIO_BACKEND_AVAILABLE:
        return output_device_id
    if driver == "asio":
        if output_device_id is not None:
            return output_device_id
        if input_device_id is not None:
            device = sd.query_devices(input_device_id)
            if _is_asio_device(device) and int(device.get("max_output_channels", 0)) > 0:
                return input_device_id
        return _matching_asio_device_index(asio_driver_name, "output")
    resolved_input = _low_latency_equivalent(input_device_id, "input")
    return _matching_output_for_input(resolved_input, output_device_id)


def preferred_sample_rate(input_device_id: int | None = None, driver: str = "auto") -> int:
    if _AUDIO_BACKEND_AVAILABLE and input_device_id is not None:
        device = sd.query_devices(input_device_id)
        return int(round(float(device["default_samplerate"])))
    return config.RECORDING_SAMPLE_RATE


def _list_devices(kind: str) -> list[dict]:
    if not _AUDIO_BACKEND_AVAILABLE:
        return []
    channel_field = f"max_{kind}_channels"
    result = []
    for index, device in enumerate(sd.query_devices()):
        if device.get(channel_field, 0) <= 0:
            continue
        host_api = _host_api_name(device)
        result.append(
            {
                "index": index,
                "name": f"{device.get('name', f'device-{index}')} [{host_api}]",
                channel_field: device.get(channel_field, 0),
                "default_samplerate": device.get("default_samplerate"),
                "host_api": host_api,
                "is_asio": "asio" in host_api.lower(),
            }
        )
    return result


def list_input_devices() -> list[dict]:
    return _list_devices("input")


def list_output_devices() -> list[dict]:
    return _list_devices("output")


def _get_or_create_settings(db: Session) -> models.AudioSettings:
    if (settings := db.get(models.AudioSettings, 1)) is not None:
        return settings
    settings = models.AudioSettings(id=1)
    db.add(settings)
    return commit_refresh(db, settings)


def get_settings(db: Session) -> models.AudioSettings:
    # Keep the OS/default microphone path until the user explicitly selects
    # ASIO. Merely having an ASIO driver installed must not hijack simple mics.
    return _get_or_create_settings(db)


def _input_device_name(device_id: int | None) -> str | None:
    if device_id is None or not _AUDIO_BACKEND_AVAILABLE:
        return None
    devices = sd.query_devices()
    if 0 <= device_id < len(devices):
        return str(devices[device_id].get("name") or "") or None
    return None


def _normalized_settings_patch(
    settings: models.AudioSettings, patch: dict
) -> tuple[dict, set[str]]:
    updates: dict = {}
    changed_fields: set[str] = set()
    for field, value in patch.items():
        if field in {"input_device_id", "output_device_id"} and value is None:
            if getattr(settings, field) is not None:
                updates[field] = None
                changed_fields.add(field)
            if field == "input_device_id":
                updates["input_device_name"] = None
            continue
        if value is None:
            continue
        if getattr(settings, field) != value:
            updates[field] = value
            changed_fields.add(field)
        if field == "input_device_id":
            updates["input_device_name"] = _input_device_name(value)

    driver = updates.get("audio_driver", settings.audio_driver)
    asio_name = updates.get("asio_driver_name", settings.asio_driver_name)
    if driver not in {"auto", "asio"}:
        raise RuntimeError("Unsupported audio driver")
    if driver == "asio":
        drivers = list_asio_drivers()
        if not drivers:
            raise RuntimeError("Native ASIO bridge is not installed or no ASIO drivers were found")
        if asio_name not in drivers:
            updates["asio_driver_name"] = drivers[0]
            changed_fields.add("asio_driver_name")
    return updates, changed_fields


def update_settings(db: Session, patch: dict) -> models.AudioSettings:
    settings = _get_or_create_settings(db)
    updates, changed_fields = _normalized_settings_patch(settings, patch)
    previous = {field: getattr(settings, field) for field in updates}
    reconfigure_monitoring = bool(
        "monitoring_enabled" in changed_fields
        or (settings.monitoring_enabled and _MONITOR_RESTART_FIELDS & changed_fields)
    )

    for field, value in updates.items():
        setattr(settings, field, value)

    try:
        # Apply the runtime configuration before committing. If either the
        # audio driver or SQLite rejects the change, both layers are restored.
        if reconfigure_monitoring:
            configure_monitoring(settings)
        db.commit()
        db.refresh(settings)
        return settings
    except Exception:
        db.rollback()
        for field, value in previous.items():
            setattr(settings, field, value)
        if reconfigure_monitoring:
            try:
                configure_monitoring(settings)
            except Exception as restore_error:
                logger.warning(
                    "Could not restore direct monitoring after settings failure: %s",
                    restore_error,
                )
        raise


def set_monitoring_enabled(db: Session, enabled: bool) -> models.AudioSettings:
    """Change direct-monitor state while keeping runtime and SQLite in sync."""
    settings = get_settings(db)
    previous = settings.monitoring_enabled
    if previous == enabled:
        if enabled:
            configure_monitoring(settings)
        else:
            stop_monitoring()
        return settings

    settings.monitoring_enabled = enabled
    try:
        configure_monitoring(settings)
        return commit_refresh(db, settings)
    except Exception:
        db.rollback()
        settings.monitoring_enabled = previous
        try:
            configure_monitoring(settings)
        except Exception as restore_error:
            logger.warning("Could not restore direct monitoring after failure: %s", restore_error)
        raise


def stop_monitoring() -> None:
    global _monitor_process, _monitor_reader
    with _monitor_lock:
        process = _monitor_process
        reader = _monitor_reader
        _monitor_process = None
        _monitor_reader = None
        _monitor_signal.update(_EMPTY_MONITOR_SIGNAL)
    if process is None or process.poll() is not None:
        return
    try:
        # Terminating a separate worker is safe even if a native driver callback
        # is stuck.  This is intentionally not done in the API process.
        process.terminate()
        process.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=1.5)
    except OSError as exc:
        logger.warning("Could not stop direct monitoring worker: %s", exc)
    finally:
        if process.stdout is not None:
            process.stdout.close()
        if reader is not None and reader is not threading.current_thread():
            reader.join(timeout=0.5)


def configure_monitoring(settings: models.AudioSettings) -> None:
    """Start or stop an isolated direct microphone monitor.

    Audio bypasses Chromium/WebAudio here, which avoids its extra buffering.
    """
    stop_monitoring()
    if not settings.monitoring_enabled:
        return
    if settings.audio_driver == "asio":
        _start_asio_monitor(settings)
        return
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError("Audio backend is unavailable")

    input_device_id = preferred_input_device(
        settings.input_device_id, settings.audio_driver, settings.asio_driver_name
    )
    output_device_id = preferred_output_device(
        input_device_id,
        settings.audio_driver,
        settings.output_device_id,
        settings.asio_driver_name,
    )
    resolved_input_id = _resolved_device_index(input_device_id, "input")
    resolved_output_id = _resolved_device_index(output_device_id, "output")
    input_info = sd.query_devices(resolved_input_id)
    output_info = sd.query_devices(resolved_output_id)

    if int(input_info["hostapi"]) != int(output_info["hostapi"]):
        # preferred_input_device()/preferred_output_device() resolve independently
        # and can each fall back to a different audio driver -- e.g. an
        # ASIO-only interface for the microphone paired with a stored output
        # selection that only matches over WASAPI.  PortAudio refuses to open
        # one duplex stream spanning two host APIs (PaErrorCode -9993), so
        # force the output onto the microphone's own host API before ever
        # reaching the native stream, instead of surfacing that opaque error.
        matched_output_id = _matching_output_for_input(resolved_input_id, None)
        matched_info = sd.query_devices(matched_output_id)
        if int(matched_info["hostapi"]) == int(input_info["hostapi"]):
            resolved_output_id, output_info = matched_output_id, matched_info
        else:
            raise RuntimeError(
                "Microphone and speakers use incompatible audio drivers "
                f"({_host_api_name(input_info)} vs {_host_api_name(output_info)}); "
                "select matching devices in audio settings."
            )
    output_channels = min(2, int(output_info["max_output_channels"]))
    if output_channels < 1:
        raise RuntimeError("No output device is available for microphone monitoring")
    gain = max(0.0, min(4.0, settings.volume))

    # WASAPI exclusive mode seizes the output device system-wide: while direct
    # monitoring is on, nothing else -- including the karaoke song itself --
    # can produce sound through it, and once monitoring stops the shared
    # stream that got preempted does not resume on its own (confirmed with a
    # live WASAPI loopback capture: a steady tone was silenced the instant an
    # exclusive monitor stream opened and never returned after it closed).
    # Direct monitoring exists so the singer can hear themselves *while* the
    # song plays, so it must never request exclusive access even when both
    # endpoints support it.
    use_wasapi_exclusive = False
    worker_options = {
        "input_device_id": resolved_input_id,
        "output_device_id": resolved_output_id,
        "sample_rate": float(input_info["default_samplerate"]),
        "output_channels": output_channels,
        "blocksize": settings.buffer_size,
        "gain": gain,
        "wasapi_exclusive": use_wasapi_exclusive,
    }
    _start_monitor_worker(worker_options)


def _start_asio_monitor(settings: models.AudioSettings) -> None:
    bridge = _asio_bridge_path()
    if not bridge.is_file():
        raise RuntimeError("Native ASIO bridge is not built")
    drivers = list_asio_drivers()
    if settings.asio_driver_name not in drivers:
        raise RuntimeError("Selected ASIO driver is unavailable")
    command = [
        str(bridge),
        "--driver",
        settings.asio_driver_name,
        "--buffer-size",
        str(settings.buffer_size),
        "--sample-rate",
        str(config.RECORDING_SAMPLE_RATE),
        "--gain",
        str(max(0.0, min(4.0, settings.volume))),
        "--reverb",
        str(max(0.0, min(1.0, settings.reverb))),
        "--echo",
        str(max(0.0, min(1.0, settings.echo))),
        "--delay",
        str(max(0.0, min(1.0, settings.delay))),
    ]
    _launch_monitor_process(command, cwd=bridge.parent)


def _start_monitor_worker(worker_options: dict) -> None:
    """Launch direct monitoring out-of-process and wait for its ready event."""
    if config.IS_FROZEN:
        worker = Path(sys.executable).with_name("KaraokeAudioMonitor.exe")
        if not worker.is_file():
            raise RuntimeError("The packaged audio-monitor worker is missing")
        command = [str(worker), "--config", json.dumps(worker_options)]
    else:
        command = [
            sys.executable,
            "-m",
            "app.services.monitor_worker",
            "--config",
            json.dumps(worker_options),
        ]
    _launch_monitor_process(command, cwd=Path(config.BASE_DIR))


def _launch_monitor_process(command: list[str], *, cwd: Path) -> None:
    """Launch a JSON-line monitor process and wait for its ready event."""
    global _monitor_process, _monitor_reader
    ready = threading.Event()
    state: dict[str, str | None] = {"error": None}
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        creationflags=creationflags,
    )

    def consume_output() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("Audio monitor worker: %s", line.rstrip())
                continue
            event = message.get("event")
            if event == "started":
                ready.set()
            elif event == "level":
                with _monitor_lock:
                    if _monitor_process is process:
                        _monitor_signal.update(
                            {key: message[key] for key in _monitor_signal if key in message}
                        )
            elif event == "error":
                state["error"] = str(message.get("message") or "unknown audio worker error")
                ready.set()
        if not ready.is_set():
            state["error"] = state["error"] or "audio monitoring worker terminated during startup"
            ready.set()
        with _monitor_lock:
            if _monitor_process is process and process.poll() is not None:
                _monitor_signal.update(_EMPTY_MONITOR_SIGNAL)

    reader = threading.Thread(target=consume_output, name="audio-monitor-reader", daemon=True)
    with _monitor_lock:
        _monitor_process = process
        _monitor_reader = reader
    reader.start()
    if not ready.wait(timeout=4):
        stop_monitoring()
        raise RuntimeError("Timed out starting direct microphone monitoring")
    if state["error"]:
        stop_monitoring()
        raise RuntimeError(f"Could not start direct microphone monitoring: {state['error']}")


def check_signal_quality(
    device_id: int | None,
    gain: float = 1.0,
    duration_sec: float = 0.5,
    monitoring_expected: bool = False,
) -> dict:
    """Короткая проверка: пишет duration_sec секунд с выбранного устройства
    и считает RMS-уровень — чтобы UI мог показать "тихо / нормально /
    клиппинг" ещё до полноценной записи."""
    global _monitor_process
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError("Аудио-бэкенд (sounddevice) недоступен")

    with _monitor_lock:
        process = _monitor_process
        if process is not None and process.poll() is None:
            return dict(_monitor_signal)
        if process is not None:
            _monitor_process = None
            _monitor_signal.update(_EMPTY_MONITOR_SIGNAL)
        if monitoring_expected:
            return dict(_monitor_signal)

    sample_rate = 44100
    recording = sd.rec(
        int(duration_sec * sample_rate),
        samplerate=sample_rate,
        channels=1,
        device=device_id,
        dtype="float32",
    )
    sd.wait()
    samples = np.clip(recording.flatten() * max(0.0, min(4.0, gain)), -1.0, 1.0)

    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    rms_db = 20 * np.log10(rms) if rms > 0 else -120.0
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0

    return {
        "rms_db": round(rms_db, 1),
        "clipping": peak >= 0.99,
        "silent": rms_db < -50.0,
    }
