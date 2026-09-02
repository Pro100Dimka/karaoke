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
from app.services import song_artifacts, song_service, storage_budget_service
from app.services.audio_runtime import hardware_lock, serialized
from app.services.db_utils import commit_refresh
from app.services.microphone_quality import (
    MonitorEffectsChain,
    RealtimePitchShifter,
    StudioMicrophoneProcessor,
)
from app.services.resource_deletion import delete_with_files
from app.utils.quarantine import existing_unique_paths
from database import SessionLocal

logger = logging.getLogger(__name__)


def _playback_rate(value: object) -> float:
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return 1.0
    if rate != rate:
        return 1.0
    return max(0.5, min(1.5, rate))

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


class RecordingOverflowError(RuntimeError):
    """The realtime callback could not hand captured audio to the writer."""

    def __init__(self, dropped_blocks: int, dropped_frames: int):
        self.dropped_blocks = dropped_blocks
        self.dropped_frames = dropped_frames
        super().__init__(
            "Recording is incomplete because the audio writer could not keep up "
            f"(dropped blocks: {dropped_blocks}, dropped frames: {dropped_frames})"
        )


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
        playback_rate: float = 1,
        blocksize: int = 64,
        music_gain: float = 1.0,
        effects: dict[str, float] | None = None,
        noise_suppression: float = 0.35,
        latency: str | float = "low",
        monitor_mode: str | None = None,
        monitor_owner: str = "recording",
        storage_reservations: list[storage_budget_service.Reservation] | None = None,
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
        self.effects["octave"] = max(-1.0, min(1.0, float((effects or {}).get("octave", 0.0))))
        self.playback_rate = _playback_rate(playback_rate)
        self.playback_offset_sec = max(0.0, float(playback_offset_sec))
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
        self._overflow_error: RecordingOverflowError | None = None
        self._dropped_blocks = 0
        self._dropped_frames = 0
        self._temporary_path: Path | None = None
        self._frames_written = 0
        self._timeline_frames = 0
        self._timeline_lock = threading.Lock()
        self._last_capture_end_clock: float | None = None
        self._playback_segments: list[dict[str, float]] = []
        self._active_playback_segment: dict[str, float] | None = None
        self._closed = False
        self._paused = False
        self._stop_lock = threading.Lock()
        self._monitoring_enabled = monitoring_enabled
        self._monitor_owner = monitor_owner
        self._monitor_mode = monitor_mode
        self._monitor_effects_disabled = False
        self._capture_stopped = False
        self._capture_error = None
        self._storage_reservations = storage_reservations or []
        self._signal = {"rms_db": -120.0, "clipping": False, "silent": True}
        self.noise_suppression = clamp01(noise_suppression)
        self._quality = StudioMicrophoneProcessor(sample_rate, channels)
        self._pitch = RealtimePitchShifter(sample_rate)
        self._effects_chain = MonitorEffectsChain(sample_rate)
        extra = {}
        if monitor_mode not in {None, "plain", "shared"}:
            raise RuntimeError("Only shared microphone monitoring is supported")
        if monitor_mode == "shared":
            extra["extra_settings"] = (
                sd.WasapiSettings(exclusive=False, auto_convert=True),
                sd.WasapiSettings(exclusive=False, auto_convert=True),
            )
        if monitoring_enabled or (monitor_owner == "recording" and monitor_mode is not None):
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
                **extra,
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
        # Some Windows/ASIO drivers negotiate a different hardware rate than
        # the stale value PortAudio advertised during device enumeration. The
        # stream knows the rate it actually opened with; stamp the WAV and all
        # timeline/DSP state with that value or the voice plays too fast/slow.
        try:
            negotiated_rate = float(self._stream.samplerate)
        except (AttributeError, TypeError, ValueError):
            negotiated_rate = float(sample_rate)
        if 8_000 <= negotiated_rate <= 384_000:
            self.sample_rate = int(round(negotiated_rate))
            self._max_frames = int(
                round(self.sample_rate * config.MAX_RECORDING_DURATION_SECONDS)
            )
            self._quality = StudioMicrophoneProcessor(self.sample_rate, channels)
            self._pitch = RealtimePitchShifter(self.sample_rate)
            self._effects_chain = MonitorEffectsChain(self.sample_rate)

    @staticmethod
    def _capture_end_clock(time_info: object, duration: float) -> float | None:
        try:
            field = "inputBufferAdcTime"
            adc_time = float(getattr(time_info, field))
        except (AttributeError, TypeError, ValueError):
            return None
        return adc_time + duration

    def _enqueue(self, chunk, time_info=None) -> bool:
        if self._writer_error is not None: return False  # writer already died; stop feeding a dead consumer
        if self._overflow_error is not None:
            self._mark_overflow(len(chunk))
            return False
        # Drop the frame rather than block the real-time audio thread.
        try:
            self._queue.put_nowait(chunk)
        except queue.Full:
            self._mark_overflow(len(chunk))
            return False
        capture_end = self._capture_end_clock(
            time_info,
            len(chunk) / float(self.sample_rate) if self.sample_rate else 0.0,
        )
        with self._timeline_lock:
            self._timeline_frames += len(chunk)
            self._last_capture_end_clock = capture_end
        return True

    def _mark_overflow(self, frames: int) -> None:
        self._dropped_blocks += 1
        self._dropped_frames += max(0, int(frames))
        self._overflow_error = RecordingOverflowError(
            self._dropped_blocks,
            self._dropped_frames,
        )
        if self._dropped_blocks == 1:
            logger.error(
                "Recording queue overflow: session_id=%s song_id=%s dropped_blocks=%d "
                "dropped_frames=%d queue_capacity=%d",
                self.session_id,
                self.song_id,
                self._dropped_blocks,
                self._dropped_frames,
                self._queue.maxsize,
            )

    @property
    def overflow_stats(self) -> dict[str, int]:
        return {
            "dropped_blocks": self._dropped_blocks,
            "dropped_frames": self._dropped_frames,
        }

    def _callback(self, indata, frames, time_info, status):  # noqa: ARG002
        try:
            self._update_signal(indata)
            if not self._paused:
                # Persist exactly the frames delivered by the capture driver.
                # Monitoring/voice DSP is intentionally not part of the source
                # take: a processor that buffers or changes its output length
                # would otherwise make the voice play faster or get truncated.
                self._enqueue(indata.copy(), time_info)
        except BaseException as exc:
            self._capture_error = exc

    def _monitoring_callback(self, indata, outdata, frames, time_info, status):  # noqa: ARG002
        outdata.fill(0)
        try:
            self._update_signal(indata)
            # Save the unmodified microphone timeline before any realtime DSP.
            # Effects below are only for what the singer hears; the performance
            # mix applies the chosen settings offline to this lossless source.
            if not self._paused: self._enqueue(indata.copy(), time_info)
            if self._monitoring_enabled:
                processed = self._quality.process(indata, self.gain, self.noise_suppression)
                effects = {} if self._monitor_effects_disabled else self.effects
                monitored = self._pitch.process(processed[:, 0], effects.get("octave", 0))
                monitored = self._effects_chain.process(
                    monitored,
                    *(effects.get(key, 0) for key in ("reverb", "echo", "delay")),
                )
                for channel in range(outdata.shape[1]):
                    outdata[:, channel] = monitored
        except BaseException as exc:
            self._capture_error = exc

    def _update_signal(self, samples):
        import numpy as np
        rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
        self._signal = {"rms_db": round(20 * np.log10(rms), 1) if rms > 0 else -120.0,
                        "clipping": bool(np.any(np.abs(samples) >= .99)), "silent": rms < .0031623}

    def stop_capture(self):
        # Guarded by a lock private to this session, not the global
        # hardware_lock: tearing down a stream this session already owns
        # exclusively never needs to wait behind an unrelated device-open
        # elsewhere (e.g. the ASIO monitor bridge taking up to
        # _MONITOR_START_TIMEOUT_SECONDS to (re)start) -- that contention used
        # to let the real-time queue overflow, and stop_and_save() discards
        # the whole take as corrupt whenever it sees an overflow.
        with self._stop_lock:
            if self._capture_stopped:
                return
            self._capture_stopped = True
            self._monitoring_enabled = False
            try:
                self._stream.stop()
            except BaseException as exc:
                self._capture_error = exc
            finally:
                try:
                    self._stream.close()
                except BaseException as exc:
                    self._capture_error = self._capture_error or exc

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
                    if self._storage_reservations:
                        self._storage_reservations[0].consume(
                            self._frames_written * self.channels * 3
                        )
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
            try:
                self._queue.put_nowait(self._WRITER_STOP)
            except queue.Full:
                # Capture is already stopped. Make room for the terminal marker
                # without ever blocking the realtime/API thread on a stalled disk.
                with contextlib.suppress(queue.Empty):
                    self._queue.get_nowait()
                self._queue.put_nowait(self._WRITER_STOP)
            # Bounded: a stuck writer (e.g. a slow/failing disk) must not hang
            # app shutdown indefinitely -- see close_all_sessions() below.
            thread.join(timeout=5.0)
            if thread.is_alive() and self._writer_error is None:
                self._writer_error = RuntimeError("Timed out stopping recording writer")
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
        # stop_recording releases the device before it finalizes the WAV.
        # Once stopped there are no pending captured samples to extrapolate,
        # and PortAudio no longer provides a valid stream clock.
        if self._capture_stopped or capture_end is None: return timeline
        try:
            stream_time = float(self._stream.time)
        except Exception:  # The optional clock can fail if the device disappears.
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

    def sync_playback(self, position_sec: float, playback_rate: float = 1) -> None:
        """Anchor the instrumental timeline to the microphone frame heard now."""
        if self._closed: raise RuntimeError("Recording session is already closed")
        if self._paused: raise RuntimeError("Recording session is paused")
        self._close_playback_segment()
        self.playback_rate = _playback_rate(playback_rate)
        segment = {
            "start_recording_sec": self._timeline_time(),
            # Preserve the exact media timeline. Monitoring/driver latency is
            # deliberately not injected into the saved performance mix.
            "start_playback_sec": float(position_sec),
        }
        if self.playback_rate != 1:
            segment["playback_rate"] = self.playback_rate
        self._playback_segments.append(segment)
        self._active_playback_segment = segment

    @property
    def playback_segments(self) -> list[dict[str, float]]:
        return [dict(segment) for segment in self._playback_segments]

    def close(self) -> None:
        if self._closed:
            self._release_storage_reservations(self._writer_thread)
            return
        self._closed = True
        writer_thread = self._writer_thread
        try:
            self.stop_capture()
            self._stop_writer()
            self._cleanup_temporary_file()
        finally:
            self._release_storage_reservations(writer_thread)

    def _release_storage_reservations(self, writer_thread: threading.Thread | None) -> None:
        reservations, self._storage_reservations = self._storage_reservations, []
        if not reservations:
            return
        if writer_thread is not None and writer_thread.is_alive():
            # _stop_writer() gave up waiting (a slow/stuck disk) while the
            # writer thread was still flushing bytes. Release the reserved
            # budget only once it actually exits, so a concurrent reservation
            # elsewhere can't treat this space as free while it's still being
            # written to.
            def release_when_done() -> None:
                writer_thread.join()
                storage_budget_service.release_all(reservations)

            threading.Thread(
                target=release_when_done,
                name=f"recording-storage-release-{self.session_id[:8]}",
                daemon=True,
            ).start()
            return
        storage_budget_service.release_all(reservations)

    def stop_and_save(self, out_path: Path) -> tuple[float, int]:
        if self._closed: raise RuntimeError("Recording session is already closed")
        self._paused = True
        self._closed = True
        self.stop_capture()
        self._close_playback_segment()
        stream_error = self._capture_error
        self._stop_writer()

        if self._overflow_error is not None:
            error = self._overflow_error
            logger.error(
                "Discarding incomplete recording: session_id=%s song_id=%s "
                "dropped_blocks=%d dropped_frames=%d frames_written=%d",
                self.session_id,
                self.song_id,
                error.dropped_blocks,
                error.dropped_frames,
                self._frames_written,
            )
            self._cleanup_temporary_file()
            raise error
        if stream_error is not None:
            logger.error(
                "Recording device failed to stop: session_id=%s song_id=%s error=%s",
                self.session_id, self.song_id, stream_error,
            )
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not stop recording stream: {stream_error}") from stream_error
        if self._writer_error is not None:
            writer_error = self._writer_error
            self._cleanup_temporary_file()
            raise RuntimeError(f"Could not write recording: {writer_error}") from writer_error
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
_finalizing_recordings: dict[str, threading.Event] = {}
_sessions_lock = threading.RLock()
_COMPLETED_RECORDING_LIMIT = 64


def update_capture_controls(patch):
    with _sessions_lock:
        for session in _sessions.values():
            if session._closed:
                continue
            if "monitoring_enabled" in patch:
                session._monitoring_enabled = bool(patch["monitoring_enabled"]) and session._monitor_owner == "recording"
            if patch.get("volume") is not None:
                session.gain = max(0, min(4, float(patch["volume"])))
            if patch.get("noise_suppression") is not None:
                session.noise_suppression = clamp01(patch["noise_suppression"])
            session.effects = {**session.effects, **{key: patch[key] for key in ("reverb", "echo", "delay", "octave") if patch.get(key) is not None}}


def update_recording_controls(
    session_id: str,
    *,
    music_gain: float,
    gain: float,
    effects: dict[str, float],
) -> None:
    with _sessions_lock:
        session = _sessions.get(session_id)
        if session is None or getattr(session, "_closed", False):
            raise KeyError(f"Recording session {session_id} was not found")
        session.music_gain = clamp01(music_gain)
        session.gain = max(0.0, min(4.0, float(gain)))
        session.effects = {
            name: (
                max(-1.0, min(1.0, float(effects.get(name, 0.0))))
                if name == "octave"
                else clamp01(float(effects.get(name, 0.0)))
            )
            for name in ("reverb", "echo", "delay", "octave")
        }


def apply_monitor_settings(settings, mode, disabled_effects):
    with _sessions_lock:
        sessions = [session for session in _sessions.values() if not session._closed]
        if not sessions:
            return False
        if any(session._monitor_owner == "room" for session in sessions):
            return True  # Browser room owns monitoring; never open a competing output.
        owned = [session for session in sessions if session._monitor_owner == "recording"]
        for session in owned:
            if settings.monitoring_enabled and session._monitor_mode == "shared" and mode != "shared":
                raise RuntimeError("Stop recording before changing the WASAPI monitoring mode")
            session._monitor_effects_disabled = disabled_effects
        patch = {key: getattr(settings, key, None) for key in ("volume", "noise_suppression", "reverb", "echo", "delay", "octave")}
        patch["monitoring_enabled"] = settings.monitoring_enabled
        update_capture_controls(patch)
        return bool(owned)


def capture_signal():
    with _sessions_lock:
        return next((dict(session._signal) for session in _sessions.values() if not session._closed), None)


def has_live_capture():
    with _sessions_lock:
        return any(not session._closed for session in _sessions.values())


def _capture_blocksize(device_id: int | None, requested: int) -> int:
    """Keep a fixed buffer only when PortAudio itself owns an ASIO stream.

    The application's native ASIO monitor can use a 32/64-frame buffer while
    the parallel recording stream is actually WASAPI. Forcing that tiny ASIO
    buffer onto a shared Windows capture requires hundreds of Python callbacks
    per second; under normal UI load PortAudio then delivers only one tiny
    block per Windows engine period and a 23-second take becomes ~3 seconds.
    A zero PortAudio blocksize asks the real capture host for its native packet
    (441 frames on the affected 44.1-kHz device) without changing monitoring.
    """
    if requested <= 0:
        raise RuntimeError("Recording requires a positive requested buffer")
    try:
        device = sd.query_devices(device_id, kind="input")
        host = sd.query_hostapis(int(device["hostapi"]))
        host_name = str(host.get("name", ""))
    except Exception:  # PortAudio exposes backend-specific query error classes.
        return requested
    return requested if "asio" in host_name.casefold() else 0


def _capture_attempts(
    device_id: int | None,
    output_device_id: int | None,
    sample_rate: int,
    blocksize: int,
    monitoring_enabled: bool,
) -> list[tuple[int | None, int | None, int, int, bool, str | float]]:
    # Do not silently change device, rate, buffer or disable self-monitoring.
    # Driver rejection is reported to the user, not retried with hidden latency.
    if blocksize < 0 or sample_rate <= 0:
        raise RuntimeError("Recording requires a non-negative buffer and positive sample rate")
    return [(device_id, output_device_id if monitoring_enabled else None,
             sample_rate, blocksize, monitoring_enabled,
             "low" if blocksize == 0 else blocksize / sample_rate)]


def backend_available() -> tuple[bool, str | None]: return (_AUDIO_BACKEND_AVAILABLE, _AUDIO_BACKEND_ERROR)


@serialized
def start_recording(
    song_id: str,
    device_id: int | None = None,
    output_device_id: int | None = None,
    sample_rate: int = config.RECORDING_SAMPLE_RATE,
    channels: int = config.RECORDING_CHANNELS,
    gain: float = 1.0,
    monitoring_enabled: bool = False,
    playback_offset_sec: float = 0,
    playback_rate: float = 1,
    blocksize: int = 64,
    music_gain: float = 1.0,
    effects: dict[str, float] | None = None,
    noise_suppression: float = 0.35,
    monitor_mode: str | None = None,
    monitor_owner: str = "recording",
) -> str:
    if not _AUDIO_BACKEND_AVAILABLE: raise RuntimeError(f"Аудио-бэкенд недоступен: {_AUDIO_BACKEND_ERROR}")
    if has_live_capture():
        raise RuntimeError("A microphone recording is already active")
    session_id = uuid.uuid4().hex
    session: RecordingSession | None = None
    errors: list[str] = []
    publish_target = config.SONG_OUTPUT_DIR
    recording_size = storage_budget_service.recording_bytes(
        sample_rate, channels, config.MAX_RECORDING_DURATION_SECONDS
    )
    storage_reservations = storage_budget_service.reserve_many(
        [
            ("recording_capture", config.CACHE_DIR, recording_size),
            ("recording_publish", publish_target, recording_size),
        ]
    )
    for input_id, output_id, rate, frames, monitor, latency in _capture_attempts(
        device_id, output_device_id, sample_rate, _capture_blocksize(device_id, blocksize),
        monitoring_enabled or (monitor_owner == "recording" and monitor_mode is not None)
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
                monitoring_enabled,
                playback_offset_sec,
                playback_rate,
                frames,
                music_gain,
                effects,
                noise_suppression,
                latency,
                monitor_mode=monitor_mode,
                monitor_owner=monitor_owner,
                storage_reservations=storage_reservations,
            )
            session.start()
            logger.info(
                "Recording audio started: input=%s output=%s requested_rate=%s actual_rate=%s "
                "requested_buffer=%s capture_buffer=%s monitor=%s requested_latency=%s",
                input_id, output_id, rate, session.sample_rate, blocksize, frames, monitor, latency,
            )
            break
        except Exception as exc:  # Audio drivers raise implementation-specific errors.
            errors.append(str(exc))
            if session is not None:
                with contextlib.suppress(Exception): session.close()
            session = None
    if session is None:
        storage_budget_service.release_all(storage_reservations)
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
    with hardware_lock, _sessions_lock:
        sessions = [
            _sessions.pop(session_id)
            for session_id, session in tuple(_sessions.items())
            if str(session.song_id) == key
        ]
        for session in sessions:
            session.stop_capture()
    for session in sessions:
        with contextlib.suppress(Exception): session.close()


def close_all_sessions() -> None:
    with hardware_lock, _sessions_lock:
        sessions = tuple(_sessions.values())
        _sessions.clear()
        for session in sessions:
            session.stop_capture()
    for session in sessions:
        with contextlib.suppress(Exception): session.close()


def pause_recording(session_id: str) -> None: _require_session(session_id).pause()


def resume_recording(session_id: str) -> None: _require_session(session_id).resume()


def sync_recording(session_id: str, position_sec: float, playback_rate: float = 1) -> None:
    _require_session(session_id).sync_playback(position_sec, playback_rate)


def stop_recording(session_id: str) -> models.Recording:
    # No hardware_lock here: popping the session and stopping ITS OWN stream
    # (see the comment on RecordingSession.stop_capture) never needs to wait
    # behind an unrelated monitor-process (re)start elsewhere.
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
        completed_id = _completed_recordings.get(session_id)
        finalizing = _finalizing_recordings.get(session_id)
        if session is not None:
            session.stop_capture()
            finalizing = threading.Event()
            _finalizing_recordings[session_id] = finalizing
    if session is None:
        # Two UI lifecycle paths may ask to stop the same recording at nearly
        # the same time. The first request owns finalization; the second waits
        # for its result instead of returning a misleading 404 while the WAV
        # and performance mix are still being committed.
        if completed_id is None and finalizing is not None:
            finalizing.wait(timeout=120.0)
            with _sessions_lock:
                completed_id = _completed_recordings.get(session_id)
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
            session.gain,
            _playback_rate(getattr(session, "playback_rate", 1)),
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
        with _sessions_lock:
            event = _finalizing_recordings.pop(session_id, None)
            if event is not None: event.set()


def resolve_recording_path(recording: models.Recording) -> Path:
    try:
        return song_service.resolve_library_path(Path(recording.path))
    except ValueError as exc:
        raise ValueError("Recording path is outside the application library") from exc



def delete_recording(db, recording: models.Recording) -> None: delete_with_files(db, recording, existing_unique_paths((resolve_recording_path(recording), room_voice_path(recording), *performance_mix_paths(recording))))


def performance_mix_path(recording: models.Recording) -> Path:
    voice_path = resolve_recording_path(recording)
    return voice_path.with_name(f"{voice_path.stem}-performance.mp3")


def performance_mix_paths(recording: models.Recording) -> tuple[Path, Path]:
    voice_path = resolve_recording_path(recording)
    return performance_mix_path(recording), voice_path.with_name(
        f"{voice_path.stem}-performance.wav"
    )


def room_voice_path(recording: models.Recording) -> Path:
    voice_path = resolve_recording_path(recording)
    return voice_path.with_name(f"{voice_path.stem}-room.webm")


def _find_instrumental(song_dir: Path) -> Path | None: return song_artifacts.resolve_audio_artifact(song_dir, 'instrumental')


def _effect_filter(name: str, amount: float, source: str, target: str) -> str | None:
    if name == "octave":
        octave = max(-1.0, min(1.0, float(amount)))
        if abs(octave) < 0.005:
            return None
        ratio = 2.0**octave
        return (
            f"[{source}]aresample=48000,asetrate={48000 * ratio:.3f},"
            f"aresample=48000,atempo={1.0 / ratio:.6f}[{target}]"
        )
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
    voice_gain: float = 1.0,
    playback_rate: float = 1.0,
) -> list[str]:
    valid_segments = []
    for segment in playback_segments or []:
        start = max(0.0, float(segment.get("start_recording_sec", 0)))
        end = min(float(recording.duration_sec or 0), float(segment.get("end_recording_sec", start)))
        if end - start >= 0.001:
            rate = _playback_rate(segment.get("playback_rate", 1))
            valid_segments.append(
                (start, float(segment.get("start_playback_sec", 0)), end - start, rate)
            )

    if valid_segments:
        inputs = ['-i', str(instrumental), '-i', recording.path]
        filters = []
        music_labels = []
        for index, (recording_start, playback_start, duration, rate) in enumerate(valid_segments):
            label = f"music{index}"
            audible_start = max(0.0, playback_start)
            delay_ms = round((recording_start + max(0.0, -playback_start)) * 1000)
            filters.append(
                f"[0:a]atrim=start={audible_start:.6f}:duration={duration * rate:.6f},"
                f"asetpts=PTS-STARTPTS,atempo={rate:.6f},adelay={delay_ms}:all=1,"
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
        rate = _playback_rate(playback_rate)
        filters = [
            f'[0:a]atempo={rate:.6f},volume={music_gain:.6f}[music]',
            '[1:a]volume=1.000000[performer0]',
        ]
        music_label = "music"
    final_voice_gain = max(0.0, min(4.0, float(voice_gain))) * 1.65
    filters.append(
        f"[performer0]volume={final_voice_gain:.6f},"
        "highpass=f=70,"
        "equalizer=f=2200:t=q:w=0.9:g=1.3,"
        "agate=threshold=0.0025:ratio=2:attack=8:release=160:range=0.08,"
        "acompressor=threshold=0.16:ratio=3:attack=5:release=80:makeup=1.08"
        "[performer-studio]"
    )
    performer_label = 'performer-studio'
    for index, (name, amount) in enumerate((effects or {}).items(), start=1):
        next_label = f"performer{index}"
        effect = _effect_filter(name, amount, performer_label, next_label)
        if effect is None: continue
        filters.append(effect)
        performer_label = next_label
    filters.append(f"[{performer_label}]alimiter=limit=0.95[performer-final]")
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
    voice_gain: float = 1.0,
    playback_rate: float = 1.0,
) -> None:
    try:
        _create_performance_mix(
            recording, song, offset_sec, music_gain, effects, playback_segments, voice_gain,
            playback_rate
        )
    except Exception:  # noqa: BLE001 - the raw take is already committed and must remain usable
        logger.exception("Could not create performance mix for recording %s", recording.id)


def _create_performance_mix(
    recording: models.Recording,
    song: models.Song,
    offset_sec: float,
    music_gain: float,
    effects: dict[str, float] | None = None,
    playback_segments: list[dict[str, float]] | None = None,
    voice_gain: float = 1.0,
    playback_rate: float = 1.0,
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
            voice_gain,
            playback_rate,
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


def attach_room_audio(
    recording: models.Recording,
    song: models.Song,
    source,
    start_playback_sec: float = 0,
    latency_compensation_sec: float = 0,
) -> Path:
    destination = room_voice_path(recording)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with temporary.open("wb") as output:
            shutil.copyfileobj(source, output, length=1024 * 1024)
        if temporary.stat().st_size <= 0: raise ValueError("Room voice recording is empty")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    try:
        playback_segments = json.loads(recording.playback_segments_json or "[]")
    except (TypeError, ValueError):
        playback_segments = []
    base_mix = next((path for path in performance_mix_paths(recording) if path.is_file()), None)
    if base_mix is None:
        _create_performance_mix(
            recording,
            song,
            float(recording.playback_offset_sec or 0),
            1.0,
            None,
            playback_segments,
        )
        base_mix = next((path for path in performance_mix_paths(recording) if path.is_file()), None)
    if base_mix is None: raise RuntimeError("Performance mix is unavailable")

    ffmpeg = str(config.FFMPEG_EXE)
    if not Path(ffmpeg).is_file(): ffmpeg = shutil.which(ffmpeg) or ""
    if not ffmpeg: raise RuntimeError("FFmpeg is unavailable")
    compensated_playback = float(start_playback_sec) - max(
        0.0, min(0.5, float(latency_compensation_sec))
    )
    if playback_segments:
        first = playback_segments[0]
        room_start = (
            float(first.get("start_recording_sec", 0))
            + compensated_playback
            - float(first.get("start_playback_sec", 0))
        )
    else:
        room_start = compensated_playback - float(recording.playback_offset_sec or 0)
    trim = max(0.0, -room_start)
    delay_ms = max(0, round(room_start * 1000))
    temporary_mix = base_mix.with_name(
        f".{base_mix.stem}.{uuid.uuid4().hex}.tmp{base_mix.suffix}"
    )
    codec = ["-c:a", "pcm_s24le"] if base_mix.suffix.casefold() == ".wav" else [
        "-c:a", "libmp3lame", "-b:a", "320k"
    ]
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(base_mix),
        "-i",
        str(destination),
        "-filter_complex",
        (
            f"[1:a]atrim=start={trim:.6f},asetpts=PTS-STARTPTS,"
            f"adelay={delay_ms}:all=1,volume=1.350000[room];"
            "[0:a][room]amix=inputs=2:duration=first:normalize=0,"
            "alimiter=limit=0.95[mix]"
        ),
        "-map",
        "[mix]",
        "-t",
        f"{recording.duration_sec or 0:.3f}",
        *codec,
        str(temporary_mix),
    ]
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=90)
        os.replace(temporary_mix, base_mix)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Could not mix room voices: {exc}") from exc
    finally:
        temporary_mix.unlink(missing_ok=True)
    return destination
