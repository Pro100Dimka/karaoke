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
import logging
import os
import queue
import shutil
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import uuid
from pathlib import Path
from typing import Any

import config
import models
from app import repositories
from app.services import song_service
from app.services.db_utils import commit_refresh
from app.services.resource_deletion import delete_with_files
from app.utils.quarantine import existing_unique_paths
from database import SessionLocal

logger = logging.getLogger(__name__)

try:
    import sounddevice as sd
    import soundfile as sf

    _AUDIO_BACKEND_AVAILABLE = True
    _AUDIO_BACKEND_ERROR = None
except Exception as exc:  # noqa: BLE001 — библиотека может быть не установлена или без PortAudio
    # Keep patchable module attributes for unit tests and diagnostics even when
    # PortAudio is absent in the current environment. Production entrypoints
    # still reject recording through _AUDIO_BACKEND_AVAILABLE below.
    sd = SimpleNamespace(InputStream=None, Stream=None, query_devices=None)
    sf = SimpleNamespace(SoundFile=None)
    _AUDIO_BACKEND_AVAILABLE = False
    _AUDIO_BACKEND_ERROR = str(exc)


class RecordingSession:
    _WRITER_STOP = object()

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
        effects: dict[str, float] | None = None,
        latency: str | float = "low",
    ):
        self.session_id = session_id
        self.song_id = song_id
        self.sample_rate = sample_rate
        self.channels = channels
        self.gain = max(0.0, min(4.0, gain))
        self.music_gain = max(0.0, min(1.0, music_gain))
        self.effects = {
            name: max(0.0, min(1.0, float((effects or {}).get(name, 0.0))))
            for name in ("reverb", "echo", "delay")
        }
        self.playback_offset_sec = max(0.0, playback_offset_sec)
        self._queue: queue.Queue[Any] = queue.Queue()
        self._writer_ready = threading.Event()
        self._writer_thread: threading.Thread | None = None
        self._writer_error: BaseException | None = None
        self._temporary_path: Path | None = None
        self._frames_written = 0
        self._closed = False
        self._paused = False
        self._monitoring_enabled = monitoring_enabled
        if monitoring_enabled:
            # Use the selected output, not Windows' default device. With an
            # audio interface those can be different endpoints.
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
                latency=latency,
                callback=self._monitoring_callback,
            )
        else:
            self._stream = sd.InputStream(
                samplerate=sample_rate,
                channels=channels,
                device=device_id,
                blocksize=blocksize,
                latency=latency,
                callback=self._callback,
            )

    def _callback(self, indata, frames, time_info, status):  # noqa: ARG002
        if not self._paused:
            self._queue.put((indata * self.gain).clip(-1.0, 1.0).copy())

    def _monitoring_callback(self, indata, outdata, frames, time_info, status):  # noqa: ARG002
        processed = (indata * self.gain).clip(-1.0, 1.0)
        if not self._paused:
            self._queue.put(processed.copy())
        outdata.fill(0)
        if self._monitoring_enabled:
            for channel in range(outdata.shape[1]):
                outdata[:, channel] = processed[:, 0]

    def _write_audio(self) -> None:
        assert self._temporary_path is not None
        try:
            with sf.SoundFile(
                str(self._temporary_path),
                mode="w",
                samplerate=self.sample_rate,
                channels=self.channels,
                subtype="PCM_24",
            ) as output:
                self._writer_ready.set()
                while True:
                    chunk = self._queue.get()
                    if chunk is self._WRITER_STOP:
                        break
                    output.write(chunk)
                    self._frames_written += len(chunk)
        except BaseException as exc:  # Store library/thread errors for the API thread.
            self._writer_error = exc
            self._writer_ready.set()

    def _start_writer(self) -> None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(
            prefix="karaoke-recording-",
            suffix=".wav",
            dir=config.CACHE_DIR,
        )
        # SoundFile reopens the path itself; do not leak the mkstemp descriptor.
        os.close(descriptor)
        self._temporary_path = Path(name)
        self._writer_thread = threading.Thread(
            target=self._write_audio,
            name=f"recording-writer-{self.session_id[:8]}",
            daemon=True,
        )
        self._writer_thread.start()
        self._writer_ready.wait()
        if self._writer_error is not None:
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not prepare recording file: {self._writer_error}")

    def _stop_writer(self) -> None:
        thread = self._writer_thread
        if thread is None:
            return
        if thread.is_alive():
            self._queue.put(self._WRITER_STOP)
            thread.join()
        self._writer_thread = None

    def _cleanup_temporary_file(self) -> None:
        if self._temporary_path is not None:
            self._temporary_path.unlink(missing_ok=True)
            self._temporary_path = None

    def start(self) -> None:
        self._start_writer()
        try:
            self._stream.start()
        except Exception:
            self._stop_writer()
            self._cleanup_temporary_file()
            raise

    def pause(self) -> None:
        # Keep PortAudio/ASIO open. Reopening a stream on resume is unreliable on
        # several Windows drivers and caused sporadic 500 responses.
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def close(self) -> None:
        """Release the device and temporary recording after a failed start."""
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(Exception):
            self._stream.close()
        self._stop_writer()
        self._cleanup_temporary_file()

    def stop_and_save(self, out_path: Path) -> tuple[float, int]:
        if self._closed:
            raise RuntimeError("Recording session is already closed")
        self._closed = True
        stream_error: BaseException | None = None
        try:
            self._stream.stop()
            self._stream.close()
        except BaseException as exc:
            stream_error = exc
        finally:
            self._stop_writer()

        if stream_error is not None:
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not stop recording stream: {stream_error}") from stream_error
        if self._writer_error is not None:
            error = self._writer_error
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not write recording: {error}") from error
        if self._temporary_path is None:
            raise RuntimeError("Recording file was not initialized")

        out_path.parent.mkdir(parents=True, exist_ok=True)
        publish_path = out_path.with_name(f".{out_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            shutil.copyfile(self._temporary_path, publish_path)
            os.replace(publish_path, out_path)
        finally:
            publish_path.unlink(missing_ok=True)
        self._temporary_path.unlink(missing_ok=True)
        self._temporary_path = None
        duration_sec = self._frames_written / float(self.sample_rate) if self.sample_rate else 0.0
        return duration_sec, self.sample_rate


_sessions: dict[str, RecordingSession] = {}
_sessions_lock = threading.Lock()


def _capture_attempts(
    device_id: int | None,
    output_device_id: int | None,
    sample_rate: int,
    blocksize: int,
    monitoring_enabled: bool,
) -> list[tuple[int | None, int | None, int, int, bool, str]]:
    """Build conservative fallbacks for Windows drivers with incomplete PortAudio support."""
    attempts = [
        (device_id, output_device_id, sample_rate, blocksize, monitoring_enabled, "low"),
        (device_id, None, sample_rate, 0, False, "high"),
    ]
    with contextlib.suppress(Exception):
        info = sd.query_devices(device_id, kind="input") if device_id is not None else None
        if info:
            attempts.append(
                (device_id, None, int(round(float(info["default_samplerate"]))), 0, False, "high")
            )
    with contextlib.suppress(Exception):
        default_info = sd.query_devices(kind="input")
        attempts.append(
            (None, None, int(round(float(default_info["default_samplerate"]))), 0, False, "high")
        )
    attempts.append((None, None, sample_rate, 0, False, "high"))
    unique: list[tuple[int | None, int | None, int, int, bool, str]] = []
    for attempt in attempts:
        if attempt not in unique:
            unique.append(attempt)
    return unique


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
    effects: dict[str, float] | None = None,
) -> str:
    if not _AUDIO_BACKEND_AVAILABLE:
        raise RuntimeError(f"Аудио-бэкенд недоступен: {_AUDIO_BACKEND_ERROR}")

    session_id = uuid.uuid4().hex
    session: RecordingSession | None = None
    errors: list[str] = []
    for input_id, output_id, rate, frames, monitor, latency in _capture_attempts(
        device_id, output_device_id, sample_rate, blocksize, monitoring_enabled
    ):
        try:
            session = RecordingSession(
                session_id,
                song_id,
                input_id,
                output_id,
                rate,
                channels,
                gain,
                monitor,
                playback_offset_sec,
                frames,
                music_gain,
                effects,
                latency,
            )
            session.start()
            if errors:
                logger.warning(
                    "Recording started with a compatibility fallback after: %s", errors[-1]
                )
            break
        except Exception as exc:  # Audio drivers raise implementation-specific errors.
            errors.append(str(exc))
            if session is not None:
                with contextlib.suppress(Exception):
                    session.close()
            session = None
    if session is None:
        detail = errors[-1] if errors else "no compatible capture mode"
        raise RuntimeError(f"Could not start recording stream: {detail}")
    with _sessions_lock:
        _sessions[session_id] = session
    return session_id


def _require_session(session_id: str) -> RecordingSession:
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Recording session {session_id} was not found")
    return session


def close_all_sessions() -> None:
    """Release all active recording devices during application shutdown."""
    with _sessions_lock:
        sessions = tuple(_sessions.values())
        _sessions.clear()
    for session in sessions:
        with contextlib.suppress(Exception):
            session.close()


def pause_recording(session_id: str) -> None:
    _require_session(session_id).pause()


def resume_recording(session_id: str) -> None:
    _require_session(session_id).resume()


def stop_recording(session_id: str) -> models.Recording:
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
    if session is None:
        raise KeyError(f"Сессия записи {session_id} не найдена (уже остановлена?)")

    db = SessionLocal()
    try:
        song = repositories.get_song(db, session.song_id)
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
            commit_refresh(db, recording)
        except Exception:
            # Saving audio and its database record is one operation from the
            # user's perspective. Remove a partial/orphaned take on failure.
            db.rollback()
            out_path.unlink(missing_ok=True)
            raise
        _create_performance_mix_safely(
            recording,
            song,
            session.playback_offset_sec,
            session.music_gain,
            session.effects,
        )
        return recording
    finally:
        # A claimed session must never keep the audio device or temporary file
        # alive, including failures before stop_and_save() is reached.
        session.close()
        db.close()


def resolve_recording_path(recording: models.Recording) -> Path:
    """Resolve a persisted take path and reject paths outside the song library."""
    path = Path(recording.path).resolve()
    root = config.SONG_OUTPUT_DIR.resolve()
    if root not in path.parents:
        raise ValueError("Recording path is outside the application library")
    return path


def _existing_recording_files(recording: models.Recording) -> tuple[Path, ...]:
    return existing_unique_paths(
        (resolve_recording_path(recording), *performance_mix_paths(recording))
    )


def delete_recording(db, recording: models.Recording) -> None:
    delete_with_files(db, recording, _existing_recording_files(recording))


def performance_mix_path(recording: models.Recording) -> Path:
    voice_path = resolve_recording_path(recording)
    return voice_path.with_name(f"{voice_path.stem}-performance.mp3")


def performance_mix_paths(recording: models.Recording) -> tuple[Path, Path]:
    """Return the current MP3 mix followed by the prior lossless file."""
    voice_path = resolve_recording_path(recording)
    return performance_mix_path(recording), voice_path.with_name(
        f"{voice_path.stem}-performance.wav"
    )


def _find_instrumental(song_dir: Path) -> Path | None:
    return next(
        (
            song_dir / f"instrumental{extension}"
            for extension in (".mp3", ".wav")
            if (song_dir / f"instrumental{extension}").is_file()
        ),
        None,
    )


def _effect_filter(name: str, amount: float, source: str, target: str) -> str | None:
    amount = max(0.0, min(1.0, float(amount)))
    if amount < 0.01:
        return None
    if name == "reverb":
        return (
            f"[{source}]aecho=1.0:1.0:55|110|170:"
            f"{0.20 + amount * 0.24:.3f}|{0.14 + amount * 0.18:.3f}|"
            f"{0.08 + amount * 0.14:.3f}[{target}]"
        )
    if name == "echo":
        return (
            f"[{source}]aecho=1.0:1.0:180|360:"
            f"{0.18 + amount * 0.38:.3f}|{0.10 + amount * 0.22:.3f}[{target}]"
        )
    if name == "delay":
        return (
            f"[{source}]aecho=1.0:1.0:{int(110 + amount * 390)}:"
            f"{0.16 + amount * 0.34:.3f}[{target}]"
        )
    return None


def _performance_mix_command(
    ffmpeg: str,
    recording: models.Recording,
    instrumental: Path,
    destination: Path,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None,
) -> list[str]:
    inputs = ["-ss", f"{offset_sec:.3f}", "-i", str(instrumental), "-i", recording.path]
    filters = [f"[0:a]volume={music_gain:.6f}[music]", "[1:a]volume=1.000000[performer0]"]
    performer_label = "performer0"
    for index, (name, amount) in enumerate((effects or {}).items(), start=1):
        next_label = f"performer{index}"
        effect = _effect_filter(name, amount, performer_label, next_label)
        if effect is None:
            continue
        filters.append(effect)
        performer_label = next_label
    filters.append(
        f"[music][{performer_label}]amix=inputs=2:duration=first:normalize=0,"
        "alimiter=limit=0.95[mix]"
    )
    return [
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
        "libmp3lame",
        "-b:a",
        "320k",
        str(destination),
    ]


def _create_performance_mix_safely(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None = None,
) -> None:
    """Create the optional mix without invalidating a saved recording."""
    try:
        _create_performance_mix(recording, song, offset_sec, music_gain, effects)
    except Exception:  # noqa: BLE001 - the raw take is already committed and must remain usable
        logger.exception("Could not create performance mix for recording %s", recording.id)


def _create_performance_mix(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None = None,
) -> None:
    """Create a high-quality MP3 take from backing track and microphone only."""
    ffmpeg = config.FFMPEG_EXE
    if (ffmpeg == "ffmpeg" and not Path(ffmpeg).is_file()) or not song.output_dir:
        return
    instrumental = _find_instrumental(song_service.resolve_output_dir(song))
    if instrumental is None:
        return
    destination = performance_mix_path(recording)
    command = _performance_mix_command(
        ffmpeg,
        recording,
        instrumental,
        destination,
        offset_sec,
        music_gain,
        effects,
    )
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=90)
    except (OSError, subprocess.SubprocessError):
        destination.unlink(missing_ok=True)
