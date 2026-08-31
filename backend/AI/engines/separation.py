from __future__ import annotations

import contextlib
import multiprocessing
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from queue import Empty
from types import ModuleType

import numpy as np
import soundfile as sf

from ..errors import (
    AICoreError,
    AcceleratorUnavailableError,
    EngineUnavailableError,
    ProcessingCancelledError,
)
from .base import Separator


def _worker_error(error: BaseException, device: str) -> dict[str, object]:
    error_type = type(error)
    type_name = f"{error_type.__module__}.{error_type.__name__}"
    code = getattr(error, "code", getattr(error, "error_code", None))
    accelerator = device == "cuda" and (
        error_type.__module__.startswith(("torch.cuda", "torch.backends.cudnn"))
        or error_type.__name__ in {"OutOfMemoryError", "AcceleratorError", "CUDNNError"}
        or code in {2, 46, 700, 701, 702, 719}
    )
    return {
        "message": f"{error_type.__name__}: {error}",
        "type": type_name,
        "code": code,
        "accelerator": accelerator,
    }


def _worker(engine_dir, config_path, checkpoint, requests, results, device, parent_pid):
    sys.path.insert(0, engine_dir)
    try:
        try:
            import psutil

            process = psutil.Process()
            if os.name == "nt":
                process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            def stop_with_parent():
                while psutil.pid_exists(parent_pid):
                    time.sleep(1)
                os._exit(1)

            threading.Thread(target=stop_with_parent, daemon=True).start()
        except (ImportError, OSError):
            pass
        engine_root = Path(engine_dir).resolve()
        for name, module in tuple(sys.modules.items()):
            if name.split(".", 1)[0] not in {"models", "utils"}:
                continue
            module_file = getattr(module, "__file__", None)
            if not module_file or engine_root not in Path(module_file).resolve().parents:
                sys.modules.pop(name, None)
        for name in ("models", "utils"):
            package = ModuleType(name)
            package.__path__ = [str(engine_root / name)]
            package.__package__ = name
            sys.modules[name] = package
        import torch
        from inference import run_folder
        from utils.model_utils import load_start_checkpoint
        from utils.settings import get_model_from_config, parse_args_inference

        arguments = parse_args_inference({
            "model_type": "mel_band_roformer",
            "config_path": config_path,
            "start_check_point": checkpoint,
            "force_cpu": device == "cpu",
            "disable_detailed_pbar": True,
            # Keep the MSST output contract stable across upstream releases.
            # Some MSST revisions default to FLAC/PCM while others default to
            # WAV/FLOAT; the application accepts both below, but requesting
            # FLOAT avoids an unnecessary lossless transcode in the worker.
            "flac_file": False,
            "pcm_type": "FLOAT",
            "filename_template": "{file_name}/{instr}",
        })
        model, config = get_model_from_config(arguments.model_type, arguments.config_path)
        weights = torch.load(checkpoint, weights_only=False, map_location="cpu")
        load_start_checkpoint(arguments, model, weights, type_="inference")
        model = model.to(device)
        results.put(("ready", None))
        while True:
            try:
                request = requests.get(timeout=1)
            except Empty:
                try:
                    import psutil

                    if not psutil.pid_exists(parent_pid):
                        return
                except ImportError:
                    pass
                continue
            if request is None:
                return
            job, input_dir, output_dir, tuning = request
            started = time.perf_counter()
            try:
                arguments.input_folder, arguments.store_dir = input_dir, output_dir
                for key, value in tuning.items():
                    setattr(config.inference, key, value)
                run_folder(model, arguments, config, device, verbose=True)
                results.put((job, time.perf_counter() - started))
            except BaseException as error:
                results.put((job, _worker_error(error, device)))
    except BaseException as error:
        results.put(("boot-error", _worker_error(error, device)))


def _fit(audio: np.ndarray, frames: int, channels: int) -> np.ndarray:
    audio = audio[:, None] if audio.ndim == 1 else audio
    if audio.shape[1] == 1 and channels == 2:
        audio = np.repeat(audio, 2, axis=1)
    audio = np.pad(audio[:, :channels], ((0, max(0, frames - len(audio))), (0, max(0, channels - audio.shape[1]))))
    return audio[:frames, :channels]


class MSSTMelRoformerSeparator(Separator):
    name = "mel-band-roformer-msst"

    def __init__(self, engine_dir=None, config=None, checkpoint=None, **_options):
        self.engine_dir = Path(engine_dir or os.getenv("MSST_ENGINE_DIR", ""))
        self.config = Path(config or os.getenv("MSST_CONFIG", ""))
        self.checkpoint = Path(checkpoint or os.getenv("MSST_CHECKPOINT", ""))
        self._process = self._requests = self._results = None
        self._device = None

    def missing_resources(self) -> list[str]:
        resources = (
            ("MSST_ENGINE_DIR/inference.py", self.engine_dir / "inference.py"),
            ("MSST_CONFIG", self.config),
            ("MSST_CHECKPOINT", self.checkpoint),
        )
        return [f"{name}={path if str(path) not in {'', '.'} else '<not configured>'}" for name, path in resources if not path.is_file()]

    def available(self) -> bool:
        return not self.missing_resources()

    def separate(self, mix, vocals, instrumental, *, profile=None, cancelled=None):
        if missing := self.missing_resources():
            raise EngineUnavailableError("Missing MSST resources: " + ", ".join(missing))
        with tempfile.TemporaryDirectory(prefix="karaoke-msst-", dir=Path(mix).parent) as temporary:
            source, output = Path(temporary) / "input", Path(temporary) / "output"
            source.mkdir()
            output.mkdir()
            staged = source / "song.wav"
            try:
                # source lives on the same volume as mix (see the
                # TemporaryDirectory dir= above), so a hardlink gives the
                # worker its own isolated single-file input folder -- MSST
                # must not also see the pipeline's other temp files sitting
                # next to mix -- without actually copying the mix's bytes.
                os.link(mix, staged)
            except OSError:
                shutil.copy2(mix, staged)
            tuning = {
                "num_overlap": profile.separation_overlap,
                "batch_size": profile.separation_batch_size,
            } if profile else {}
            try:
                self._run(source, output, tuning, cancelled=cancelled)
            except AcceleratorUnavailableError as error:
                print(f"[MSST] accelerator failed, retrying on CPU: {error}", flush=True)
                self.close()
                output = Path(temporary) / "output-cpu"
                output.mkdir()
                self._run(source, output, tuning, device="cpu", cancelled=cancelled)
            # MSST has changed its output codec defaults across releases.  Do
            # not bind the application to one extension: both WAV and FLAC are
            # lossless and soundfile reads either without changing the signal.
            files = sorted(
                item for item in output.rglob("*")
                if item.is_file() and item.suffix.lower() in {".wav", ".flac"}
            )
            vocal = next(
                (item for item in files if "vocal" in item.stem.lower() and "no_vocal" not in item.stem.lower()),
                None,
            )
            backing = next(
                (item for item in files if any(name in item.stem.lower() for name in ("instrumental", "no_vocal"))),
                None,
            )
            if vocal is None:
                produced = ", ".join(str(item.relative_to(output)) for item in files) or "<none>"
                raise AICoreError(f"MSST produced no vocal stem; audio outputs: {produced}")
            # _fit() only ever needs the mix's target frame/channel count, not
            # its samples -- reading that from metadata instead of decoding
            # the whole file avoids holding a full extra copy of the song in
            # memory on the (common) path where MSST already produced a
            # backing stem. The full mix only has to be decoded when there is
            # no backing stem and it must be computed as mix - vocal.
            mix_info = sf.info(mix)
            rate, target_frames, channels = mix_info.samplerate, mix_info.frames, mix_info.channels
            vocal_audio, vocal_rate = sf.read(vocal, dtype="float32", always_2d=True)
            if vocal_rate != rate:
                raise AICoreError("MSST sample-rate mismatch")
            vocal_audio = _fit(vocal_audio, target_frames, channels)
            if backing:
                backing_audio = _fit(sf.read(backing, dtype="float32", always_2d=True)[0], target_frames, channels)
            else:
                mix_audio = sf.read(mix, dtype="float32", always_2d=True)[0]
                backing_audio = mix_audio - vocal_audio
            sf.write(vocals, np.clip(vocal_audio, -1, 1), rate, subtype="PCM_24")
            sf.write(instrumental, np.clip(backing_audio, -1, 1), rate, subtype="PCM_24")

    def close(self) -> None:
        process, requests, results = self._process, self._requests, self._results
        self._process = self._requests = self._results = None
        self._device = None
        if process and process.is_alive():
            with contextlib.suppress(Exception):
                requests.put_nowait(None)
            process.join(timeout=1)
        if process and process.is_alive():
            process.terminate()
            process.join(timeout=1)
        if process and process.is_alive() and hasattr(process, "kill"):
            process.kill()
            process.join(timeout=1)
        for queue in (requests, results):
            try:
                queue.close()
                queue.cancel_join_thread()
            except (AttributeError, OSError, ValueError):
                pass

    def _run(self, source, output, tuning, device=None, cancelled=None):
        self._ensure_worker(device, cancelled)
        job = os.urandom(8).hex()
        self._requests.put((job, str(source), str(output), tuning))
        last_report = time.monotonic()
        while self._process.is_alive():
            if callable(cancelled) and cancelled():
                self.close()
                raise ProcessingCancelledError("Song processing cancelled")
            try:
                response, value = self._results.get(timeout=0.25)
            except Empty:
                if time.monotonic() - last_report >= 10:
                    print("[MSST] separation is active", flush=True)
                    last_report = time.monotonic()
                continue
            if response != job:
                continue
            if isinstance(value, dict):
                error = AcceleratorUnavailableError if value.get("accelerator") else AICoreError
                raise error(str(value.get("message") or "MSST worker failed"))
            return
        raise AICoreError(f"MSST worker exited with {self._process.exitcode}")

    def _ensure_worker(self, device=None, cancelled=None):
        if self._process and self._process.is_alive() and (device is None or device == self._device):
            return
        self.close()
        context = multiprocessing.get_context("spawn")
        self._requests, self._results = context.Queue(1), context.Queue(1)
        from ..runtime import selected_backend
        backend = selected_backend("separation")
        device = device or (backend.device if backend else "cpu")
        self._device = device
        self._process = context.Process(
            target=_worker,
            args=(
                str(self.engine_dir), str(self.config), str(self.checkpoint),
                self._requests, self._results, device, os.getpid(),
            ),
            daemon=True,
        )
        self._process.start()
        deadline = time.monotonic() + 300
        while True:
            if callable(cancelled) and cancelled():
                self.close()
                raise ProcessingCancelledError("Song processing cancelled")
            if not self._process.is_alive():
                code = self._process.exitcode
                self.close()
                raise AICoreError(f"MSST initialization process exited with {code}")
            try:
                status, detail = self._results.get(timeout=0.25)
                break
            except Empty:
                if time.monotonic() >= deadline:
                    self.close()
                    raise AICoreError("MSST initialization timed out") from None
        if status != "ready":
            self.close()
            if isinstance(detail, dict):
                error = AcceleratorUnavailableError if detail.get("accelerator") else AICoreError
                raise error(str(detail.get("message") or "MSST initialization failed"))
            raise AICoreError(detail or "MSST initialization failed")


class CenterChannelFallbackSeparator(Separator):
    name = "center-channel-fallback"

    def separate(self, mix, vocals, instrumental, *, profile=None, cancelled=None):
        if callable(cancelled) and cancelled():
            raise ProcessingCancelledError("Song processing cancelled")
        audio, rate = sf.read(mix, dtype="float32", always_2d=True)
        center = np.mean(audio[:, :2], axis=1, keepdims=True)
        vocal = np.repeat(center, audio.shape[1], axis=1)
        sf.write(vocals, vocal, rate, subtype="PCM_24")
        sf.write(instrumental, audio - vocal, rate, subtype="PCM_24")
