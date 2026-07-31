"""Микрофон и звук: список устройств, настройки записи, проверка сигнала."""
import threading

from sqlalchemy.orm import Session

import models

try:
    import sounddevice as sd
    import numpy as np
    _AUDIO_BACKEND_AVAILABLE = True
except Exception:
    _AUDIO_BACKEND_AVAILABLE = False


_monitor_stream = None
_monitor_lock = threading.Lock()
_monitor_signal = {"rms_db": -120.0, "clipping": False, "silent": True}


def _preferred_device_index(device_id: int | None, kind: str) -> int | None:
    """Keep the device explicitly selected by the user.

    ``None`` intentionally means the operating system's current default device.
    """
    return device_id


def preferred_input_device(device_id: int | None) -> int | None:
    return _preferred_device_index(device_id, "input")


def preferred_output_device(input_device_id: int | None = None) -> int | None:
    return None


def list_input_devices() -> list[dict]:
    if not _AUDIO_BACKEND_AVAILABLE:
        return []
    devices = sd.query_devices()
    result = []
    for idx, dev in enumerate(devices):
        if dev.get("max_input_channels", 0) > 0:
            host_api = sd.query_hostapis(dev["hostapi"])["name"]
            result.append({
                "index": idx,
                "name": f"{dev.get('name', f'device-{idx}')} [{host_api}]",
                "max_input_channels": dev.get("max_input_channels", 0),
                "default_samplerate": dev.get("default_samplerate"),
            })
    return result


def _get_or_create_settings(db: Session) -> models.AudioSettings:
    settings = db.query(models.AudioSettings).filter(models.AudioSettings.id == 1).first()
    if settings is None:
        settings = models.AudioSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def get_settings(db: Session) -> models.AudioSettings:
    return _get_or_create_settings(db)


def update_settings(db: Session, patch: dict) -> models.AudioSettings:
    settings = _get_or_create_settings(db)
    for field, value in patch.items():
        if field == "input_device_id" and value is None:
            settings.input_device_id = None
            settings.input_device_name = None
            continue
        if value is None:
            continue
        if field == "input_device_id" and _AUDIO_BACKEND_AVAILABLE:
            devices = sd.query_devices()
            if 0 <= value < len(devices):
                settings.input_device_name = devices[value].get("name")
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    configure_monitoring(settings)
    return settings


def stop_monitoring() -> None:
    global _monitor_stream
    with _monitor_lock:
        streams = _monitor_stream
        _monitor_stream = None
    if streams is not None:
        for stream in streams:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass


def configure_monitoring(settings: models.AudioSettings) -> None:
    """Start or stop one direct PortAudio monitor stream.

    Audio bypasses Chromium/WebAudio here, which avoids its extra buffering.
    """
    stop_monitoring()
    if not settings.monitoring_enabled:
        return
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError("Audio backend is unavailable")

    input_device_id = _preferred_device_index(settings.input_device_id, "input")
    # The Windows default output is intentionally used here. Some interfaces
    # expose input and output under the same name but cannot be opened as a
    # PortAudio duplex pair, which caused monitor dropouts.
    output_device_id = None
    output_info = sd.query_devices(kind="output")
    output_channels = min(2, int(output_info["max_output_channels"]))
    if output_channels < 1:
        raise RuntimeError("No output device is available for microphone monitoring")
    gain = max(0.0, min(4.0, settings.volume))

    def callback(indata, outdata, frames, time_info, status):  # noqa: ARG001
        processed = np.clip(indata[:, 0] * gain, -1.0, 1.0)
        outdata.fill(0)
        for channel in range(outdata.shape[1]):
            outdata[:, channel] = processed
        rms = float(np.sqrt(np.mean(np.square(processed)))) if len(processed) else 0.0
        rms_db = 20 * np.log10(rms) if rms > 0 else -120.0
        peak = float(np.max(np.abs(processed))) if len(processed) else 0.0
        with _monitor_lock:
            _monitor_signal.update({
                "rms_db": round(rms_db, 1),
                "clipping": peak >= 0.99,
                "silent": rms_db < -50.0,
            })

    try:
        stream = sd.Stream(
            samplerate=float(output_info["default_samplerate"]),
            channels=(1, output_channels),
            device=(input_device_id, output_device_id),
            blocksize=64,
            latency="low",
            callback=callback,
        )
        stream.start()
    except Exception as exc:
        raise RuntimeError(f"Could not start direct microphone monitoring: {exc}") from exc
    with _monitor_lock:
        _monitor_stream = (stream,)


def check_signal_quality(device_id: int | None, gain: float = 1.0, duration_sec: float = 0.5) -> dict:
    """Короткая проверка: пишет duration_sec секунд с выбранного устройства
    и считает RMS-уровень — чтобы UI мог показать "тихо / нормально /
    клиппинг" ещё до полноценной записи."""
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError("Аудио-бэкенд (sounddevice) недоступен")

    with _monitor_lock:
        if _monitor_stream is not None:
            return dict(_monitor_signal)

    sample_rate = 44100
    recording = sd.rec(
        int(duration_sec * sample_rate), samplerate=sample_rate, channels=1,
        device=device_id, dtype="float32",
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
