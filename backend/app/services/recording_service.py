"""
Запись голоса с микрофона.

Использует sounddevice (PortAudio) для захвата и soundfile для записи в
wav. Обе библиотеки — системные, требуют реальное аудио-устройство, которого
нет в CI/контейнерах, поэтому весь модуль работает через мягкую деградацию:
если PortAudio недоступна, методы кидают понятную ошибку вместо падения
сервера при импорте (см. diagnostics_service, который сообщит об этом
пользователю ещё до попытки записи).
"""

import contextlib
import queue
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

import config
import models
from app.services import song_service
from database import SessionLocal

try:
    import sounddevice as sd
    import soundfile as sf

    _AUDIO_BACKEND_AVAILABLE = True
    _AUDIO_BACKEND_ERROR = None
except Exception as exc:  # noqa: BLE001 — библиотека может быть не установлена или без PortAudio
    _AUDIO_BACKEND_AVAILABLE = False
    _AUDIO_BACKEND_ERROR = str(exc)


class RecordingSession:
    def __init__(
        self,
        session_id: str,
        song_id: str,
        device_id: int | None,
        output_device_id: int | None,
        sample_rate: int,
        channels: int,
        gain: float,
        monitoring_enabled: bool,
        playback_offset_sec: float = 0,
        blocksize: int = 64,
        music_gain: float = 1.0,
    ):
        self.session_id = session_id
        self.song_id = song_id
        self.sample_rate = sample_rate
        self.channels = channels
        self.gain = max(0.0, min(4.0, gain))
        self.music_gain = max(0.0, min(1.0, music_gain))
        self.playback_offset_sec = max(0.0, playback_offset_sec)
        self._queue: queue.Queue = queue.Queue()
        if monitoring_enabled:
            # Use the selected output, not Windows' default device.  With an
            # audio interface those can be different endpoints, which made a
            # live microphone disappear as soon as karaoke recording started.
            output_info = (
                sd.query_devices(output_device_id, kind="output")
                if output_device_id is not None
                else sd.query_devices(kind="output")
            )
            output_channels = min(2, int(output_info["max_output_channels"]))
            if output_channels < 1:
                raise RuntimeError("No output device is available for microphone monitoring")
            self._stream = sd.Stream(
                samplerate=sample_rate,
                channels=(channels, output_channels),
                device=(device_id, output_device_id),
                blocksize=blocksize,
                latency="low",
                callback=self._monitoring_callback,
            )
        else:
            self._stream = sd.InputStream(
                samplerate=sample_rate,
                channels=channels,
                device=device_id,
                blocksize=blocksize,
                latency="low",
                callback=self._callback,
            )
        self._stopped = threading.Event()
        self._frames_written = 0
        self.started_at = time.time()

    def _callback(self, indata, frames, time_info, status):  # noqa: ARG002
        self._queue.put((indata * self.gain).clip(-1.0, 1.0).copy())

    def _monitoring_callback(self, indata, outdata, frames, time_info, status):  # noqa: ARG002
        processed = (indata * self.gain).clip(-1.0, 1.0)
        self._queue.put(processed.copy())
        outdata.fill(0)
        for channel in range(outdata.shape[1]):
            outdata[:, channel] = processed[:, 0]

    def start(self) -> None:
        self._stream.start()

    def pause(self) -> None:
        self._stream.stop()

    def resume(self) -> None:
        self._stream.start()

    def close(self) -> None:
        """Release the device after a failed start without writing a take."""
        self._stream.close()

    def stop_and_save(self, out_path: Path) -> tuple[float, int]:
        self._stream.stop()
        self._stream.close()
        self._stopped.set()

        with sf.SoundFile(
            str(out_path),
            mode="w",
            samplerate=self.sample_rate,
            channels=self.channels,
            subtype="PCM_24",
        ) as f:
            while not self._queue.empty():
                chunk = self._queue.get_nowait()
                f.write(chunk)
                self._frames_written += len(chunk)

        duration_sec = self._frames_written / float(self.sample_rate) if self.sample_rate else 0.0
        return duration_sec, self.sample_rate


_sessions: dict[str, RecordingSession] = {}
_sessions_lock = threading.Lock()


def backend_available() -> tuple[bool, str | None]:
    return _AUDIO_BACKEND_AVAILABLE, _AUDIO_BACKEND_ERROR


def start_recording(
    song_id: str,
    device_id: int | None = None,
    output_device_id: int | None = None,
    sample_rate: int = config.RECORDING_SAMPLE_RATE,
    channels: int = config.RECORDING_CHANNELS,
    gain: float = 1.0,
    monitoring_enabled: bool = False,
    playback_offset_sec: float = 0,
    blocksize: int = 64,
    music_gain: float = 1.0,
) -> str:
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError(f"Аудио-бэкенд недоступен: {_AUDIO_BACKEND_ERROR}")

    session_id = uuid.uuid4().hex
    session: RecordingSession | None = None
    try:
        session = RecordingSession(
            session_id,
            song_id,
            device_id,
            output_device_id,
            sample_rate,
            channels,
            gain,
            monitoring_enabled,
            playback_offset_sec,
            blocksize,
            music_gain,
        )
        session.start()
    except Exception as exc:  # Audio drivers raise implementation-specific errors.
        if session is not None:
            with contextlib.suppress(Exception):
                session.close()
        raise RuntimeError(f"Could not start recording stream: {exc}") from exc
    with _sessions_lock:
        _sessions[session_id] = session
    return session_id


def pause_recording(session_id: str) -> None:
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Recording session {session_id} was not found")
    session.pause()


def resume_recording(session_id: str) -> None:
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Recording session {session_id} was not found")
    session.resume()


def stop_recording(session_id: str) -> models.Recording:
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
    if session is None:
        raise KeyError(f"Сессия записи {session_id} не найдена (уже остановлена?)")

    db = SessionLocal()
    try:
        song = db.query(models.Song).filter(models.Song.id == session.song_id).first()
        if song is None:
            raise ValueError(f"Песня {session.song_id} не найдена")

        out_dir = song_service.resolve_output_dir(song) / config.RECORDINGS_DIRNAME
        out_dir.mkdir(parents=True, exist_ok=True)

        filename = f"take-{uuid.uuid4().hex[:8]}.wav"
        out_path = out_dir / filename
        try:
            duration_sec, sample_rate = session.stop_and_save(out_path)
            recording = models.Recording(
                song_id=song.id,
                filename=filename,
                path=str(out_path),
                duration_sec=duration_sec,
                sample_rate=sample_rate,
            )
            db.add(recording)
            db.commit()
            db.refresh(recording)
        except Exception:
            # Saving audio and its database record is one operation from the
            # user's perspective. Remove a partial/orphaned take on failure.
            db.rollback()
            out_path.unlink(missing_ok=True)
            raise
        _create_performance_mix(
            recording,
            song,
            session.playback_offset_sec,
            session.music_gain,
        )
        return recording
    finally:
        db.close()


def delete_recording(db, recording: models.Recording) -> None:
    path = Path(recording.path)
    if path.exists():
        path.unlink()
    for mixed_path in performance_mix_paths(recording):
        mixed_path.unlink(missing_ok=True)
    db.delete(recording)
    db.commit()


def performance_mix_path(recording: models.Recording) -> Path:
    voice_path = Path(recording.path)
    return voice_path.with_name(f"{voice_path.stem}-performance.wav")


def performance_mix_paths(recording: models.Recording) -> tuple[Path, Path]:
    """Return the lossless mix path followed by the legacy MP3 path."""
    voice_path = Path(recording.path)
    return performance_mix_path(recording), voice_path.with_name(
        f"{voice_path.stem}-performance.mp3"
    )


def _create_performance_mix(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
) -> None:
    """Create a lossless take from the backing track and recorded microphone."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None or not song.output_dir:
        return
    song_dir = song_service.resolve_output_dir(song)
    instrumental = next(
        (
            song_dir / f"instrumental{extension}"
            for extension in (".mp3", ".wav")
            if (song_dir / f"instrumental{extension}").is_file()
        ),
        None,
    )
    if instrumental is None:
        return
    destination = performance_mix_path(recording)
    inputs = ["-ss", f"{offset_sec:.3f}", "-i", str(instrumental)]
    filters = [f"[0:a]volume={music_gain:.6f}[music]"]
    mix_labels = ["[music]"]
    inputs.extend(["-i", recording.path])
    filters.append("[1:a]volume=1.000000[performer]")
    mix_labels.append("[performer]")
    filters.append(
        f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:normalize=0,"
        "alimiter=limit=0.95[mix]",
    )
    command = [
        ffmpeg,
        "-y",
        *inputs,
        "-t",
        f"{recording.duration_sec or 0:.3f}",
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[mix]",
        "-c:a",
        "pcm_s24le",
        str(destination),
    ]
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=90)
    except (OSError, subprocess.SubprocessError):
        destination.unlink(missing_ok=True)
