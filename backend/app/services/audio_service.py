"""Микрофон и звук: список устройств, настройки записи, проверка сигнала."""
from sqlalchemy.orm import Session

import models

try:
    import sounddevice as sd
    import numpy as np
    _AUDIO_BACKEND_AVAILABLE = True
except Exception:
    _AUDIO_BACKEND_AVAILABLE = False


def list_input_devices() -> list[dict]:
    if not _AUDIO_BACKEND_AVAILABLE:
        return []
    devices = sd.query_devices()
    result = []
    for idx, dev in enumerate(devices):
        if dev.get("max_input_channels", 0) > 0:
            result.append({
                "index": idx,
                "name": dev.get("name", f"device-{idx}"),
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
        if value is None:
            continue
        if field == "input_device_id" and _AUDIO_BACKEND_AVAILABLE:
            devices = sd.query_devices()
            if 0 <= value < len(devices):
                settings.input_device_name = devices[value].get("name")
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings


def check_signal_quality(device_id: int | None, duration_sec: float = 0.5) -> dict:
    """Короткая проверка: пишет duration_sec секунд с выбранного устройства
    и считает RMS-уровень — чтобы UI мог показать "тихо / нормально /
    клиппинг" ещё до полноценной записи."""
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError("Аудио-бэкенд (sounddevice) недоступен")

    sample_rate = 44100
    recording = sd.rec(
        int(duration_sec * sample_rate), samplerate=sample_rate, channels=1,
        device=device_id, dtype="float32",
    )
    sd.wait()
    samples = recording.flatten()

    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    rms_db = 20 * np.log10(rms) if rms > 0 else -120.0
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0

    return {
        "rms_db": round(rms_db, 1),
        "clipping": peak >= 0.99,
        "silent": rms_db < -50.0,
    }
