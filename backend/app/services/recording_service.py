
import contextlib
import json
import logging
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import config
import models
from AI.utils.numeric import clamp01
from app import repositories
from app.services import song_artifacts, song_service
from app.services.db_utils import commit_refresh
from app.services.microphone_quality import StudioMicrophoneProcessor
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
        playback_latency_sec: float = 0,
        blocksize: int = 64,
        music_gain: float = 1.0,
        effects: dict[str, float] | None = None,
        noise_suppression: float = 0.35,
        latency: str | float = "low",
    ):
        self.session_id = session_id
        self.song_id = song_id
        self.sample_rate = sample_rate
        self.channels = channels
        self.gain = max(0.0, min(4.0, gain))
        self.music_gain = clamp01(music_gain)
        self.effects = {
            name: clamp01(float((effects or {}).get(name, 0.0)))
            for name in ("reverb", "echo", "delay")
        }
        self.playback_latency_sec = max(0.0, min(1.0, float(playback_latency_sec)))
        self.playback_offset_sec = max(0.0, float(playback_offset_sec)) - self.playback_latency_sec
        self._max_frames = int(round(sample_rate * config.MAX_RECORDING_DURATION_SECONDS))
        self.limit_reached = threading.Event()
        # Bounded so a stalled/dead writer can't make the audio callback pile up
        # unbounded RAM forever; ~2000 blocks is several seconds of headroom at
        # the small blocksizes this session uses, generous enough to absorb a
        # transient write hiccup without ever growing without limit.
        self._queue: queue.Queue[Any] = queue.Queue(maxsize=2000)
        self._writer_ready = threading.Event()
        self._writer_thread: threading.Thread | None = None
        self._writer_error: BaseException | None = None
        self._temporary_path: Path | None = None
        self._frames_written = 0
        self._timeline_frames = 0
        self._timeline_lock = threading.Lock()
        self._last_capture_end_clock: float | None = None
        self._playback_segments: list[dict[str, float]] = []
        self._active_playback_segment: dict[str, float] | None = None
        self._closed = False
        self._paused = False
        self._monitoring_enabled = monitoring_enabled
        self.noise_suppression = clamp01(noise_suppression)
        self._quality = StudioMicrophoneProcessor(sample_rate, channels)
        if monitoring_enabled:
            output_info = (
                sd.query_devices(output_device_id, kind="output")
                if output_device_id is not None
                else sd.query_devices(kind="output")
            )
            output_channels = min(2, int(output_info["max_output_channels"]))
            if output_channels < 1: raise RuntimeError("No output device is available for microphone monitoring")
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

    @staticmethod
    def _capture_end_clock(time_info: object, duration: float) -> float | None:
        try:
            adc_time = float(time_info.inputBufferAdcTime)
        except (AttributeError, TypeError, ValueError):
            return None
        return adc_time + duration

    def _enqueue(self, chunk, time_info=None) -> bool:
        if self._writer_error is not None: return False  # writer already died; stop feeding a dead consumer
        # Drop the frame rather than block the real-time audio thread.
        try:
            self._queue.put_nowait(chunk)
        except queue.Full:
            return False
        capture_end = self._capture_end_clock(
            time_info,
            len(chunk) / float(self.sample_rate) if self.sample_rate else 0.0,
        )
        with self._timeline_lock:
            self._timeline_frames += len(chunk)
            self._last_capture_end_clock = capture_end
        return True

    def _callback(self, indata, frames, time_info, status):  # noqa: ARG002
        if not self._paused:
            self._enqueue(
                self._quality.process(indata, self.gain, self.noise_suppression).copy(),
                time_info,
            )

    def _monitoring_callback(self, indata, outdata, frames, time_info, status):  # noqa: ARG002
        processed = self._quality.process(indata, self.gain, self.noise_suppression)
        if not self._paused: self._enqueue(processed.copy(), time_info)
        outdata.fill(0)
        if self._monitoring_enabled:
            for channel in range(outdata.shape[1]): outdata[:, channel] = processed[:, 0]

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
                    if chunk is self._WRITER_STOP: break
                    output.write(chunk)
                    self._frames_written += len(chunk)
                    if self._frames_written >= self._max_frames:
                        self.limit_reached.set()
                        break
        except BaseException as exc:  # Store library/thread errors for the API thread.
            logger.error(
                "Recording writer failed: session_id=%s song_id=%s frames_written=%d "
                "queue_size=%d path=%s error=%s",
                self.session_id, self.song_id, self._frames_written,
                self._queue.qsize(), self._temporary_path, exc,
            )
            self._writer_error = exc
            self._writer_ready.set()

    def _start_writer(self) -> None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(
            prefix="karaoke-recording-",
            suffix=".wav",
            dir=config.CACHE_DIR,
        )
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
        if thread is None: return
        if thread.is_alive():
            self._queue.put(self._WRITER_STOP)
            # Bounded: a stuck writer (e.g. a slow/failing disk) must not hang
            # app shutdown indefinitely -- see close_all_sessions() below.
            thread.join(timeout=5.0)
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
        self._paused = True
        self._close_playback_segment()
        with self._timeline_lock: self._last_capture_end_clock = None

    def resume(self) -> None:
        with self._timeline_lock: self._last_capture_end_clock = None
        self._paused = False

    def _timeline_time(self) -> float:
        with self._timeline_lock:
            frames, capture_end = self._timeline_frames, self._last_capture_end_clock
        timeline = frames / float(self.sample_rate) if self.sample_rate else 0.0
        if capture_end is None: return timeline
        try:
            stream_time = float(self._stream.time)
        except (AttributeError, TypeError, ValueError):
            return timeline
        # PortAudio's ADC clock describes when the most recent input buffer was
        # physically captured. Add only the small not-yet-delivered interval so
        # a playback anchor refers to "now", rather than one input buffer ago.
        pending = max(0.0, min(0.25, stream_time - capture_end))
        return timeline + pending

    def _close_playback_segment(self) -> None:
        segment = self._active_playback_segment
        if segment is None: return
        segment["end_recording_sec"] = self._timeline_time()
        self._active_playback_segment = None

    def sync_playback(self, position_sec: float) -> None:
        """Anchor the instrumental timeline to the microphone frame heard now."""
        if self._closed: raise RuntimeError("Recording session is already closed")
        if self._paused: raise RuntimeError("Recording session is paused")
        self._close_playback_segment()
        segment = {
            "start_recording_sec": self._timeline_time(),
            # HTMLMediaElement.currentTime is ahead of what reaches the user's
            # ears by the configured Windows/output-buffer latency. Anchor the
            # take to the audible position, including a negative value at the
            # very start so the final mix can delay the instrumental instead.
            "start_playback_sec": float(position_sec) - self.playback_latency_sec,
        }
        self._playback_segments.append(segment)
        self._active_playback_segment = segment

    @property
    def playback_segments(self) -> list[dict[str, float]]:
        return [dict(segment) for segment in self._playback_segments]

    def close(self) -> None:
        if self._closed: return
        self._closed = True
        with contextlib.suppress(Exception): self._stream.close()
        self._stop_writer()
        self._cleanup_temporary_file()

    def stop_and_save(self, out_path: Path) -> tuple[float, int]:
        if self._closed: raise RuntimeError("Recording session is already closed")
        self._paused = True
        self._close_playback_segment()
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
            logger.error(
                "Recording device failed to stop: session_id=%s song_id=%s error=%s",
                self.session_id, self.song_id, stream_error,
            )
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not stop recording stream: {stream_error}") from stream_error
        if self._writer_error is not None:
            error = self._writer_error
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not write recording: {error}") from error
        if self._temporary_path is None: raise RuntimeError("Recording file was not initialized")

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
_completed_recordings: dict[str, str] = {}
_sessions_lock = threading.Lock()
_COMPLETED_RECORDING_LIMIT = 64


def _capture_attempts(
    device_id: int | None,
    output_device_id: int | None,
    sample_rate: int,
    blocksize: int,
    monitoring_enabled: bool,
) -> list[tuple[int | None, int | None, int, int, bool, str]]:
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
    return list(dict.fromkeys(attempts))


def backend_available() -> tuple[bool, str | None]: return (_AUDIO_BACKEND_AVAILABLE, _AUDIO_BACKEND_ERROR)


def start_recording(
    song_id: str,
    device_id: int | None = None,
    output_device_id: int | None = None,
    sample_rate: int = config.RECORDING_SAMPLE_RATE,
    channels: int = config.RECORDING_CHANNELS,
    gain: float = 1.0,
    monitoring_enabled: bool = False,
    playback_offset_sec: float = 0,
    playback_latency_sec: float = 0,
    blocksize: int = 64,
    music_gain: float = 1.0,
    effects: dict[str, float] | None = None,
    noise_suppression: float = 0.35,
) -> str:
    if not _AUDIO_BACKEND_AVAILABLE: raise RuntimeError(f"Аудио-бэкенд недоступен: {_AUDIO_BACKEND_ERROR}")

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
                playback_latency_sec,
                frames,
                music_gain,
                effects,
                noise_suppression,
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
                with contextlib.suppress(Exception): session.close()
            session = None
    if session is None:
        detail = errors[-1] if errors else "no compatible capture mode"
        raise RuntimeError(f"Could not start recording stream: {detail}")
    with _sessions_lock: _sessions[session_id] = session
    threading.Thread(
        target=_finalize_on_duration_limit,
        args=(session_id, session),
        daemon=True,
    ).start()
    return session_id


def _finalize_on_duration_limit(session_id: str, session: RecordingSession) -> None:
    # Test doubles stand in for RecordingSession with a plain Mock, whose
    # .limit_reached is an auto-created Mock rather than a real Event --
    # checking the type (instead of isinstance(session, RecordingSession),
    # which breaks once tests monkeypatch that name to a factory) keeps this
    # watcher a no-op against anything that isn't a real recording session.
    if not isinstance(session.limit_reached, threading.Event): return
    session.limit_reached.wait()
    with _sessions_lock:
        still_active = _sessions.get(session_id) is session
    if not still_active: return  # user already stopped it themselves
    with contextlib.suppress(KeyError, ValueError, RuntimeError, OSError):
        stop_recording(session_id)


def _require_session(session_id: str) -> RecordingSession:
    with _sessions_lock: session = _sessions.get(session_id)
    if session is None: raise KeyError(f"Recording session {session_id} was not found")
    return session


def has_active_recording(song_id: object) -> bool:
    key = str(song_id)
    with _sessions_lock: return any(str(session.song_id) == key for session in _sessions.values())


def close_sessions_for_song(song_id: object) -> None:
    key = str(song_id)
    with _sessions_lock:
        sessions = [
            _sessions.pop(session_id)
            for session_id, session in tuple(_sessions.items())
            if str(session.song_id) == key
        ]
    for session in sessions:
        with contextlib.suppress(Exception): session.close()


def close_all_sessions() -> None:
    with _sessions_lock:
        sessions = tuple(_sessions.values())
        _sessions.clear()
    for session in sessions:
        with contextlib.suppress(Exception): session.close()


def pause_recording(session_id: str) -> None: _require_session(session_id).pause()


def resume_recording(session_id: str) -> None: _require_session(session_id).resume()


def sync_recording(session_id: str, position_sec: float) -> None:
    _require_session(session_id).sync_playback(position_sec)


def stop_recording(session_id: str) -> models.Recording:
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
        completed_id = _completed_recordings.get(session_id)
    if session is None:
        if completed_id is None:
            raise KeyError(f"Сессия записи {session_id} не найдена (уже остановлена?)")
        db = SessionLocal()
        try:
            recording = repositories.get_recording(db, completed_id)
            if recording is None:
                with _sessions_lock: _completed_recordings.pop(session_id, None)
                raise KeyError(f"Сессия записи {session_id} не найдена (уже остановлена?)")
            return recording
        finally:
            db.close()

    db = SessionLocal()
    try:
        song = repositories.get_song(db, session.song_id)
        if song is None: raise ValueError(f"Песня {session.song_id} не найдена")

        out_dir = song_service.resolve_output_dir(song) / config.RECORDINGS_DIRNAME
        out_dir.mkdir(parents=True, exist_ok=True)

        filename = f"take-{uuid.uuid4().hex[:8]}.wav"
        out_path = out_dir / filename
        try:
            duration_sec, sample_rate = session.stop_and_save(out_path)
            playback_segments = session.playback_segments
            first_segment = playback_segments[0] if playback_segments else None
            playback_offset = (
                float(first_segment["start_playback_sec"])
                - float(first_segment["start_recording_sec"])
                if first_segment else session.playback_offset_sec
            )
            recording = models.Recording(
                song_id=song.id,
                filename=filename,
                path=str(out_path),
                duration_sec=duration_sec,
                sample_rate=sample_rate,
                playback_offset_sec=playback_offset,
                playback_segments_json=(
                    json.dumps(playback_segments, separators=(",", ":"))
                    if playback_segments else None
                ),
            )
            db.add(recording)
            commit_refresh(db, recording)
        except Exception:
            db.rollback()
            out_path.unlink(missing_ok=True)
            raise
        _create_performance_mix_safely(
            recording,
            song,
            playback_offset,
            session.music_gain,
            session.effects,
            playback_segments,
        )
        if recording.id:
            with _sessions_lock:
                _completed_recordings[session_id] = str(recording.id)
                while len(_completed_recordings) > _COMPLETED_RECORDING_LIMIT:
                    _completed_recordings.pop(next(iter(_completed_recordings)))
        return recording
    finally:
        session.close()
        db.close()


def resolve_recording_path(recording: models.Recording) -> Path:
    try:
        return song_service.resolve_library_path(Path(recording.path))
    except ValueError as exc:
        raise ValueError("Recording path is outside the application library") from exc



def delete_recording(db, recording: models.Recording) -> None: delete_with_files(db, recording, existing_unique_paths((resolve_recording_path(recording), *performance_mix_paths(recording))))


def performance_mix_path(recording: models.Recording) -> Path:
    voice_path = resolve_recording_path(recording)
    return voice_path.with_name(f"{voice_path.stem}-performance.mp3")


def performance_mix_paths(recording: models.Recording) -> tuple[Path, Path]:
    voice_path = resolve_recording_path(recording)
    return performance_mix_path(recording), voice_path.with_name(
        f"{voice_path.stem}-performance.wav"
    )


def _find_instrumental(song_dir: Path) -> Path | None: return song_artifacts.resolve_audio_artifact(song_dir, 'instrumental')


def _effect_filter(name: str, amount: float, source: str, target: str) -> str | None:
    amount = clamp01(float(amount))
    if amount < 0.01: return None
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
    return f'[{source}]aecho=1.0:1.0:{int(110 + amount * 390)}:{0.16 + amount * 0.34:.3f}[{target}]' if name == 'delay' else None


def _performance_mix_command(
    ffmpeg: str,
    recording: models.Recording,
    instrumental: Path,
    destination: Path,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None,
    playback_segments: list[dict[str, float]] | None = None,
) -> list[str]:
    valid_segments = []
    for segment in playback_segments or []:
        start = max(0.0, float(segment.get("start_recording_sec", 0)))
        end = min(float(recording.duration_sec or 0), float(segment.get("end_recording_sec", start)))
        if end - start >= 0.001:
            valid_segments.append((start, float(segment.get("start_playback_sec", 0)), end - start))

    if valid_segments:
        inputs = ['-i', str(instrumental), '-i', recording.path]
        filters = []
        music_labels = []
        for index, (recording_start, playback_start, duration) in enumerate(valid_segments):
            label = f"music{index}"
            audible_start = max(0.0, playback_start)
            delay_ms = round((recording_start + max(0.0, -playback_start)) * 1000)
            filters.append(
                f"[0:a]atrim=start={audible_start:.6f}:duration={duration:.6f},"
                f"asetpts=PTS-STARTPTS,adelay={delay_ms}:all=1,"
                f"volume={music_gain:.6f}[{label}]"
            )
            music_labels.append(label)
        music_label = music_labels[0]
        if len(music_labels) > 1:
            filters.append(
                "".join(f"[{label}]" for label in music_labels)
                + f"amix=inputs={len(music_labels)}:duration=longest:normalize=0[music]"
            )
            music_label = "music"
        filters.append('[1:a]volume=1.000000[performer0]')
    else:
        inputs = ['-ss', f'{offset_sec:.3f}', '-i', str(instrumental), '-i', recording.path]
        filters = [f'[0:a]volume={music_gain:.6f}[music]', '[1:a]volume=1.000000[performer0]']
        music_label = "music"
    performer_label = 'performer0'
    for index, (name, amount) in enumerate((effects or {}).items(), start=1):
        next_label = f"performer{index}"
        effect = _effect_filter(name, amount, performer_label, next_label)
        if effect is None: continue
        filters.append(effect)
        performer_label = next_label
    filters.append(
        f"[{performer_label}]volume=1.650000,alimiter=limit=0.95[performer-final]"
    )
    filters.append(
        f"[{music_label}][performer-final]amix=inputs=2:duration=first:normalize=0,"
        "alimiter=limit=0.95[mix]"
    )
    codec = ["-c:a", "pcm_s24le"] if destination.suffix.casefold() == ".wav" else [
        "-c:a", "libmp3lame", "-b:a", "320k"
    ]
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
        *codec,
        str(destination),
    ]


def _create_performance_mix_safely(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None = None,
    playback_segments: list[dict[str, float]] | None = None,
) -> None:
    try:
        _create_performance_mix(recording, song, offset_sec, music_gain, effects, playback_segments)
    except Exception:  # noqa: BLE001 - the raw take is already committed and must remain usable
        logger.exception("Could not create performance mix for recording %s", recording.id)


def _create_performance_mix(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None = None,
    playback_segments: list[dict[str, float]] | None = None,
) -> None:
    ffmpeg = str(config.FFMPEG_EXE)
    if not song.output_dir: return
    if not Path(ffmpeg).is_file():
        ffmpeg = shutil.which(ffmpeg) or ""
    if not ffmpeg: return
    instrumental = _find_instrumental(song_service.resolve_output_dir(song))
    if instrumental is None: return
    destinations = performance_mix_paths(recording)
    failures: list[str] = []
    for destination in destinations:
        command = _performance_mix_command(
            ffmpeg,
            recording,
            instrumental,
            destination,
            offset_sec,
            music_gain,
            effects,
            playback_segments,
        )
        try:
            subprocess.run(command, capture_output=True, check=True, timeout=90)
            return
        except (OSError, subprocess.SubprocessError) as exc:
            failures.append(f"{destination.suffix}: {exc}")
            destination.unlink(missing_ok=True)
    logger.warning(
        "Could not create performance mix: recording_id=%s attempts=%s",
        recording.id,
        "; ".join(failures),
    )
